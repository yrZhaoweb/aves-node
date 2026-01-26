import { Room, ParticipantInfo } from "../types/types";

/**
 * Data change event types
 */
export type DataChangeType =
  | "room:create"
  | "room:update"
  | "room:delete"
  | "participant:join"
  | "participant:leave"
  | "user:bindRoom"
  | "user:unbindRoom";

/**
 * Base interface for all data change events
 */
export interface DataChangeEvent {
  type: DataChangeType;
  timestamp: number;
}

/**
 * Room-related change events
 */
export interface RoomCreateEvent extends DataChangeEvent {
  type: "room:create";
  roomId: string;
  room: RoomData;
}

export interface RoomUpdateEvent extends DataChangeEvent {
  type: "room:update";
  roomId: string;
  before: RoomData | null;
  after: RoomData;
}

export interface RoomDeleteEvent extends DataChangeEvent {
  type: "room:delete";
  roomId: string;
  room: RoomData;
}

/**
 * Participant-related change events
 */
export interface ParticipantJoinEvent extends DataChangeEvent {
  type: "participant:join";
  roomId: string;
  userId: string;
  participant: ParticipantData;
}

export interface ParticipantLeaveEvent extends DataChangeEvent {
  type: "participant:leave";
  roomId: string;
  userId: string;
  participant: ParticipantData;
}

/**
 * User-room binding events
 */
export interface UserBindRoomEvent extends DataChangeEvent {
  type: "user:bindRoom";
  userId: string;
  roomId: string;
}

export interface UserUnbindRoomEvent extends DataChangeEvent {
  type: "user:unbindRoom";
  userId: string;
  roomId: string;
}

/**
 * Union type for all storage events
 */
export type StorageEvent =
  | RoomCreateEvent
  | RoomUpdateEvent
  | RoomDeleteEvent
  | ParticipantJoinEvent
  | ParticipantLeaveEvent
  | UserBindRoomEvent
  | UserUnbindRoomEvent;

/**
 * Serializable room data (without WebSocket)
 */
export interface RoomData {
  id: string;
  name?: string;
  maxCapacity?: number;
  password?: string;
  participantCount: number;
  createdAt: number;
}

/**
 * Serializable participant data (without WebSocket)
 */
export interface ParticipantData {
  userId: string;
  userName: string;
}

/**
 * Callback type for before-change hooks
 * Return false to cancel the operation
 */
export type BeforeChangeCallback = (
  event: StorageEvent,
) => Promise<boolean> | boolean;

/**
 * Callback type for after-change hooks
 */
export type AfterChangeCallback = (event: StorageEvent) => Promise<void> | void;

/**
 * Storage event listener interface
 */
export interface IStorageEventListener {
  /**
   * Called before a data change occurs
   * Return false to cancel the operation
   */
  onBeforeChange?: BeforeChangeCallback;

  /**
   * Called after a data change has been committed
   */
  onAfterChange?: AfterChangeCallback;
}

/**
 * Helper function to convert Room to serializable RoomData
 */
export function toRoomData(room: Room): RoomData {
  return {
    id: room.id,
    name: room.name,
    maxCapacity: room.maxCapacity,
    password: room.password,
    participantCount: room.participants.size,
    createdAt: room.createdAt,
  };
}

/**
 * Helper function to convert ParticipantInfo to serializable ParticipantData
 */
export function toParticipantData(
  participant: ParticipantInfo,
): ParticipantData {
  return {
    userId: participant.userId,
    userName: participant.userName,
  };
}
