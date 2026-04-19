// Shared types for aves-node
import { WebSocket } from "ws";
import { Redis } from "ioredis";

export interface Participant {
  id: string;
  name: string;
}

export type SignalingErrorCode =
  | "INVALID_MESSAGE_FORMAT"
  | "INVALID_MESSAGE"
  | "ROOM_NOT_FOUND"
  | "ROOM_CREATE_FAILED"
  | "ROOM_JOIN_FAILED"
  | "JOIN_ROOM_MISSING_FIELDS"
  | "ALREADY_JOINED"
  | "LEAVE_NOT_JOINED"
  | "LEAVE_USER_MISMATCH"
  | "SIGNALING_NOT_AUTHENTICATED"
  | "SIGNALING_FORBIDDEN"
  | "SIGNALING_TARGET_NOT_FOUND"
  | "SIGNALING_TARGET_ROOM_MISMATCH"
  | "SERVER_ERROR"
  | (string & {});

export type SignalingErrorStage =
  | "protocol"
  | "room"
  | "signaling"
  | "transport"
  | "server"
  | (string & {});

export interface SignalingErrorPayload {
  message: string;
  code: SignalingErrorCode;
  stage: SignalingErrorStage;
  retryable: boolean;
  requestId?: string;
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
  | { type: "create-room"; options?: CreateRoomOptions; requestId?: string }
  | {
      type: "join-room";
      roomId: string;
      userId?: string;
      userName: string;
      password?: string;
      requestId?: string;
    }
  | { type: "leave-room"; userId: string; requestId?: string }
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
  | { type: "room-created"; roomId: string; requestId?: string }
  | {
      type: "room-joined";
      participants: Participant[];
      userId: string;
      requestId?: string;
    }
  | { type: "room-left"; roomId: string; userId: string; requestId?: string }
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
  | ({ type: "error" } & SignalingErrorPayload);

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
