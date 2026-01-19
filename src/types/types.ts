// Shared types for aves-node
import { WebSocket } from "ws";

export interface Participant {
  id: string;
  name: string;
}

export interface AvesServerConfig {
  debug?: boolean;
  roomTimeout?: number;
}

export interface RoomInfo {
  id: string;
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
  participants: Map<string, ParticipantInfo>;
  createdAt: number;
}

// Signaling message types
export type SignalingMessage =
  | { type: "create-room" }
  | { type: "room-created"; roomId: string }
  | { type: "join-room"; roomId: string; userId: string; userName: string }
  | { type: "room-joined"; participants: Participant[] }
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
