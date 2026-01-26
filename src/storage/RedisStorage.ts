import { Redis } from "ioredis";
import { Room, ParticipantInfo } from "../types/types";
import { WebSocket } from "ws";
import { BaseStorage } from "./BaseStorage";

export class RedisStorage extends BaseStorage {
  private redis: Redis;
  private socketMap: Map<string, WebSocket> = new Map();
  private keyPrefix: string;

  constructor(redis: Redis, keyPrefix: string = "aves") {
    super();
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  private key(type: string, ...parts: string[]): string {
    return `${this.keyPrefix}:${type}:${parts.join(":")}`;
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

  async setUserRoom(userId: string, roomId: string): Promise<void> {
    const event = this.createUserBindRoomEvent(userId, roomId);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return;

    await this.redis.set(this.key("user", userId, "room"), roomId);

    await this.emitAfterChange(event);
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
  ): Promise<void> {
    const event = this.createParticipantJoinEvent(roomId, userId, participant);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return;

    const participantData = {
      userId: participant.userId,
      userName: participant.userName,
    };
    await this.redis.hset(
      this.key("room", roomId, "participant", userId),
      participantData,
    );
    await this.redis.sadd(this.key("room", roomId, "participants"), userId);
    this.socketMap.set(userId, participant.socket);

    await this.emitAfterChange(event);
  }

  async getParticipant(
    roomId: string,
    userId: string,
  ): Promise<ParticipantInfo | null> {
    const participantData = await this.redis.hgetall(
      this.key("room", roomId, "participant", userId),
    );
    if (!participantData || !participantData.userId) {
      return null;
    }

    const socket = this.socketMap.get(userId);
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
        Record<string, string> | null,
      ];

      if (err || !participantData || !participantData.userId) {
        continue;
      }

      const socket = this.socketMap.get(userId);
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
}
