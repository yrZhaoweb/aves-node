# aves-node API Reference

**Package:** `@yrzhao/aves-node` (v1.1.0)

aves-node provides a WebRTC signaling server for Node.js. It coordinates room management and signaling message forwarding over WebSocket. The server never relays WebRTC media traffic — it only facilitates peer discovery and SDP/ICE exchange.

---

## Table of Contents

- [AvesServer](#avesserver)
- [AvesServerConfig](#avesserverconfig)
- [RoomManager](#roommanager)
- [SignalingHandler](#signalinghandler)
- [RateLimiter](#ratelimiter)
- [Storage](#storage)
  - [IDataStorage](#idatastorage)
  - [BaseStorage](#basestorage)
  - [MemoryStorage](#memorystorage)
  - [RedisStorage](#redisstorage)
- [Types](#types)
- [Error Codes and Stages](#error-codes-and-stages)
- [Protocol Reference](#protocol-reference)

---

## AvesServer

The main class. It orchestrates `RoomManager` and `SignalingHandler` to provide full signaling functionality.

```ts
import { AvesServer } from "@yrzhao/aves-node";
import { WebSocketServer } from "ws";

const server = new AvesServer({ debug: true });

const wss = new WebSocketServer({ port: 8080 });
wss.on("connection", (ws, req) => {
  server.handleConnection(ws, req);
});
```

### Constructor

```ts
constructor(config?: AvesServerConfig)
```

Creates a new AvesServer instance. Initializes the storage backend (MemoryStorage by default, RedisStorage if `config.redis` is provided), the RoomManager, the SignalingHandler, the RateLimiter, and a periodic cleanup timer.

### Methods

#### `handleConnection(ws: WebSocket, req?: IncomingMessage): void`

Register a new WebSocket connection. Sets up message routing and connection lifecycle:

- Parses and routes inbound JSON messages by `type` field.
- Enforces rate limiting (token-bucket per IP) and message size limits.
- On close: cleans up the user's room membership and broadcasts `user-left`.
- On error: logs the error.

**Message types routed:**

| type            | handler                        |
|-----------------|--------------------------------|
| `create-room`   | Creates a room, returns ID     |
| `join-room`     | Validates + joins a room       |
| `leave-room`    | Leaves a room                  |
| `offer`         | Forwards SDP offer to peer     |
| `answer`        | Forwards SDP answer to peer    |
| `ice-candidate` | Forwards ICE candidate to peer |

#### `getRoomInfo(roomId: string): Promise<RoomInfo | null>`

Get information about a room: ID, name, max capacity, whether it has a password, participant count, and creation timestamp.

#### `getParticipantCount(roomId: string): Promise<number>`

Get the number of participants currently in a room. Returns 0 if the room does not exist.

#### `getAllRooms(): Promise<RoomInfo[]>`

Get information for all active rooms.

#### `getStorage(): IDataStorage`

Get the storage instance. Use this to attach storage event listeners for custom persistence or auditing.

```ts
const storage = server.getStorage();
storage.addListener({
  onAfterChange: (event) => {
    console.log("Data changed:", event.type);
  },
});
```

#### `getStorageType(): "memory" | "redis" | "mongodb"`

Returns the active storage backend.

#### `getMetrics(): Promise<ServerMetrics>`

Returns operational metrics suitable for monitoring endpoints:

```ts
interface ServerMetrics extends HealthStatus {
  participants: number;
  pendingDisconnects: number;
  rateLimitBuckets: number;
  reconnectGraceMs: number;
  maxMessageSize: number;
}
```

#### `close(): Promise<void>`

Gracefully shut down the server:

1. Stops the periodic cleanup timer.
2. Closes all tracked WebSocket connections.
3. Clears the connection set.
4. Calls `close()` on the storage backend (for RedisStorage this unsubscribes and quits the subscriber client).

Callers may ignore the returned promise for backward compatibility, but production shutdown should `await server.close()`.

---

## AvesServerConfig

```ts
interface AvesServerConfig {
  debug?: boolean;
  /** Milliseconds before an empty room is automatically deleted. 0 = never. */
  roomTimeout?: number;
  redis?: Redis | RedisConfig;
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

interface AvesLogger {
  debug?: (message: string, context?: Record<string, unknown>) => void;
  info?: (message: string, context?: Record<string, unknown>) => void;
  warn?: (message: string, context?: Record<string, unknown>) => void;
  error?: (message: string, context?: Record<string, unknown>) => void;
}
```

### Fields

| Field            | Type                       | Default                    | Description                                              |
|------------------|----------------------------|----------------------------|----------------------------------------------------------|
| `debug`          | `boolean`                  | `false`                    | Enable verbose console logging.                          |
| `roomTimeout`    | `number`                   | `0` (never)                | Milliseconds before an empty room is auto-deleted.       |
| `redis`          | `Redis \| RedisConfig`     | `undefined` (in-memory)    | Enables Redis-backed storage and cross-instance signaling. |
| `rateLimit`      | `{ maxTokens, refillRate }`| `{ maxTokens: 60, refillRate: 10 }` | Token-bucket rate limiter per client IP.       |
| `maxMessageSize` | `number`                   | `65536` (64 KB)            | Maximum incoming WebSocket message size in bytes.        |
| `logger`         | `AvesLogger`               | `console`                  | Structured logger hook for `debug`, `info`, `warn`, and `error` events. |

### Rate Limit Details

The token-bucket algorithm:

- Each client IP starts with `maxTokens` tokens.
- Tokens refill at `refillRate` tokens per second (continuous).
- Each message consumes one token.
- When the bucket is empty, the message is rejected with `SERVER_ERROR` / `retryable: true`.
- `ioredis` is loaded only when `redis` is configured. MemoryStorage users do not need to install it.
- Idle buckets are pruned every 60 seconds (by the periodic cleanup timer).

### RedisConfig

```ts
interface RedisConfig {
  host?: string;     // default "localhost"
  port?: number;     // default 6379
  password?: string;
  db?: number;       // default 0
}
```

---

## RoomManager

Handles room lifecycle (create, join, leave, delete) and participant management. All methods return Promises and delegate data operations to the storage backend.

```ts
import { RoomManager } from "@yrzhao/aves-node";
```

### Constructor

```ts
constructor(storage: IDataStorage)
```

### Methods

#### `createRoom(options?: CreateRoomOptions): Promise<string>`

Create a new room. Generates a unique ID (`room-<16-hex-chars>`). If a password is provided, it is hashed with scrypt (random salt, 64-byte key) before storage.

**CreateRoomOptions:**

```ts
interface CreateRoomOptions {
  name?: string;
  maxCapacity?: number;
  password?: string;
}
```

Returns the generated room ID.

#### `joinRoom(roomId: string, userId: string, userName: string, socket: WebSocket, password?: string): Promise<boolean>`

Add a user to a room. Validation steps:

1. Room must exist.
2. `userId` must be non-empty after trimming.
3. If room has a password, it must match (verified with `crypto.timingSafeEqual` against the stored scrypt hash).
4. Room must not be at `maxCapacity`.
5. User must not already be bound to a room (atomic `setUserRoom` check via storage).

On success, stores the participant and returns `true`. Returns `false` on any validation failure.

#### `leaveRoom(roomId: string, userId: string): Promise<void>`

Remove a user from a room. Cleans up:

1. Deletes the participant from the room.
2. Deletes the user-to-room binding.
3. If the room is now empty, deletes the room entirely.

#### `getRoomParticipants(roomId: string): Promise<Participant[]>`

Returns an array of `{ id, name }` for all participants in a room.

#### `roomExists(roomId: string): Promise<boolean>`

Check whether a room exists.

#### `broadcastToRoom(roomId: string, message: SignalingMessage, excludeUserId?: string): Promise<void>`

Send a JSON message to all participants in a room. Optionally exclude one user (used to avoid echoing back to the sender). Skips sockets that are not in `OPEN` state.

#### `sendToUser(userId: string, message: SignalingMessage): Promise<void>`

Send a JSON message to a specific user by their userId. Looks up the user's room and socket via storage.

#### `getRoomIdByUserId(userId: string): Promise<string | null>`

Get the room ID a user is currently in. Returns `null` if the user is not in any room.

#### `getRoomInfo(roomId: string): Promise<RoomInfo | null>`

Get public room info (no password hash exposed).

#### `getAllRooms(): Promise<RoomInfo[]>`

Get public info for every room.

---

## SignalingHandler

Validates and forwards WebRTC signaling messages (SDP offers/answers and ICE candidates) between peers in a room.

```ts
import { SignalingHandler } from "@yrzhao/aves-node";
```

### Constructor

```ts
constructor(roomManager: RoomManager)
```

### Methods

#### `handleOffer(fromId: string, targetId: string, offer: RTCSessionDescriptionInit): Promise<void>`

Validates the offer (must be an object with `type: "offer"` and a non-empty `sdp` string), then forwards it to `targetId` via `RoomManager.sendToUser`.

#### `handleAnswer(fromId: string, targetId: string, answer: RTCSessionDescriptionInit): Promise<void>`

Validates the answer (must be an object with `type: "answer"` and a non-empty `sdp` string), then forwards it to `targetId`.

#### `handleIceCandidate(fromId: string, targetId: string, candidate: RTCIceCandidateInit): Promise<void>`

Validates the ICE candidate (must be an object with a non-empty `candidate` string), then forwards it to `targetId`.


---
## RateLimiter

Token-bucket rate limiter per client key (typically IP address).

```ts
import { RateLimiter } from "@yrzhao/aves-node";
```

### Constructor

```ts
constructor(maxTokens: number = 60, refillRate: number = 10)
```

### Methods

#### `consume(key: string): boolean`

Attempt to consume one token. Returns `true` if the request is allowed, `false` if rate-limited. Automatically refills tokens based on elapsed time.

#### `prune(olderThanMs: number = 60_000): void`

Remove buckets that haven't been accessed recently. Called automatically by the server's periodic cleanup timer (every 60 seconds).

---

## Storage

aves-node uses a pluggable storage layer. The default is in-memory; Redis is available for multi-instance deployments.

### IDataStorage

```ts
interface IDataStorage {
  setRoom(roomId: string, room: Room): Promise<void>;
  getRoom(roomId: string): Promise<Room | null>;
  deleteRoom(roomId: string): Promise<void>;
  getAllRooms(): Promise<Room[]>;
  roomExists(roomId: string): Promise<boolean>;

  /** Atomically bind a user to a room. Returns false if already bound. */
  setUserRoom(userId: string, roomId: string): Promise<boolean>;
  getUserRoom(userId: string): Promise<string | null>;
  deleteUserRoom(userId: string): Promise<void>;

  setParticipant(roomId: string, userId: string, participant: ParticipantInfo): Promise<boolean>;
  getParticipant(roomId: string, userId: string): Promise<ParticipantInfo | null>;
  deleteParticipant(roomId: string, userId: string): Promise<void>;
  getAllParticipants(roomId: string): Promise<Map<string, ParticipantInfo>>;

  /** Optional cleanup method. Called by AvesServer.close(). */
  close?(): void | Promise<void>;
}
```

### BaseStorage

Abstract base class that implements `IDataStorage` and adds storage event hook support. Subclasses (`MemoryStorage`, `RedisStorage`) implement the actual data operations.

**Methods for event management:**

| Method                                    | Description                                     |
|-------------------------------------------|-------------------------------------------------|
| `addListener(listener)`                   | Register a storage event listener.              |
| `removeListener(listener)`                | Unregister a previously added listener.         |
| `clearListeners()`                        | Remove all registered listeners.                |

See [STORAGE_EVENTS.md](./STORAGE_EVENTS.md) for details on events.

### MemoryStorage

In-memory storage using `Map` objects. Data is lost on server restart. Suitable for single-instance development and testing.

- Uses `Map<string, Room>` for rooms.
- Uses `Map<string, string>` for user-to-room bindings.
- `getAllParticipants` returns a shallow copy of the participants map (prevents external mutation of internal state).

### RedisStorage

Redis-backed storage for multi-instance deployments. Stores room data, participants, and user bindings in Redis hashes and sets.

**Key naming convention:** `{prefix}:{type}:{...segments}`

| Key pattern                                        | Type    | Purpose                          |
|----------------------------------------------------|---------|----------------------------------|
| `{prefix}:rooms`                                   | Set     | All room IDs                     |
| `{prefix}:room:{roomId}`                           | Hash    | Room metadata (id, name, etc.)   |
| `{prefix}:room:{roomId}:participants`              | Set     | Participant user IDs in a room   |
| `{prefix}:room:{roomId}:participant:{userId}`      | Hash    | Participant record               |
| `{prefix}:user:{userId}:room`                      | String  | Room binding for a user          |

**Cross-instance signaling:** Each instance subscribes to its own Redis pub/sub channel (`{prefix}:instance:{instanceId}:signals`). When a participant's WebSocket lives on a different instance, a virtual socket object publishes the message to that instance's channel.

See [REDIS.md](./REDIS.md) for details.

---

## Types

### Room

```ts
interface Room {
  id: string;
  name?: string;
  maxCapacity?: number;
  password?: string;           // scrypt hash "salt:key"
  participants: Map<string, ParticipantInfo>;
  createdAt: number;           // Date.now()
}
```

### RoomInfo

```ts
interface RoomInfo {
  id: string;
  name?: string;
  maxCapacity?: number;
  hasPassword: boolean;
  participantCount: number;
  createdAt: number;
}
```

### ParticipantInfo

```ts
interface ParticipantInfo {
  userId: string;
  userName: string;
  socket: WebSocket;
}
```

### Participant (Public)

```ts
interface Participant {
  id: string;
  name: string;
}
```

### SignalingMessage

Union of all inbound and outbound message types.

### InboundSignalingMessage (Client to Server)

```ts
type InboundSignalingMessage =
  | { type: "create-room"; options?: CreateRoomOptions; requestId?: string }
  | { type: "join-room"; roomId: string; userId?: string; userName: string; password?: string; requestId?: string }
  | { type: "leave-room"; userId: string; requestId?: string }
  | { type: "offer"; fromId: string; targetId: string; offer: RTCSessionDescriptionInit }
  | { type: "answer"; fromId: string; targetId: string; answer: RTCSessionDescriptionInit }
  | { type: "ice-candidate"; fromId: string; targetId: string; candidate: RTCIceCandidateInit }
```

### OutboundSignalingMessage (Server to Client)

```ts
type OutboundSignalingMessage =
  | { type: "room-created"; roomId: string; requestId?: string }
  | { type: "room-joined"; participants: Participant[]; userId: string; requestId?: string }
  | { type: "room-left"; roomId: string; userId: string; requestId?: string }
  | { type: "user-joined"; user: Participant }
  | { type: "user-left"; userId: string }
  | { type: "offer"; fromId: string; targetId: string; offer: RTCSessionDescriptionInit }
  | { type: "answer"; fromId: string; targetId: string; answer: RTCSessionDescriptionInit }
  | { type: "ice-candidate"; fromId: string; targetId: string; candidate: RTCIceCandidateInit }
  | ({ type: "error" } & SignalingErrorPayload)
```

### SignalingErrorPayload

```ts
interface SignalingErrorPayload {
  message: string;
  code: SignalingErrorCode;
  stage: SignalingErrorStage;
  retryable: boolean;
  requestId?: string;
}
```

---

## Error Codes and Stages

Errors are delivered as outbound messages with `type: "error"`. Every error includes:

- `code` -- A machine-readable error code.
- `stage` -- Which subsystem the error originated from.
- `retryable` -- Whether the client can reasonably retry the operation.

### Error Codes

| Code                            | Stage        | Description                                         |
|---------------------------------|--------------|-----------------------------------------------------|
| `SERVER_ERROR`                  | `protocol`   | Rate limit exceeded.                                |
| `INVALID_MESSAGE_FORMAT`        | `protocol`   | Message too large or not valid JSON.                |
| `INVALID_MESSAGE`               | `protocol`   | Unknown or missing `type` field; or missing fields. |
| `ALREADY_JOINED`                | `room`       | Connection already joined a room.                   |
| `JOIN_ROOM_MISSING_FIELDS`      | `room`       | `roomId` or `userName` missing.                     |
| `ROOM_NOT_FOUND`                | `room`       | Room does not exist.                                |
| `ROOM_JOIN_FAILED`              | `room`       | Wrong password or room is full.                     |
| `LEAVE_NOT_JOINED`              | `room`       | User is not in any room.                            |
| `LEAVE_USER_MISMATCH`           | `room`       | `userId` does not match authenticated connection.   |
| `SIGNALING_NOT_AUTHENTICATED`   | `signaling`  | User must join a room before signaling.             |
| `SIGNALING_FORBIDDEN`           | `signaling`  | `fromId` does not match the authenticated user.     |
| `SIGNALING_TARGET_NOT_FOUND`    | `signaling`  | Target user is not in any room.                     |
| `SIGNALING_TARGET_ROOM_MISMATCH`| `signaling`  | Sender and target are in different rooms.           |

### Error Stages

| Stage        | Meaning                                  |
|--------------|------------------------------------------|
| `protocol`   | Message parsing or rate-limiting issue.  |
| `room`       | Room join/leave lifecycle issue.         |
| `signaling`  | WebRTC signaling authorization issue.    |

---

## Protocol Reference

### Message Flow

```
Client A                    Server                  Client B
   |                          |                         |
   |--- create-room -------->|                         |
   |<-- room-created --------|                         |
   |                          |                         |
   |--- join-room ---------->|                         |
   |<-- room-joined ---------|                         |
   |                          |                         |
   |                          |--- user-joined ------->|
   |                          |                         |
   |--- offer (to B) ------->|                         |
   |                          |--- offer (from A) ---->|
   |                          |                         |
   |                          |<-- answer (from B) ----|
   |<-- answer (from B) -----|                         |
   |                          |                         |
   |--- ice-candidate ------>|                         |
   |                          |--- ice-candidate ----->|
   |                          |<-- ice-candidate ------|
   |<-- ice-candidate -------|                         |
   |                          |                         |
   |--- leave-room --------->|                         |
   |                          |--- user-left --------->|
   |<-- room-left -----------|                         |
```

### Signaling Authorization

Before forwarding any `offer`, `answer`, or `ice-candidate`, the server validates:

1. The sender is authenticated (has joined a room).
2. `fromId` is a non-empty string matching the authenticated user.
3. The target user exists in a room.
4. Both users are in the same room.

If any validation fails, an error message is sent back to the sender and the signaling message is dropped.
