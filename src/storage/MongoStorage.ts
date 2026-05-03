import { WebSocket } from "ws";
import * as crypto from "crypto";
import type {
  MongoClientLike,
  MongoCollectionLike,
  MongoDbLike,
  ParticipantInfo,
  Room,
} from "../types/types";
import { BaseStorage } from "./BaseStorage";

interface MongoRoomDocument {
  _id: string;
  id: string;
  name?: string;
  maxCapacity?: number;
  password?: string;
  createdAt: number;
}

interface MongoUserRoomDocument {
  _id: string;
  userId: string;
  roomId: string;
}

interface MongoParticipantDocument {
  _id: string;
  roomId: string;
  userId: string;
  userName: string;
  instanceId: string;
}

export interface MongoStorageOptions {
  collectionPrefix?: string;
  client?: Pick<MongoClientLike, "close">;
  closeClientOnClose?: boolean;
  ready?: Promise<unknown>;
}

export class MongoStorage extends BaseStorage {
  private readonly rooms: MongoCollectionLike<MongoRoomDocument>;
  private readonly userRooms: MongoCollectionLike<MongoUserRoomDocument>;
  private readonly participants: MongoCollectionLike<MongoParticipantDocument>;
  private readonly socketMap = new Map<string, WebSocket>();
  private readonly instanceId = crypto.randomUUID();
  private readonly client?: Pick<MongoClientLike, "close">;
  private readonly closeClientOnClose: boolean;
  private readonly ready: Promise<unknown>;
  private readonly indexesReady: Promise<void>;
  private closed = false;

  constructor(db: MongoDbLike, options: MongoStorageOptions = {}) {
    super();

    const prefix = options.collectionPrefix ?? "aves";
    this.rooms = db.collection<MongoRoomDocument>(`${prefix}_rooms`);
    this.userRooms = db.collection<MongoUserRoomDocument>(
      `${prefix}_user_rooms`,
    );
    this.participants = db.collection<MongoParticipantDocument>(
      `${prefix}_participants`,
    );
    this.client = options.client;
    this.closeClientOnClose = options.closeClientOnClose ?? false;
    this.ready = options.ready ?? Promise.resolve();
    this.indexesReady = this.ensureIndexes();
  }

  private async ensureReady(): Promise<void> {
    await this.ready;
    await this.indexesReady;
  }

  private async ensureIndexes(): Promise<void> {
    await this.ready;
    await Promise.all([
      this.rooms.createIndex({ id: 1 }),
      this.userRooms.createIndex({ roomId: 1 }),
      this.participants.createIndex({ roomId: 1 }),
      this.participants.createIndex({ userId: 1 }),
    ]);
  }

  async setRoom(roomId: string, room: Room): Promise<void> {
    const existing = await this.getRoom(roomId);
    const event = existing
      ? this.createRoomUpdateEvent(roomId, existing, room)
      : this.createRoomCreateEvent(roomId, room);

    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return;

    await this.ensureReady();
    await this.rooms.replaceOne(
      { _id: roomId },
      {
        _id: roomId,
        id: room.id,
        name: room.name,
        maxCapacity: room.maxCapacity,
        password: room.password,
        createdAt: room.createdAt,
      },
      { upsert: true },
    );
    await this.emitAfterChange(event);
  }

  async getRoom(roomId: string): Promise<Room | null> {
    await this.ensureReady();
    const room = await this.rooms.findOne({ _id: roomId });
    if (!room) {
      return null;
    }

    return {
      id: room.id,
      name: room.name,
      maxCapacity: room.maxCapacity,
      password: room.password,
      participants: await this.getAllParticipants(roomId),
      createdAt: room.createdAt,
    };
  }

  async deleteRoom(roomId: string): Promise<void> {
    const room = await this.getRoom(roomId);
    if (!room) return;

    const event = this.createRoomDeleteEvent(roomId, room);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return;

    await this.ensureReady();
    await this.participants.deleteMany({ roomId });
    await this.userRooms.deleteMany({ roomId });
    await this.rooms.deleteOne({ _id: roomId });
    await this.emitAfterChange(event);
  }

