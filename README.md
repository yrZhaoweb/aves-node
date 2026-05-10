# Aves Node

Node.js WebRTC signaling server library. `@yrzhao/aves-node` manages rooms, participants, and WebRTC signaling messages over WebSocket. It does not relay media, data-channel messages, audio, video, or files.

Version: `1.1.0`

## Install

```bash
npm install @yrzhao/aves-node ws
```

Optional storage backends:

```bash
npm install ioredis
npm install mongodb
```

## Quick Start

```ts
import { WebSocketServer } from "ws";
import { AvesServer } from "@yrzhao/aves-node";

const aves = new AvesServer({
  roomTimeout: 5 * 60 * 1000,
  rateLimit: { maxTokens: 120, refillRate: 30 },
  maxMessageSize: 256 * 1024,
});

const wss = new WebSocketServer({ port: 8080 });
wss.on("connection", (ws, req) => {
  aves.handleConnection(ws, req);
});
```

## What It Does

- Creates rooms and tracks participants.
- Routes SDP offers, SDP answers, and ICE candidates between peers.
- Enforces same-room signaling and `fromId` authentication per WebSocket connection.
- Supports room passwords, max capacity, reconnect grace windows, rate limits, message size limits, health, and metrics.
- Supports Memory, Redis, and MongoDB storage implementations.

## What It Does Not Do

- It does not serve your frontend.
- It does not terminate TLS by itself. Put it behind HTTPS/WSS infrastructure.
- It does not relay WebRTC traffic. Media and data flow directly between browsers.
- It does not provide product authentication. Add auth at your WebSocket boundary or application layer.
- MongoDB storage is not a realtime cross-instance signaling bus.

## Storage Choices

| Backend | Best For | Notes |
| --- | --- | --- |
| `MemoryStorage` | Local development, tests, single instance | No persistence, no cross-instance routing |
| `RedisStorage` | Multi-instance realtime signaling | Uses pub/sub to route signals to sockets on other instances |
| `MongoStorage` | Persistence and audit-like state | Stores room state, but does not forward realtime messages across instances |

See [STORAGE_GUIDE.md](docs/STORAGE_GUIDE.md).

## Production Configuration

```ts
const aves = new AvesServer({
  debug: false,
  roomTimeout: 5 * 60 * 1000,
  reconnectGraceMs: 5000,
  maxMessageSize: 256 * 1024,
  rateLimit: { maxTokens: 120, refillRate: 30 },
  logger: {
    info: (message, context) => logger.info(context, message),
    warn: (message, context) => logger.warn(context, message),
    error: (message, context) => logger.error(context, message),
    debug: (message, context) => logger.debug(context, message),
  },
});
```

## Redis

```ts
new AvesServer({
  redis: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD,
  },
});
```

## MongoDB

```ts
new AvesServer({
  mongo: {
    uri: process.env.MONGODB_URI,
    dbName: "aves",
    collectionPrefix: "aves",
  },
});
```

## Health And Metrics

```ts
const health = await aves.getHealth();
const metrics = await aves.getMetrics();
const storageType = aves.getStorageType();
```

Expose these from your HTTP server for load balancers and monitoring.

## API

| Method | Returns | Description |
| --- | --- | --- |
| `handleConnection(ws, req?)` | `void` | Register a WebSocket connection |
| `getRoomInfo(roomId)` | `Promise<RoomInfo \| null>` | Inspect one room |
| `getAllRooms()` | `Promise<RoomInfo[]>` | Inspect all rooms |
| `getHealth()` | `Promise<HealthStatus>` | Lightweight health summary |
| `getMetrics()` | `Promise<ServerMetrics>` | Operational metrics |
| `getStorageType()` | `"memory" \| "redis" \| "mongodb"` | Current storage backend |
| `getStorage()` | `IDataStorage` | Storage instance for event listeners |
| `close()` | `Promise<void>` | Close timers, sockets, and storage |

## Protocol

Client to server:

- `create-room`
- `join-room`
- `leave-room`
- `offer`
- `answer`
- `ice-candidate`

Server to client:

- `room-created`
- `room-joined`
- `room-left`
- `user-joined`
- `user-left`
- `offer`
- `answer`
- `ice-candidate`
- `error`

Errors use:

```ts
interface SignalingErrorPayload {
  message: string;
  code: SignalingErrorCode;
  stage: "protocol" | "room" | "signaling" | "transport" | "server";
  retryable: boolean;
  requestId?: string;
}
```

## Production Notes

- Use WSS in production.
- Put the WebSocket server behind a reverse proxy that supports upgrade headers.
- Enforce product authentication before or during room join.
- Use Redis for horizontally scaled realtime signaling.
- Tune rate limits and message size for your traffic profile.
- Monitor `getMetrics()` and storage errors.

See [PRODUCTION.md](docs/PRODUCTION.md).

MIT
