import { WebSocket } from "ws";
import * as crypto from "crypto";
import { AvesError } from "./AvesError";
import {
  Room,
  ParticipantInfo,
  Participant,
  RoomInfo,
  SignalingMessage,
  CreateRoomOptions,
} from "../types/types";
import { IDataStorage } from "../storage/IDataStorage";

const HASH_LENGTH = 64;
const HASH_SALT_LENGTH = 16;
const HASH_DELIMITER = ":";

/**
 * RoomManager handles room lifecycle and participant management
 */
export class RoomManager {
  private storage: IDataStorage;
  private errorCallbacks = new Set<(error: AvesError) => void>();

  constructor(storage: IDataStorage) {
    this.storage = storage;
  }

  /**
   * Register a callback for RoomManager-level errors
   * (e.g. WebSocket send failures, missing users).
   */
  onError(callback: (error: AvesError) => void): void {
    this.errorCallbacks.add(callback);
  }

  private emitError(error: AvesError): void {
    this.errorCallbacks.forEach((cb) => cb(error));
  }

  /**
   * Create a new room and return its unique ID.
   * Passwords are hashed with scrypt before storage.
   */
  async createRoom(options?: CreateRoomOptions): Promise<string> {
    const roomId = this.generateRoomId();
    const hashedPassword = options?.password
      ? await hashPassword(options.password)
      : undefined;
    const room: Room = {
      id: roomId,
      name: options?.name,
      maxCapacity: options?.maxCapacity,
      password: hashedPassword,
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

    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      return false;
    }

    if (room.password) {
      const match = await verifyPassword(password ?? "", room.password);
      if (!match) {
        return false;
      }
    }

    if (room.maxCapacity && room.participants.size >= room.maxCapacity) {
      return false;
    }

    // Atomically bind user to room first — prevents race conditions
    // in multi-instance deployments.
    const bound = await this.storage.setUserRoom(normalizedUserId, roomId);
    if (!bound) {
      return false;
    }

    try {
      const participantInfo: ParticipantInfo = {
        userId: normalizedUserId,
        userName,
        socket,
      };

      const stored = await this.storage.setParticipant(
        roomId,
        normalizedUserId,
        participantInfo,
      );
      if (!stored) {
        await this.storage.deleteUserRoom(normalizedUserId);
        return false;
      }

      return true;
    } catch (error) {
      await this.storage.deleteUserRoom(normalizedUserId);
      throw error;
    }
  }

  /**
   * Rebind an existing participant to a fresh socket without changing room
   * membership. Used for reconnect restore during the server grace window.
   */
  async reconnectParticipant(
    roomId: string,
    userId: string,
    userName: string,
    socket: WebSocket,
  ): Promise<boolean> {
    const room = await this.storage.getRoom(roomId);
    if (!room) {
      return false;
    }

    const boundRoomId = await this.storage.getUserRoom(userId);
    if (boundRoomId !== roomId) {
      return false;
    }

    const existing = await this.storage.getParticipant(roomId, userId);
    if (!existing) {
      return false;
    }

    return await this.storage.setParticipant(roomId, userId, {
      userId,
      userName,
      socket,
    });
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
          this.emitError(
            new AvesError({ message: `Failed to send broadcast to user ${userId}`, code: "SERVER_ERROR", stage: "transport", retryable: true }),
          );
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
      this.emitError(
        new AvesError({ message: `sendToUser failed: user ${userId} not found in any room`, code: "SIGNALING_TARGET_NOT_FOUND", stage: "signaling", retryable: false }),
      );
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
        this.emitError(
          new AvesError({ message: `Failed to send message to user ${userId}`, code: "SERVER_ERROR", stage: "transport", retryable: true }),
        );
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

/**
 * Hash a password using scrypt with a random salt.
 * Returns "salt:hash" as a hex-encoded string.
 */
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(HASH_SALT_LENGTH);
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, HASH_LENGTH, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt.toString("hex")}${HASH_DELIMITER}${derivedKey.toString("hex")}`);
    });
  });
}

/**
 * Verify a password against a stored "salt:hash" string.
 */
async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const delimiterIndex = stored.indexOf(HASH_DELIMITER);
  if (delimiterIndex === -1) {
    // Legacy plain-text password: fall back to direct comparison
    return password === stored;
  }

  const saltHex = stored.slice(0, delimiterIndex);
  const hashHex = stored.slice(delimiterIndex + 1);

  const salt = Buffer.from(saltHex, "hex");
  const expectedHash = Buffer.from(hashHex, "hex");

  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, HASH_LENGTH, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(crypto.timingSafeEqual(derivedKey, expectedHash));
    });
  });
}
