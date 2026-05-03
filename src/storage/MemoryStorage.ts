import { Room, ParticipantInfo } from "../types/types";
import { BaseStorage } from "./BaseStorage";

export class MemoryStorage extends BaseStorage {
  private rooms: Map<string, Room> = new Map();
  private userToRoom: Map<string, string> = new Map();

  async setRoom(roomId: string, room: Room): Promise<void> {
    const existing = this.rooms.get(roomId);
    const event = existing
      ? this.createRoomUpdateEvent(roomId, existing, room)
      : this.createRoomCreateEvent(roomId, room);

    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return;

    this.rooms.set(roomId, room);
    await this.emitAfterChange(event);
  }

  async getRoom(roomId: string): Promise<Room | null> {
    return this.rooms.get(roomId) || null;
  }

  async deleteRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const event = this.createRoomDeleteEvent(roomId, room);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return;

    this.rooms.delete(roomId);
    await this.emitAfterChange(event);
  }

  async getAllRooms(): Promise<Room[]> {
    return Array.from(this.rooms.values());
  }

  async roomExists(roomId: string): Promise<boolean> {
    return this.rooms.has(roomId);
  }

  async setUserRoom(userId: string, roomId: string): Promise<boolean> {
    if (this.userToRoom.has(userId)) {
      return false;
    }

    const event = this.createUserBindRoomEvent(userId, roomId);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return false;

    this.userToRoom.set(userId, roomId);
    await this.emitAfterChange(event);
    return true;
  }

  async getUserRoom(userId: string): Promise<string | null> {
    return this.userToRoom.get(userId) || null;
  }

  async deleteUserRoom(userId: string): Promise<void> {
    const roomId = this.userToRoom.get(userId);
    if (!roomId) return;

    const event = this.createUserUnbindRoomEvent(userId, roomId);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return;

    this.userToRoom.delete(userId);
    await this.emitAfterChange(event);
  }

  async setParticipant(
    roomId: string,
    userId: string,
    participant: ParticipantInfo,
  ): Promise<boolean> {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const event = this.createParticipantJoinEvent(roomId, userId, participant);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return false;

    room.participants.set(userId, participant);
    await this.emitAfterChange(event);
    return true;
  }

  async getParticipant(
    roomId: string,
    userId: string,
  ): Promise<ParticipantInfo | null> {
    const room = this.rooms.get(roomId);
    return room?.participants.get(userId) || null;
  }

  async deleteParticipant(roomId: string, userId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const participant = room.participants.get(userId);
    if (!participant) return;

    const event = this.createParticipantLeaveEvent(roomId, userId, participant);
    const shouldProceed = await this.emitBeforeChange(event);
    if (!shouldProceed) return;

    room.participants.delete(userId);
    await this.emitAfterChange(event);
  }

  async getAllParticipants(
    roomId: string,
  ): Promise<Map<string, ParticipantInfo>> {
    const room = this.rooms.get(roomId);
    // Return a shallow copy to prevent external modifications affecting internal state
    return room ? new Map(room.participants) : new Map();
  }
}
