# aves-node Production Guide

`@yrzhao/aves-node` is the signaling layer for Aves. It coordinates rooms and WebRTC negotiation but does not relay WebRTC media or data.

## TLS And Reverse Proxy

Terminate TLS at your load balancer or reverse proxy and forward WebSocket upgrades to the Node.js process.

Nginx example:

```nginx
location / {
  proxy_pass http://127.0.0.1:8080;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 3600s;
  proxy_send_timeout 3600s;
}
```

Browsers should connect with `wss://`.

## Authentication

Aves validates signaling ownership after a socket joins a room: `fromId` must match the user bound to that WebSocket, and target peers must be in the same room.

Product authentication is still your responsibility. Common patterns:

- Validate a session/JWT before accepting the WebSocket upgrade.
- Put authenticated user identity into the generated or requested Aves user ID.
- Validate room access before forwarding `join-room` into Aves.
- Use room passwords only as lightweight access control, not account auth.

## Rate Limits And Message Size

Defaults:

- `rateLimit.maxTokens`: `60`
- `rateLimit.refillRate`: `10`
- `maxMessageSize`: `65536`

For a public demo, a larger burst can be comfortable:

```ts
new AvesServer({
  rateLimit: { maxTokens: 120, refillRate: 30 },
  maxMessageSize: 256 * 1024,
});
```

Do not set unlimited message sizes. Signaling messages should be small.

## Room Cleanup

Use `roomTimeout` to remove empty rooms after a grace period:

```ts
new AvesServer({
  roomTimeout: 5 * 60 * 1000,
});
```

`reconnectGraceMs` controls how long a disconnected participant remains present before `user-left` is broadcast. This reduces flicker during page refreshes and transient network changes.

## Observability

Use a structured logger:

```ts
new AvesServer({
  logger: {
    debug: (message, context) => logger.debug(context, message),
    info: (message, context) => logger.info(context, message),
    warn: (message, context) => logger.warn(context, message),
    error: (message, context) => logger.error(context, message),
  },
});
```

Expose health and metrics from your HTTP server:

```ts
app.get("/health", async (_req, res) => res.json(await aves.getHealth()));
app.get("/metrics", async (_req, res) => res.json(await aves.getMetrics()));
```

## Multi-Instance Deployment

Use `RedisStorage` when more than one Node.js instance may host sockets for the same room. Redis stores room membership and uses pub/sub to forward signaling to the instance that owns the target socket.

Do not use MongoDB alone for multi-instance realtime signaling. MongoDB storage persists room state, but it does not route live WebSocket messages across instances.

## Graceful Shutdown

Call and await `close()` during process shutdown:

```ts
process.on("SIGTERM", async () => {
  await aves.close();
  process.exit(0);
});
```

This clears timers, closes tracked sockets, and closes storage resources that the storage backend owns.

## Deployment Checklist

- WSS works through the reverse proxy.
- Product auth is enforced before room access.
- Redis is used for horizontal realtime signaling.
- Rate limit and message size are configured.
- Health and metrics endpoints are monitored.
- Shutdown awaits `aves.close()`.
