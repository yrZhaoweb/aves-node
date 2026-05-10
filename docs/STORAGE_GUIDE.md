# aves-node Storage Guide

The storage layer tracks rooms, participants, and user-to-room bindings. It also determines whether multi-instance signaling can work.

## MemoryStorage

Use for:

- Local development.
- Unit and integration tests.
- Single-instance demos.

Properties:

- Fast and dependency-free.
- State is lost when the process exits.
- Sockets cannot be shared across instances.

## RedisStorage

Use for:

- Horizontally scaled signaling.
- Multiple Node.js instances behind a load balancer.
- Rooms where participants may connect to different instances.

Properties:

- Stores rooms and participant metadata in Redis.
- Uses an instance-specific pub/sub channel to forward signaling messages to remote sockets.
- Uses atomic `SET NX` for user-to-room binding.
- Requires `ioredis`.

Operational notes:

- Run Redis with authentication and network isolation.
- Monitor Redis latency. Signaling is latency-sensitive.
- Configure load balancer WebSocket timeouts generously.
- Call `await server.close()` during shutdown so subscribers are cleaned up.

## MongoStorage

Use for:

- Persisting room state for inspection.
- Audit-style workflows.
- Single-instance deployments that need durable room metadata.

Properties:

- Stores room, participant, and binding documents.
- Does not implement pub/sub routing for live sockets.
- Does not make multi-instance realtime signaling work by itself.

If participants in the same room can connect to different Node.js processes, use RedisStorage instead.

## Choosing A Backend

| Need | Backend |
| --- | --- |
| Fast local testing | MemoryStorage |
| One production instance | MemoryStorage or MongoStorage |
| Multiple production instances | RedisStorage |
| Realtime cross-instance signaling | RedisStorage |
| Durable room inspection | MongoStorage |

## Custom Storage

Implement `IDataStorage` when you need a custom backend. The storage must preserve these invariants:

- `setUserRoom(userId, roomId)` must be atomic and return `false` if the user is already bound.
- `getParticipant(roomId, userId)` must return a usable open socket for local delivery or a proxy socket for remote delivery.
- `deleteParticipant` and `deleteUserRoom` must clean up stale socket references.
- `close()` should release subscriptions, clients, timers, or other resources owned by the storage instance.
