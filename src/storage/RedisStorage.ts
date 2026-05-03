import type { Redis } from "ioredis";
import { Room, ParticipantInfo } from "../types/types";
import { WebSocket } from "ws";
import { BaseStorage } from "./BaseStorage";
import * as crypto from "crypto";

interface RedisParticipantRecord {
  userId: string;
  userName: string;
  instanceId?: string;
}

interface RemoteSignalEnvelope {
  userId: string;
  payload: string;
}

export class RedisStorage extends BaseStorage {
  private readonly redis: Redis;
  private readonly subscriber: Redis;
  private readonly socketMap: Map<string, WebSocket> = new Map();
  private readonly keyPrefix: string;
  private readonly instanceId: string;
  private readonly signalChannel: string;
  private readonly subscriptionReady: Promise<void>;
  private closed = false;

  constructor(redis: Redis, keyPrefix: string = "aves") {
    super();
    this.redis = redis;
    this.keyPrefix = keyPrefix;
    this.instanceId = crypto.randomUUID();
    this.subscriber = this.redis.duplicate();
    this.signalChannel = this.key("instance", this.instanceId, "signals");
    this.subscriptionReady = this.initializeSubscriber();
  }

  private key(type: string, ...parts: string[]): string {
    return `${this.keyPrefix}:${type}:${parts.join(":")}`;
  }

  private async initializeSubscriber(): Promise<void> {
    this.subscriber.on("message", this.handleRemoteMessage);
    await this.subscriber.subscribe(this.signalChannel);
  }

  private readonly handleRemoteMessage = (
    channel: string,
    payload: string,
  ): void => {
    if (channel !== this.signalChannel || this.closed) {
      return;
    }

    try {
      const message = JSON.parse(payload) as RemoteSignalEnvelope;
      const socket = this.socketMap.get(message.userId);

      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      socket.send(message.payload);
    } catch (error) {
      console.warn("Failed to forward Redis signaling message:", error);
    }
  };

  private createRemoteSocket(userId: string, instanceId: string): WebSocket {
    return {
      readyState: WebSocket.OPEN,
      send: (payload: string) => {
        void this.redis
          .publish(
            this.key("instance", instanceId, "signals"),
            JSON.stringify({ userId, payload } satisfies RemoteSignalEnvelope),
          )
          .catch((error) => {
            console.warn(
              `Failed to publish signaling message for user ${userId}:`,
              error,
            );
          });
      },
    } as unknown as WebSocket;
  }

  private resolveParticipantSocket(
    userId: string,
    instanceId?: string,
  ): WebSocket | null {
    const localSocket = this.socketMap.get(userId);
    if (localSocket) {
      return localSocket;
    }

    if (!instanceId || instanceId === this.instanceId) {
      return null;
    }

    return this.createRemoteSocket(userId, instanceId);
  }

  async setRoom(roomId: string, room: Room): Promise<void> {
    const existing = await this.getRoom(roomId);
    const event = existing
      ? this.createRoomUpdateEvent(roomId, existing, room)
      : this.createRoomCreateEvent(roomId, room);

    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return;

    const roomData: Record<string, string> = {
      id: room.id,
      createdAt: room.createdAt.toString(),
    };
    if (room.name) roomData.name = room.name;
    if (room.maxCapacity) roomData.maxCapacity = room.maxCapacity.toString();
    if (room.password) roomData.password = room.password;

    await this.redis.hset(this.key("room", roomId), roomData);
    await this.redis.sadd(this.key("rooms"), roomId);

    await this.emitAfterChange(event);
  }

  async getRoom(roomId: string): Promise<Room | null> {
    const roomData = await this.redis.hgetall(this.key("room", roomId));
    if (!roomData || !roomData.id) {
      return null;
    }

    const participants = await this.getAllParticipants(roomId);

    return {
      id: roomData.id,
      name: roomData.name,
      maxCapacity: roomData.maxCapacity
        ? parseInt(roomData.maxCapacity)
        : undefined,
      password: roomData.password,
      participants,
      createdAt: parseInt(roomData.createdAt),
    };
  }

  async deleteRoom(roomId: string): Promise<void> {
    const room = await this.getRoom(roomId);
    if (!room) return;

    const event = this.createRoomDeleteEvent(roomId, room);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return;

    const participantIds = await this.redis.smembers(
      this.key("room", roomId, "participants"),
    );
    if (participantIds.length > 0) {
      const participantKeys = participantIds.map((id) =>
        this.key("room", roomId, "participant", id),
      );
      await this.redis.del(...participantKeys);
    }
    await this.redis.del(this.key("room", roomId, "participants"));
    await this.redis.srem(this.key("rooms"), roomId);
    await this.redis.del(this.key("room", roomId));

    await this.emitAfterChange(event);
  }

