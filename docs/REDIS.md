# Redis Deployment Guide

aves-node supports multi-instance deployment via Redis. When configured with Redis, the server uses Redis as a shared data store and pub/sub channels for cross-instance signaling. This allows multiple server instances to coordinate as a single logical signaling service behind a load balancer.

---

## Table of Contents

- [Architecture](#architecture)
- [Configuration](#configuration)
- [Redis Key Naming](#redis-key-naming)
- [Cross-Instance Signaling Flow](#cross-instance-signaling-flow)
- [Health Monitoring](#health-monitoring)
- [Production Example](#production-example)
- [Limitations](#limitations)

---

## Architecture

```
                      Load Balancer (WebSocket)
                      /        |        \
              instance-1   instance-2   instance-3
                   |            |            |
                   +----- Redis -----+-------+
                         |     |
                    pub/sub  data
                   channels  store
```

Each instance:

- Runs an `AvesServer` with `RedisStorage`.
- Stores room metadata, participant records, and user-room bindings in Redis.
- Subscribes to a private pub/sub channel (`{prefix}:instance:{instanceId}:signals`) to receive signaling messages for participants whose WebSocket lives on a different instance.
- Publishes signaling messages to the target instance's channel when a participant is remote.
- Uses `Redis SET NX` for atomic user-to-room binding, preventing the same userId from joining multiple rooms across instances.

Key invariants:

- **WebSocket connections are NOT shared across instances.** Each instance only holds the sockets for users connected directly to it.
- **Signaling messages are forwarded through Redis pub/sub** when the sender and target are on different instances.
- **Storage events fire independently on each instance.** A before/after hook registered on instance-1 does not run on instance-2.

---

## Configuration

### Option 1: Pass a RedisConfig object

```ts
import { AvesServer } from "@yrzhao/aves-node";

const server = new AvesServer({
  redis: {
    host: "redis-cluster.example.com",
    port: 6379,
    password: process.env.REDIS_PASSWORD,
    db: 0,
  },
});
```

### Option 2: Pass a pre-configured ioredis instance

Use this when you need TLS, sentinel, cluster support, or custom ioredis options.

```ts
import Redis from "ioredis";
import { AvesServer } from "@yrzhao/aves-node";

const redis = new Redis({
  host: "my-redis.example.com",
  port: 6379,
  tls: {},
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

const server = new AvesServer({ redis });
```

### Optional: Custom key prefix

```ts
const storage = new RedisStorage(redis, "myapp-aves");
```

The default prefix is `"aves"`. All Redis keys are namespaced under this prefix.

### ioredis as a peer dependency

`ioredis` is an optional peer dependency. Install it explicitly:

```bash
npm install ioredis
```

Without it, Redis-backed storage cannot be used. MemoryStorage does not load `ioredis` and remains available without the optional dependency.

### Full configuration with Redis

```ts
const server = new AvesServer({
  debug: true,
  roomTimeout: 300_000,          // auto-delete empty rooms after 5 minutes
  redis: {
    host: "localhost",
    port: 6379,
  },
  rateLimit: {
    maxTokens: 120,
    refillRate: 20,
  },
  maxMessageSize: 131072,        // 128 KB
});
```

---

## Redis Key Naming

All keys are prefixed with `{prefix}:` where the prefix defaults to `"aves"`.

### Rooms Set

| Key              | Type | Purpose                    |
|------------------|------|----------------------------|
| `{prefix}:rooms` | Set  | Set of all active room IDs |

### Room Data

| Key                                      | Type   | Purpose                          |
|------------------------------------------|--------|----------------------------------|
| `{prefix}:room:{roomId}`                 | Hash   | Room metadata (id, name, maxCapacity, password, createdAt) |
| `{prefix}:room:{roomId}:participants`    | Set    | Set of participant userIds       |
| `{prefix}:room:{roomId}:participant:{userId}` | Hash | Participant record (userId, userName, instanceId) |

### User Bindings

| Key                              | Type   | Purpose                        |
|----------------------------------|--------|--------------------------------|
| `{prefix}:user:{userId}:room`    | String | Room ID the user is bound to   |

### Signaling Channels (pub/sub)

| Key                                          | Type       | Purpose                                   |
|----------------------------------------------|------------|-------------------------------------------|
| `{prefix}:instance:{instanceId}:signals`      | pub/sub    | Cross-instance signaling channel          |

### Example Keys with Default Prefix

```
aves:rooms
aves:room:room-a1b2c3d4e5f67890
aves:room:room-a1b2c3d4e5f67890:participants
aves:room:room-a1b2c3d4e5f67890:participant:alice
aves:room:room-a1b2c3d4e5f67890:participant:bob
aves:user:alice:room
aves:user:bob:room
aves:instance:550e8400-e29b-41d4-a716-446655440000:signals
```

---

## Cross-Instance Signaling Flow

When Alice (on instance-1) sends an offer to Bob (on instance-2), the flow is:

```
Client Alice (instance-1)          Server (instance-1)            Redis              Server (instance-2)          Client Bob (instance-2)
         |                                |                         |                        |                           |
         |-- offer(fromId=alice,          |                         |                        |                           |
         |     targetId=bob) ------------>|                         |                        |                           |
         |                                |                         |                        |                           |
         |                                |-- authorize:            |                        |                           |
         |                                |   alice in room? yes    |                        |                           |
         |                                |   bob in room? lookup ->|                        |                           |
         |                                |<- bob also in room -----|                        |                           |
         |                                |                         |                        |                           |
         |                                |   bob's instanceId      |                        |                           |
         |                                |   is instance-2         |                        |                           |
         |                                |                         |                        |                           |
         |                                |-- PUBLISH to            |                        |                           |
         |                                |   aves:instance:inst-2  |                        |                           |
         |                                |   :signals ------------>|                        |                           |
         |                                |   {userId: "bob",       |                        |                           |
         |                                |    payload: "...offer.."}|                        |                           |
         |                                |                         |-- message received ---->|                           |
         |                                |                         |                        |-- socketMap lookup ----> |
         |                                |                         |                        |   bob's WS found locally |
         |                                |                         |                        |                           |
         |                                |                         |                        |-- offer --------------->|
```

### Mechanism Details

1. **Participant storage**: When a user joins a room, `RedisStorage.setParticipant` stores the `instanceId` (a UUID generated at `RedisStorage` construction) alongside the participant record. The WebSocket reference is kept in a local `socketMap`.

2. **Socket resolution** (`resolveParticipantSocket`): When `getParticipant` or `getAllParticipants` is called:
   - If the userId is found in the local `socketMap`, the real WebSocket is returned.
   - If the userId belongs to a different `instanceId`, a **virtual socket** is created that publishes messages to the remote instance's Redis pub/sub channel.
   - If no socket can be resolved, `null` is returned.

3. **Virtual socket**: `createRemoteSocket` returns a proxy-like WebSocket object with `readyState: WebSocket.OPEN` and a `send()` method that `PUBLISH`es to the remote instance's signaling channel. The envelope format:

   ```json
   { "userId": "bob", "payload": "{\"type\":\"offer\",\"fromId\":\"alice\",...}" }
   ```

4. **Subscriber**: Each instance subscribes to its own channel (`{prefix}:instance:{instanceId}:signals`). The subscriber handler parses the envelope, looks up the target userId in the local `socketMap`, and calls `socket.send(payload)`.

### Atomic User Binding

`setUserRoom` uses Redis `SET NX` to atomically bind a user to a room:

```
SET aves:user:alice:room room-a1b2c3d4e5f67890 NX
```

If the key already exists (user is already in a room on any instance), `SET NX` returns `nil` and the join is rejected. This prevents a user from being in multiple rooms simultaneously across instances.

---

## Health Monitoring

### Connection Health

```ts
import Redis from "ioredis";

const redis = new Redis({ host: "localhost", port: 6379 });

// Ping Redis to check connectivity
const pong = await redis.ping();
console.log("Redis status:", pong); // "PONG"
```

### Memory Usage

Monitor Redis memory to ensure it stays within bounds, especially for the rooms set and participant records:

```bash
redis-cli INFO memory
redis-cli MEMORY USAGE aves:rooms
```

### Key Expiry Consideration

The current implementation does not set TTL on keys. Room cleanup is handled by the server's periodic timer (`roomTimeout` config). For Redis-native expiry, you may want to:

```ts
// Custom cleanup — optional, depending on your deployment
const storage = server.getStorage();
// ... attach custom logic
```

---

## Production Example

### docker-compose.yml

```yaml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  signaling-1:
    build: .
    ports:
      - "8081:8080"
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379
      NODE_ENV: production
    depends_on:
      - redis

  signaling-2:
    build: .
    ports:
      - "8082:8080"
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379
      NODE_ENV: production
    depends_on:
      - redis

  nginx:
    image: nginx:alpine
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    ports:
      - "80:80"
    depends_on:
      - signaling-1
      - signaling-2
```

### nginx.conf (WebSocket load balancing)

```nginx
upstream signaling {
    ip_hash;
    server signaling-1:8080;
    server signaling-2:8080;
}

server {
    listen 80;

    location / {
        proxy_pass http://signaling;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Use `ip_hash` to ensure sticky sessions (a client's subsequent WebSocket messages reach the same instance).

### Server startup code

```ts
import { AvesServer } from "@yrzhao/aves-node";
import { WebSocketServer } from "ws";

const server = new AvesServer({
  debug: process.env.NODE_ENV !== "production",
  roomTimeout: 300_000, // 5 minutes
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
  },
  rateLimit: {
    maxTokens: 120,
    refillRate: 20,
  },
});

const wss = new WebSocketServer({ port: 8080 });
wss.on("connection", (ws, req) => server.handleConnection(ws, req));

process.on("SIGTERM", () => {
  server.close();
  wss.close();
});
```

---

## Limitations

- **No TTL/expiry on Redis keys.** Rooms persist until explicitly deleted (either through the last user leaving or the `roomTimeout` timer). A server crash might leave stale room data in Redis. Consider adding TTL-based cleanup or relying on the server's periodic cleanup timer.
- **Signaling channel latency.** Cross-instance signaling adds one Redis pub/sub hop, which introduces ~1ms of additional latency for signaling messages. This is negligible for WebRTC signaling but worth noting.
- **Single subscriber per instance.** Each RedisStorage instance maintains a single subscriber connection for its signaling channel. If the subscriber disconnects, cross-instance forwarding fails until the next `setParticipant` call re-initializes it (via `subscriptionReady` await).
