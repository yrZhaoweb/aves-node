// Shared types for aves-node
import { WebSocket } from "ws";
import { Redis } from "ioredis";

export interface Participant {
  id: string;
  name: string;
}

export interface RedisConfig {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
}

export interface AvesServerConfig {
  debug?: boolean;
  roomTimeout?: number;
  redis?: Redis | RedisConfig;
}

export interface RoomInfo {
  id: string;
  name?: string;
  maxCapacity?: number;
  hasPassword: boolean;
  participantCount: number;
  createdAt: number;
}

// Internal types
export interface ParticipantInfo {
  userId: string;
  userName: string;
  socket: WebSocket;
}

export interface Room {
  id: string;
  name?: string;
  maxCapacity?: number;
  password?: string;
  participants: Map<string, ParticipantInfo>;
  createdAt: number;
}

export interface CreateRoomOptions {
  name?: string;
  maxCapacity?: number;
  password?: string;
}

// Inbound signaling message types (client -> server)
export type InboundSignalingMessage =
  | { type: "create-room"; options?: CreateRoomOptions }
  | {
      type: "join-room";
      roomId: string;
      userId?: string;
      userName: string;
      password?: string;
    }
  | { type: "leave-room"; userId: string }
  | {
      type: "offer";
      fromId: string;
      targetId: string;
      offer: RTCSessionDescriptionInit;
    }
  | {
      type: "answer";
      fromId: string;
      targetId: string;
      answer: RTCSessionDescriptionInit;
    }
  | {
      type: "ice-candidate";
      fromId: string;
      targetId: string;
      candidate: RTCIceCandidateInit;
    };

// Outbound signaling message types (server -> client)
export type OutboundSignalingMessage =
  | { type: "room-created"; roomId: string }
  | { type: "room-joined"; participants: Participant[]; userId: string }
  | { type: "user-joined"; user: Participant }
  | { type: "user-left"; userId: string }
  | {
      type: "offer";
      fromId: string;
      targetId: string;
      offer: RTCSessionDescriptionInit;
    }
  | {
      type: "answer";
      fromId: string;
      targetId: string;
      answer: RTCSessionDescriptionInit;
    }
  | {
      type: "ice-candidate";
      fromId: string;
      targetId: string;
      candidate: RTCIceCandidateInit;
    }
  | { type: "error"; message: string };

// Combined signaling message type (for backward compatibility)
export type SignalingMessage =
  | InboundSignalingMessage
  | OutboundSignalingMessage;

// WebRTC types (for server-side type checking)
export interface RTCSessionDescriptionInit {
  type: "offer" | "answer";
  sdp: string;
}

export interface RTCIceCandidateInit {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}
