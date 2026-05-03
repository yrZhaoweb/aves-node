import { Room, ParticipantInfo } from "../types/types";

export interface IDataStorage {
  setRoom(roomId: string, room: Room): Promise<void>;
  getRoom(roomId: string): Promise<Room | null>;
  deleteRoom(roomId: string): Promise<void>;
  getAllRooms(): Promise<Room[]>;
  roomExists(roomId: string): Promise<boolean>;

  /**
   * Atomically bind a user to a room.
   * Returns true if the binding was created; false if the user is already
   * bound to a room (the binding was not created).
   */
  setUserRoom(userId: string, roomId: string): Promise<boolean>;
  getUserRoom(userId: string): Promise<string | null>;
  deleteUserRoom(userId: string): Promise<void>;

  setParticipant(
    roomId: string,
    userId: string,
    participant: ParticipantInfo,
  ): Promise<boolean>;
  getParticipant(
    roomId: string,
    userId: string,
  ): Promise<ParticipantInfo | null>;
  deleteParticipant(roomId: string, userId: string): Promise<void>;
  getAllParticipants(roomId: string): Promise<Map<string, ParticipantInfo>>;

  close?(): void | Promise<void>;
}