  async getAllRooms(): Promise<Room[]> {
    const roomIds = await this.redis.smembers(this.key("rooms"));
    const roomPromises = roomIds.map((roomId) => this.getRoom(roomId));
    const rooms = await Promise.all(roomPromises);
    return rooms.filter((room): room is Room => room !== null);
  }

  async roomExists(roomId: string): Promise<boolean> {
    return (await this.redis.sismember(this.key("rooms"), roomId)) === 1;
  }

  async setUserRoom(userId: string, roomId: string): Promise<boolean> {
    const event = this.createUserBindRoomEvent(userId, roomId);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return false;

    // Use SET NX for atomic check-and-set across instances
    const result = await this.redis.set(
      this.key("user", userId, "room"),
      roomId,
      "NX",
    );

    if (result !== "OK") {
      return false;
    }

    await this.emitAfterChange(event);
    return true;
  }

  async getUserRoom(userId: string): Promise<string | null> {
    return await this.redis.get(this.key("user", userId, "room"));
  }

  async deleteUserRoom(userId: string): Promise<void> {
    const roomId = await this.getUserRoom(userId);
    if (!roomId) return;

    const event = this.createUserUnbindRoomEvent(userId, roomId);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return;

    await this.redis.del(this.key("user", userId, "room"));
    this.socketMap.delete(userId);

    await this.emitAfterChange(event);
  }

  async setParticipant(
    roomId: string,
    userId: string,
    participant: ParticipantInfo,
  ): Promise<boolean> {
    await this.subscriptionReady;

    const event = this.createParticipantJoinEvent(roomId, userId, participant);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return false;

    const participantData = {
      userId: participant.userId,
      userName: participant.userName,
      instanceId: this.instanceId,
    };
    await this.redis.hset(
      this.key("room", roomId, "participant", userId),
      participantData,
    );
    await this.redis.sadd(this.key("room", roomId, "participants"), userId);
    this.socketMap.set(userId, participant.socket);

    await this.emitAfterChange(event);
    return true;
  }

  async getParticipant(
    roomId: string,
    userId: string,
  ): Promise<ParticipantInfo | null> {
    await this.subscriptionReady;

    const participantData = (await this.redis.hgetall(
      this.key("room", roomId, "participant", userId),
    )) as unknown as RedisParticipantRecord;
    if (!participantData || !participantData.userId) {
      return null;
    }

    const socket = this.resolveParticipantSocket(
      userId,
      participantData.instanceId,
    );
    if (!socket) {
      return null;
    }

    return {
      userId: participantData.userId,
      userName: participantData.userName,
      socket,
    };
  }

  async deleteParticipant(roomId: string, userId: string): Promise<void> {
    const participant = await this.getParticipant(roomId, userId);
    if (!participant) return;

    const event = this.createParticipantLeaveEvent(roomId, userId, participant);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return;

    await this.redis.del(this.key("room", roomId, "participant", userId));
    await this.redis.srem(this.key("room", roomId, "participants"), userId);
    this.socketMap.delete(userId);

    await this.emitAfterChange(event);
  }

  async getAllParticipants(
    roomId: string,
  ): Promise<Map<string, ParticipantInfo>> {
    await this.subscriptionReady;

    const participantIds = await this.redis.smembers(
      this.key("room", roomId, "participants"),
    );

    if (participantIds.length === 0) {
      return new Map();
    }

    // Use pipeline to batch fetch all participants (reduces N queries to 1 round-trip)
    const pipeline = this.redis.pipeline();
    for (const userId of participantIds) {
      pipeline.hgetall(this.key("room", roomId, "participant", userId));
    }
    const results = await pipeline.exec();

    const participants = new Map<string, ParticipantInfo>();

    if (!results) {
      return participants;
    }

    for (let i = 0; i < participantIds.length; i++) {
      const userId = participantIds[i];
      const [err, participantData] = results[i] as [
        Error | null,
        RedisParticipantRecord | null,
      ];

      if (err || !participantData || !participantData.userId) {
        continue;
      }

      const socket = this.resolveParticipantSocket(
        userId,
        participantData.instanceId,
      );
      if (!socket) {
        continue;
      }

      participants.set(userId, {
        userId: participantData.userId,
        userName: participantData.userName,
        socket,
      });
    }

    return participants;
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.socketMap.clear();
    this.subscriber.removeListener("message", this.handleRemoteMessage);

    void this.shutdownSubscriber();
  }

  private async shutdownSubscriber(): Promise<void> {
    try {
      await this.subscriptionReady;
    } catch {
      // Ignore subscription setup failures during shutdown.
    }

    try {
      await this.subscriber.unsubscribe(this.signalChannel);
    } catch {
      // Ignore unsubscribe failures during shutdown.
    }

    try {
      await this.subscriber.quit();
    } catch {
      // Ignore quit failures during shutdown.
    }
  }
}
