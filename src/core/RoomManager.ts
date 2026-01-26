import { WebSocket } from "ws";
import * as crypto from "crypto";
import {
  Room,
  ParticipantInfo,
  Participant,
  RoomInfo,
  SignalingMessage,
  CreateRoomOptions,
} from "../types/types";
import { IDataStorage } from "../storage/IDataStorage";

/**
 * RoomManager handles room lifecycle and participant management
 */
export class RoomManager {
  private storage: IDataStorage;

  constructor(storage: IDataStorage) {
    this.storage = storage;
  }

  /**
   * Create a new room and return its unique ID
   */
  async createRoom(options?: CreateRoomOptions): Promise<string> {
    const roomId = this.generateRoomId();
    const room: Room = {
      id: roomId,
      name: options?.name,
      maxCapacity: options?.maxCapacity,
      password: options?.password,
      participants: new Map(),
      createdAt: Date.now(),
    };
    await this.storage.setRoom(roomId, room);
    return roomId;
  }

  /**
   * Add a user to a room
   * @returns true if successful, false if room doesn't exist or validation fails
   */
  async joinRoom(
    roomId: string,
    userId: string,
    userName: string,
    socket: WebSocket,
    password?: string,
  ): Promise<boolean> {
    const room = await this.storage.getRoom(roomId);
    if (!room) {
      return false;
    }

    if (room.password && room.password !== password) {
      return false;
    }

    if (room.maxCapacity && room.participants.size >= room.maxCapacity) {
      return false;
    }

    const participantInfo: ParticipantInfo = {
      userId,
      userName,
      socket,
    };

    await this.storage.setParticipant(roomId, userId, participantInfo);
    await this.storage.setUserRoom(userId, roomId);

    return true;
  }

  /**
   * Remove a user from a room
   * Automatically deletes the room if it becomes empty
   */
  async leaveRoom(roomId: string, userId: string): Promise<void> {
    const room = await this.storage.getRoom(roomId);
    if (!room) {
      return;
    }

    await this.storage.deleteParticipant(roomId, userId);
    await this.storage.deleteUserRoom(userId);

    const participants = await this.storage.getAllParticipants(roomId);
    if (participants.size === 0) {
      await this.storage.deleteRoom(roomId);
    }
  }

  /**
   * Get the list of participants in a room
   */
  async getRoomParticipants(roomId: string): Promise<Participant[]> {
    const participants = await this.storage.getAllParticipants(roomId);
    return Array.from(participants.values()).map((p) => ({
      id: p.userId,
      name: p.userName,
    }));
  }

  /**
   * Check if a room exists
   */
  async roomExists(roomId: string): Promise<boolean> {
    return await this.storage.roomExists(roomId);
  }

  /**
   * Broadcast a message to all participants in a room
   * @param excludeUserId Optional user ID to exclude from broadcast
   */
  async broadcastToRoom(
    roomId: string,
    message: SignalingMessage,
    excludeUserId?: string,
  ): Promise<void> {
    const participants = await this.storage.getAllParticipants(roomId);
    const messageStr = JSON.stringify(message);

    participants.forEach((participant, userId) => {
      if (excludeUserId && userId === excludeUserId) {
        return;
      }

      if (participant.socket.readyState === WebSocket.OPEN) {
        try {
          participant.socket.send(messageStr);
        } catch (error) {
          console.warn(`Failed to send message to user ${userId}:`, error);
        }
      }
    });
  }

  /**
   * Send a message to a specific user
   */
  async sendToUser(userId: string, message: SignalingMessage): Promise<void> {
    const roomId = await this.storage.getUserRoom(userId);
    if (!roomId) {
      console.warn(`User ${userId} not found in any room`);
      return;
    }

    const participant = await this.storage.getParticipant(roomId, userId);
    if (!participant) {
      return;
    }

    if (participant.socket.readyState === WebSocket.OPEN) {
      try {
        participant.socket.send(JSON.stringify(message));
      } catch (error) {
        console.warn(`Failed to send message to user ${userId}:`, error);
      }
    }
  }

  /**
   * Get the room ID for a given user
   */
  async getRoomIdByUserId(userId: string): Promise<string | null> {
    return await this.storage.getUserRoom(userId);
  }

  /**
   * Get room information
   */
  async getRoomInfo(roomId: string): Promise<RoomInfo | null> {
    const room = await this.storage.getRoom(roomId);
    return room ? this.toRoomInfo(room) : null;
  }

  /**
   * Get all rooms information
   */
  async getAllRooms(): Promise<RoomInfo[]> {
    const rooms = await this.storage.getAllRooms();
    return rooms.map((room) => this.toRoomInfo(room));
  }

  /**
   * Convert Room to RoomInfo (public-facing data without password)
   */
  private toRoomInfo(room: Room): RoomInfo {
    return {
      id: room.id,
      name: room.name,
      maxCapacity: room.maxCapacity,
      hasPassword: !!room.password,
      participantCount: room.participants.size,
      createdAt: room.createdAt,
    };
  }

  /**
   * Generate a unique room ID using cryptographically secure random bytes
   */
  private generateRoomId(): string {
    return `room-${crypto.randomBytes(8).toString("hex")}`;
  }
}