  async getAllRooms(): Promise<Room[]> {
    await this.ensureReady();
    const roomDocuments = await this.rooms.find({}).toArray();
    const rooms = await Promise.all(
      roomDocuments.map((room) => this.getRoom(room._id)),
    );
    return rooms.filter((room): room is Room => room !== null);
  }

  async roomExists(roomId: string): Promise<boolean> {
    await this.ensureReady();
    return (await this.rooms.findOne({ _id: roomId })) !== null;
  }

  async setUserRoom(userId: string, roomId: string): Promise<boolean> {
    const event = this.createUserBindRoomEvent(userId, roomId);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return false;

    await this.ensureReady();
    const result = await this.userRooms.updateOne(
      { _id: userId },
      {
        $setOnInsert: {
          _id: userId,
          userId,
          roomId,
        },
      },
      { upsert: true },
    );

    if ((result.upsertedCount ?? 0) !== 1) {
      return false;
    }

    await this.emitAfterChange(event);
    return true;
  }

  async getUserRoom(userId: string): Promise<string | null> {
    await this.ensureReady();
    const binding = await this.userRooms.findOne({ _id: userId });
    return binding?.roomId ?? null;
  }

  async deleteUserRoom(userId: string): Promise<void> {
    const roomId = await this.getUserRoom(userId);
    if (!roomId) return;

    const event = this.createUserUnbindRoomEvent(userId, roomId);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return;

    await this.ensureReady();
    await this.userRooms.deleteOne({ _id: userId });
    this.socketMap.delete(userId);
    await this.emitAfterChange(event);
  }

  async setParticipant(
    roomId: string,
    userId: string,
    participant: ParticipantInfo,
  ): Promise<boolean> {
    const event = this.createParticipantJoinEvent(roomId, userId, participant);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return false;

    await this.ensureReady();
    await this.participants.replaceOne(
      { _id: this.participantId(roomId, userId) },
      {
        _id: this.participantId(roomId, userId),
        roomId,
        userId: participant.userId,
        userName: participant.userName,
        instanceId: this.instanceId,
      },
      { upsert: true },
    );
    this.socketMap.set(userId, participant.socket);
    await this.emitAfterChange(event);
    return true;
  }

  async getParticipant(
    roomId: string,
    userId: string,
  ): Promise<ParticipantInfo | null> {
    await this.ensureReady();
    const participant = await this.participants.findOne({
      _id: this.participantId(roomId, userId),
    });
    if (!participant) {
      return null;
    }

    return this.resolveParticipant(participant);
  }

  async deleteParticipant(roomId: string, userId: string): Promise<void> {
    const participant = await this.getParticipant(roomId, userId);
    if (!participant) return;

    const event = this.createParticipantLeaveEvent(roomId, userId, participant);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return;

    await this.ensureReady();
    await this.participants.deleteOne({ _id: this.participantId(roomId, userId) });
    this.socketMap.delete(userId);
    await this.emitAfterChange(event);
  }

  async getAllParticipants(
    roomId: string,
  ): Promise<Map<string, ParticipantInfo>> {
    await this.ensureReady();
    const participantDocuments = await this.participants.find({ roomId }).toArray();
    const participants = new Map<string, ParticipantInfo>();

    for (const participant of participantDocuments) {
      const resolved = this.resolveParticipant(participant);
      if (resolved) {
        participants.set(participant.userId, resolved);
      }
    }

    return participants;
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.socketMap.clear();

    if (this.closeClientOnClose && this.client) {
      void this.client.close();
    }
  }

  private participantId(roomId: string, userId: string): string {
    return `${roomId}:${userId}`;
  }

  private resolveParticipant(
    participant: MongoParticipantDocument,
  ): ParticipantInfo | null {
    if (participant.instanceId !== this.instanceId) {
      return null;
    }

    const socket = this.socketMap.get(participant.userId);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return null;
    }

    return {
      userId: participant.userId,
      userName: participant.userName,
      socket,
    };
  }
}
