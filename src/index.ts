/**
 * aves-node - WebRTC signaling server library
 *
 * Main exports for the aves-node package
 */

// Main server class
export { AvesServer } from "./core/AvesServer";

// Core components (for advanced usage)
export { RoomManager } from "./core/RoomManager";
export { SignalingHandler } from "./core/SignalingHandler";

// Storage interfaces and implementations
export type { IDataStorage } from "./storage/IDataStorage";
export { BaseStorage } from "./storage/BaseStorage";
export { MemoryStorage } from "./storage/MemoryStorage";
export { RedisStorage } from "./storage/RedisStorage";

// Storage events for user-defined persistence
export type {
  DataChangeType,
  DataChangeEvent,
  RoomCreateEvent,
  RoomUpdateEvent,
  RoomDeleteEvent,
  ParticipantJoinEvent,
  ParticipantLeaveEvent,
  UserBindRoomEvent,
  UserUnbindRoomEvent,
  StorageEvent,
  RoomData,
  ParticipantData,
  BeforeChangeCallback,
  AfterChangeCallback,
  IStorageEventListener,
} from "./storage/StorageEvents";
export { toRoomData, toParticipantData } from "./storage/StorageEvents";

// Type definitions
export type {
  Participant,
  AvesServerConfig,
  RedisConfig,
  RoomInfo,
  ParticipantInfo,
  Room,
  CreateRoomOptions,
  InboundSignalingMessage,
  OutboundSignalingMessage,
  SignalingMessage,
  SignalingErrorCode,
  SignalingErrorStage,
  SignalingErrorPayload,
  RTCSessionDescriptionInit,
  RTCIceCandidateInit,
} from "./types/types";
