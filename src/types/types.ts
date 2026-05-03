// Shared types for aves-node
import { WebSocket } from "ws";

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

export type RedisMessageListener = (channel: string, payload: string) => void;

export interface RedisPipelineLike {
  hgetall(key: string): RedisPipelineLike;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

export interface RedisClientLike {
  duplicate(): RedisClientLike;
  on(event: "message", listener: RedisMessageListener): unknown;
  removeListener(event: "message", listener: RedisMessageListener): unknown;
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  quit(): Promise<unknown>;
  publish(channel: string, payload: string): Promise<unknown>;
  hset(key: string, values: Record<string, string>): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  del(...keys: string[]): Promise<unknown>;
  srem(key: string, ...members: string[]): Promise<unknown>;
  sismember(key: string, member: string): Promise<number>;
  set(key: string, value: string, mode: "NX"): Promise<"OK" | null>;
  get(key: string): Promise<string | null>;
  pipeline(): RedisPipelineLike;
}

export interface MongoCursorLike<TDocument = any> {
  toArray(): Promise<TDocument[]>;
}

export interface MongoCollectionLike<TDocument = any> {
  createIndex(index: any, options?: any): Promise<string>;
  replaceOne(
    filter: any,
    replacement: any,
    options?: any,
  ): Promise<unknown>;
  updateOne(
    filter: any,
    update: any,
    options?: any,
  ): Promise<{ upsertedCount?: number }>;
  findOne(filter: any): Promise<any | null>;
  find(filter?: any): MongoCursorLike<any>;
  deleteOne(filter: any): Promise<unknown>;
  deleteMany(filter: any): Promise<unknown>;
}

export interface MongoDbLike {
  collection<TDocument>(name: string): MongoCollectionLike<TDocument>;
}

export interface MongoClientLike {
  connect(): Promise<unknown>;
  db(dbName?: string): MongoDbLike;
  close(): Promise<unknown>;
}

export interface MongoConfig {
  /** MongoDB connection string. Used when client/db is not provided. */
  uri?: string;
  /** Database name. Defaults to "aves". */
  dbName?: string;
  /** Prefix for collections. Defaults to "aves". */
  collectionPrefix?: string;
  /** Preconfigured MongoClient. The server does not close injected clients by default. */
  client?: MongoClientLike;
  /** Preconfigured MongoDB database. */
  db?: MongoDbLike;
  /** Close an injected client when AvesServer.close() is called. Default false. */
  closeClientOnClose?: boolean;
}

export interface AvesServerConfig {
  debug?: boolean;
  /** Milliseconds before an empty room is automatically deleted. 0 = never. */
  roomTimeout?: number;
  redis?: RedisClientLike | RedisConfig;
  mongo?: MongoConfig;
  /** Token-bucket rate limiting configuration. */
  rateLimit?: {
    maxTokens?: number;
    refillRate?: number;
  };
  /** Maximum incoming WebSocket message size in bytes. Default 65536. */
  maxMessageSize?: number;
  /** Optional structured logger for production observability. */
  logger?: AvesLogger;
}

export interface AvesLogger {
  debug?: (message: string, context?: Record<string, unknown>) => void;
  info?: (message: string, context?: Record<string, unknown>) => void;
  warn?: (message: string, context?: Record<string, unknown>) => void;
  error?: (message: string, context?: Record<string, unknown>) => void;
}

export interface RoomInfo {
  id: string;
  name?: string;
  maxCapacity?: number;
  hasPassword: boolean;
  participantCount: number;
  createdAt: number;
}

/** Server health status returned by AvesServer.getHealth(). */
export interface HealthStatus {
  /** Number of active WebSocket connections. */
  connections: number;
  /** Total number of rooms (including empty ones not yet cleaned up). */
  rooms: number;
  /** Storage backend type. */
  storage: "memory" | "redis" | "mongodb";
  /** Configured room timeout in milliseconds. 0 = never. */
  roomTimeout: number;
  /** Server uptime in milliseconds since construction. */
  uptime: number;
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
