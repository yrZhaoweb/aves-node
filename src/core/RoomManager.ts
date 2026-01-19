import { WebSocket } from "ws";
import {
  Room,
  ParticipantInfo,
  Participant,
  RoomInfo,
  SignalingMessage,
} from "../types/types";

/**
 * RoomManager handles room lifecycle and participant management
 */
export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private userToRoom: Map<string, string> = new Map();
  private roomIdCounter: number = 0;

  /**
   * Create a new room and return its unique ID
   */
  createRoom(): string {
    const roomId = this.generateRoomId();
    const room: Room = {
      id: roomId,
      participants: new Map(),
      createdAt: Date.now(),
    };
    this.rooms.set(roomId, room);
    return roomId;
  }

  /**
   * Add a user to a room
   * @returns true if successful, false if room doesn't exist
   */
  joinRoom(
    roomId: string,
    userId: string,
    userName: string,
    socket: WebSocket
  ): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    const participantInfo: ParticipantInfo = {
      userId,
      userName,
      socket,
    };

    room.participants.set(userId, participantInfo);
    this.userToRoom.set(userId, roomId);

    return true;
  }

  /**
   * Remove a user from a room
   * Automatically deletes the room if it becomes empty
   */
  leaveRoom(roomId: string, userId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    room.participants.delete(userId);
    this.userToRoom.delete(userId);

    // Auto-cleanup empty rooms
    if (room.participants.size === 0) {
      this.rooms.delete(roomId);
    }
  }

  /**
   * Get the list of participants in a room
   */
  getRoomParticipants(roomId: string): Participant[] {
    const room = this.rooms.get(roomId);
    if (!room) {
      return [];
    }

    return Array.from(room.participants.values()).map((p) => ({
      id: p.userId,
      name: p.userName,
    }));
  }

  /**
   * Check if a room exists
   */
  roomExists(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  /**
   * Broadcast a message to all participants in a room
   * @param excludeUserId Optional user ID to exclude from broadcast
   */
  broadcastToRoom(
    roomId: string,
    message: SignalingMessage,
    excludeUserId?: string
  ): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const messageStr = JSON.stringify(message);

    room.participants.forEach((participant, userId) => {
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
  sendToUser(userId: string, message: SignalingMessage): void {
    const roomId = this.userToRoom.get(userId);
    if (!roomId) {
      console.warn(`User ${userId} not found in any room`);
      return;
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const participant = room.participants.get(userId);
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
  getRoomIdByUserId(userId: string): string | undefined {
    return this.userToRoom.get(userId);
  }

  /**
   * Get room information
   */
  getRoomInfo(roomId: string): RoomInfo | null {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    return {
      id: room.id,
      participantCount: room.participants.size,
      createdAt: room.createdAt,
    };
  }

  /**
   * Get all rooms information
   */
  getAllRooms(): RoomInfo[] {
    return Array.from(this.rooms.values()).map((room) => ({
      id: room.id,
      participantCount: room.participants.size,
      createdAt: room.createdAt,
    }));
  }

  /**
   * Generate a unique room ID
   */
  private generateRoomId(): string {
    this.roomIdCounter++;
    return `room-${Date.now()}-${this.roomIdCounter}`;
  }
}
