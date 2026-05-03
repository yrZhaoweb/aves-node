import { Room, ParticipantInfo } from "../types/types";
import { IDataStorage } from "./IDataStorage";
import {
  IStorageEventListener,
  StorageEvent,
  RoomCreateEvent,
  RoomUpdateEvent,
  RoomDeleteEvent,
  ParticipantJoinEvent,
  ParticipantLeaveEvent,
  UserBindRoomEvent,
  UserUnbindRoomEvent,
  toRoomData,
  toParticipantData,
} from "./StorageEvents";

/**
 * Abstract base storage class with event support
 * Provides hooks for before/after data changes to enable user-defined persistence
 */
export abstract class BaseStorage implements IDataStorage {
  private listeners: IStorageEventListener[] = [];

  /**
   * Add an event listener for data changes
   */
  addListener(listener: IStorageEventListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove an event listener
   */
  removeListener(listener: IStorageEventListener): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Clear all listeners
   */
  clearListeners(): void {
    this.listeners = [];
  }

  /**
   * Emit before-change event to all listeners
   * Returns false if any listener cancels the operation
   */
  protected async emitBeforeChange(event: StorageEvent): Promise<boolean> {
    for (const listener of this.listeners) {
      if (listener.onBeforeChange) {
        const result = await listener.onBeforeChange(event);
        if (result === false) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Emit after-change event to all listeners
   */
  protected async emitAfterChange(event: StorageEvent): Promise<void> {
    for (const listener of this.listeners) {
      if (listener.onAfterChange) {
        await listener.onAfterChange(event);
      }
    }
  }

  /**
   * Create a timestamp for events
   */
  protected now(): number {
    return Date.now();
  }

  /**
   * Create a room create event
   */
  protected createRoomCreateEvent(roomId: string, room: Room): RoomCreateEvent {
    return {
      type: "room:create",
      timestamp: this.now(),
      roomId,
      room: toRoomData(room),
    };
  }

  /**
   * Create a room update event
   */
  protected createRoomUpdateEvent(
    roomId: string,
    before: Room | null,
    after: Room,
  ): RoomUpdateEvent {
    return {
      type: "room:update",
      timestamp: this.now(),
      roomId,
      before: before ? toRoomData(before) : null,
      after: toRoomData(after),
    };
  }

  /**
   * Create a room delete event
   */
  protected createRoomDeleteEvent(roomId: string, room: Room): RoomDeleteEvent {
    return {
      type: "room:delete",
      timestamp: this.now(),
      roomId,
      room: toRoomData(room),
    };
  }

  /**
   * Create a participant join event
   */
  protected createParticipantJoinEvent(
    roomId: string,
    userId: string,
    participant: ParticipantInfo,
  ): ParticipantJoinEvent {
    return {
      type: "participant:join",
      timestamp: this.now(),
      roomId,
      userId,
      participant: toParticipantData(participant),
    };
  }

  /**
   * Create a participant leave event
   */
  protected createParticipantLeaveEvent(
    roomId: string,
    userId: string,
    participant: ParticipantInfo,
  ): ParticipantLeaveEvent {
    return {
      type: "participant:leave",
      timestamp: this.now(),
      roomId,
      userId,
      participant: toParticipantData(participant),
    };
  }

  /**
   * Create a user bind room event
   */
  protected createUserBindRoomEvent(
    userId: string,
    roomId: string,
  ): UserBindRoomEvent {
    return {
      type: "user:bindRoom",
      timestamp: this.now(),
      userId,
      roomId,
    };
  }

  /**
   * Create a user unbind room event
   */
  protected createUserUnbindRoomEvent(
    userId: string,
    roomId: string,
  ): UserUnbindRoomEvent {
    return {
      type: "user:unbindRoom",
      timestamp: this.now(),
      userId,
      roomId,
    };
  }

  // Abstract methods to be implemented by subclasses
  abstract setRoom(roomId: string, room: Room): Promise<void>;
  abstract getRoom(roomId: string): Promise<Room | null>;
  abstract deleteRoom(roomId: string): Promise<void>;
  abstract getAllRooms(): Promise<Room[]>;
  abstract roomExists(roomId: string): Promise<boolean>;

  abstract setUserRoom(userId: string, roomId: string): Promise<boolean>;
  abstract getUserRoom(userId: string): Promise<string | null>;
  abstract deleteUserRoom(userId: string): Promise<void>;

  abstract setParticipant(
    roomId: string,
    userId: string,
    participant: ParticipantInfo,
  ): Promise<boolean>;
  abstract getParticipant(
    roomId: string,
    userId: string,
  ): Promise<ParticipantInfo | null>;
  abstract deleteParticipant(roomId: string, userId: string): Promise<void>;
  abstract getAllParticipants(
    roomId: string,
  ): Promise<Map<string, ParticipantInfo>>;
}
