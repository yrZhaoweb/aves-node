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

// Type definitions
export type {
  Participant,
  AvesServerConfig,
  RoomInfo,
  ParticipantInfo,
  Room,
  SignalingMessage,
  RTCSessionDescriptionInit,
  RTCIceCandidateInit,
} from "./types/types";
