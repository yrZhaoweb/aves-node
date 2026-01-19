# Aves Node

一个轻量级的 Node.js WebRTC 信令服务器库。Aves Node 提供基于房间的信令功能，允许 WebRTC 客户端相互发现并交换连接信息。

## 特性

- 🏠 基于房间的架构，用于组织连接
- 🔄 自动房间生命周期管理
- 📡 WebRTC 信令消息转发（offer、answer、ICE candidates）
- 🧹 自动清理空房间和断开的用户
- 📊 房间和参与者查询 API
- 🔌 易于与现有 WebSocket 服务器集成
- 📦 完整的 TypeScript 类型定义支持

## 安装

```bash
npm install aves-node ws
```

注意：`ws` 是对等依赖，必须单独安装。

## 快速开始

### 独立服务器

```typescript
import { WebSocketServer } from "ws";
import { AvesServer } from "aves-node";

// 创建 WebSocket 服务器
const wss = new WebSocketServer({ port: 3000 });

// 创建 Aves 信令服务器
const avesServer = new AvesServer({
  debug: true,
});

// 处理新连接
wss.on("connection", (ws) => {
  avesServer.handleConnection(ws);
});

console.log("信令服务器运行在 ws://localhost:3000");
```

### 与 Express 集成

```typescript
import express from "express";
import { WebSocketServer } from "ws";
import { AvesServer } from "aves-node";

const app = express();
const server = app.listen(3000);

// 创建附加到 HTTP 服务器的 WebSocket 服务器
const wss = new WebSocketServer({ server });

// 创建 Aves 信令服务器
const avesServer = new AvesServer();

// 处理 WebSocket 连接
wss.on("connection", (ws) => {
  avesServer.handleConnection(ws);
});

// 可选：添加 HTTP 端点用于房间查询
app.get("/api/rooms", (req, res) => {
  const rooms = avesServer.getAllRooms();
  res.json(rooms);
});

app.get("/api/rooms/:roomId", (req, res) => {
  const roomInfo = avesServer.getRoomInfo(req.params.roomId);
  if (roomInfo) {
    res.json(roomInfo);
  } else {
    res.status(404).json({ error: "房间未找到" });
  }
});

console.log("服务器运行在 http://localhost:3000");
```

### 与 Koa 集成

```typescript
import Koa from "koa";
import Router from "@koa/router";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { AvesServer } from "aves-node";

const app = new Koa();
const router = new Router();

// 创建 HTTP 服务器
const server = createServer(app.callback());

// 创建 WebSocket 服务器
const wss = new WebSocketServer({ server });

// 创建 Aves 信令服务器
const avesServer = new AvesServer({ debug: true });

// 处理 WebSocket 连接
wss.on("connection", (ws) => {
  avesServer.handleConnection(ws);
});

// 可选：添加 HTTP API 路由
router.get("/api/rooms", (ctx) => {
  const rooms = avesServer.getAllRooms();
  ctx.body = rooms;
});

router.get("/api/rooms/:roomId", (ctx) => {
  const roomInfo = avesServer.getRoomInfo(ctx.params.roomId);
  if (roomInfo) {
    ctx.body = roomInfo;
  } else {
    ctx.status = 404;
    ctx.body = { error: "房间未找到" };
  }
});

router.get("/api/health", (ctx) => {
  const rooms = avesServer.getAllRooms();
  const totalParticipants = rooms.reduce(
    (sum, room) => sum + room.participantCount,
    0
  );

  ctx.body = {
    status: "ok",
    rooms: rooms.length,
    participants: totalParticipants,
  };
});

// 应用路由
app.use(router.routes()).use(router.allowedMethods());

// 启动服务器
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Koa 服务器运行在 http://localhost:${PORT}`);
  console.log(`WebSocket 信令服务器运行在 ws://localhost:${PORT}`);
});

// 优雅关闭
process.on("SIGINT", () => {
  console.log("正在关闭服务器...");
  avesServer.close();
  server.close(() => {
    console.log("服务器已关闭");
    process.exit(0);
  });
});
```

### 与 Koa + 认证中间件集成

```typescript
import Koa from "koa";
import Router from "@koa/router";
import jwt from "koa-jwt";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { AvesServer } from "aves-node";
import { parse } from "url";

const app = new Koa();
const router = new Router();
const SECRET = "your-secret-key";

// 创建服务器
const server = createServer(app.callback());
const wss = new WebSocketServer({ noServer: true });
const avesServer = new AvesServer({ debug: true });

// HTTP 路由需要 JWT 认证
router.get("/api/rooms", jwt({ secret: SECRET }), (ctx) => {
  const rooms = avesServer.getAllRooms();
  ctx.body = rooms;
});

router.get("/api/rooms/:roomId", jwt({ secret: SECRET }), (ctx) => {
  const roomInfo = avesServer.getRoomInfo(ctx.params.roomId);
  if (roomInfo) {
    ctx.body = roomInfo;
  } else {
    ctx.status = 404;
    ctx.body = { error: "房间未找到" };
  }
});

app.use(router.routes()).use(router.allowedMethods());

// WebSocket 升级时验证令牌
server.on("upgrade", (request, socket, head) => {
  const { query } = parse(request.url, true);
  const token = query.token as string;

  // 验证 JWT 令牌
  try {
    // 这里应该使用 jsonwebtoken 库验证令牌
    // const decoded = jwt.verify(token, SECRET);

    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // 接受 WebSocket 连接
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
      avesServer.handleConnection(ws);
    });
  } catch (error) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
  }
});

server.listen(3000, () => {
  console.log("认证服务器运行在 http://localhost:3000");
});
```

## 配置

### AvesServerConfig

```typescript
interface AvesServerConfig {
  debug?: boolean; // 启用调试日志（默认：false）
  roomTimeout?: number; // 房间超时时间（毫秒，默认：0，禁用）
}
```

### 配置示例

```typescript
const avesServer = new AvesServer({
  debug: true, // 启用详细日志
  roomTimeout: 300000, // 5 分钟后自动删除空房间
});
```

## API 参考

### AvesServer

管理信令功能的主类。

#### 构造函数

```typescript
new AvesServer(config?: AvesServerConfig)
```

使用可选配置创建新的 AvesServer 实例。

```typescript
const server = new AvesServer({
  debug: true,
});
```

#### 方法

##### 连接管理

**`handleConnection(ws: WebSocket): void`**

处理新的 WebSocket 连接。此方法为连接设置消息路由和生命周期管理。

```typescript
wss.on("connection", (ws) => {
  avesServer.handleConnection(ws);
});
```

此方法自动处理：

- 消息解析和路由
- 房间创建和加入
- 信令消息转发
- 断开连接时的清理

##### 房间查询

**`getRoomInfo(roomId: string): RoomInfo | null`**

返回特定房间的信息，如果房间不存在则返回 null。

```typescript
const roomInfo = avesServer.getRoomInfo("room-123");
if (roomInfo) {
  console.log(`房间 ${roomInfo.id} 有 ${roomInfo.participantCount} 个参与者`);
}
```

**`getParticipantCount(roomId: string): number`**

返回房间中的参与者数量，如果房间不存在则返回 0。

```typescript
const count = avesServer.getParticipantCount("room-123");
console.log(`房间有 ${count} 个参与者`);
```

**`getAllRooms(): RoomInfo[]`**

返回所有活动房间的信息。

```typescript
const rooms = avesServer.getAllRooms();
rooms.forEach((room) => {
  console.log(`房间 ${room.id}: ${room.participantCount} 个参与者`);
});
```

##### 生命周期

**`close(): void`**

关闭服务器并清理所有资源，包括关闭所有 WebSocket 连接。

```typescript
process.on("SIGINT", () => {
  avesServer.close();
  process.exit(0);
});
```

## 消息协议

Aves Node 使用基于 JSON 的 WebSocket 消息协议。所有消息都有一个 `type` 字段来确定如何处理。

### 客户端到服务器消息

#### 创建房间

```json
{
  "type": "create-room"
}
```

响应：

```json
{
  "type": "room-created",
  "roomId": "abc123"
}
```

#### 加入房间

```json
{
  "type": "join-room",
  "roomId": "abc123",
  "userId": "user-456",
  "userName": "Alice"
}
```

响应：

```json
{
  "type": "room-joined",
  "participants": [{ "id": "user-789", "name": "Bob" }]
}
```

广播给其他参与者：

```json
{
  "type": "user-joined",
  "user": { "id": "user-456", "name": "Alice" }
}
```

#### 离开房间

```json
{
  "type": "leave-room",
  "userId": "user-456"
}
```

广播给其他参与者：

```json
{
  "type": "user-left",
  "userId": "user-456"
}
```

#### WebRTC 信令消息

**Offer：**

```json
{
  "type": "offer",
  "fromId": "user-456",
  "targetId": "user-789",
  "offer": {
    "type": "offer",
    "sdp": "v=0\r\no=..."
  }
}
```

**Answer：**

```json
{
  "type": "answer",
  "fromId": "user-789",
  "targetId": "user-456",
  "answer": {
    "type": "answer",
    "sdp": "v=0\r\no=..."
  }
}
```

**ICE Candidate：**

```json
{
  "type": "ice-candidate",
  "fromId": "user-456",
  "targetId": "user-789",
  "candidate": {
    "candidate": "candidate:...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

### 服务器到客户端消息

#### 错误

```json
{
  "type": "error",
  "message": "房间未找到"
}
```

## 类型定义

### RoomInfo

```typescript
interface RoomInfo {
  id: string; // 唯一房间 ID
  participantCount: number; // 参与者数量
  createdAt: number; // 房间创建时间戳
}
```

### Participant

```typescript
interface Participant {
  id: string; // 唯一用户 ID
  name: string; // 显示名称
}
```

### SignalingMessage

所有可能的信令消息的联合类型。详见消息协议部分。

## 高级用法

### 自定义房间管理

你可以使用自定义房间管理逻辑扩展服务器：

```typescript
import { AvesServer } from "aves-node";

class CustomAvesServer extends AvesServer {
  // 添加自定义方法或覆盖现有方法

  logRoomActivity() {
    const rooms = this.getAllRooms();
    console.log(`活动房间数: ${rooms.length}`);
    rooms.forEach((room) => {
      console.log(`  ${room.id}: ${room.participantCount} 个参与者`);
    });
  }
}

const server = new CustomAvesServer({ debug: true });

// 每分钟记录房间活动
setInterval(() => {
  server.logRoomActivity();
}, 60000);
```

### 监控和指标

跟踪服务器指标进行监控：

```typescript
const avesServer = new AvesServer({ debug: true });

// 跟踪连接数
let connectionCount = 0;

wss.on("connection", (ws) => {
  connectionCount++;
  console.log(`新连接。总数: ${connectionCount}`);

  avesServer.handleConnection(ws);

  ws.on("close", () => {
    connectionCount--;
    console.log(`连接关闭。总数: ${connectionCount}`);
  });
});

// 定期指标
setInterval(() => {
  const rooms = avesServer.getAllRooms();
  const totalParticipants = rooms.reduce(
    (sum, room) => sum + room.participantCount,
    0
  );

  console.log("指标:", {
    connections: connectionCount,
    rooms: rooms.length,
    participants: totalParticipants,
  });
}, 30000);
```

### 认证和授权

在处理连接之前添加认证：

```typescript
import { WebSocketServer } from "ws";
import { AvesServer } from "aves-node";
import { parse } from "url";

const wss = new WebSocketServer({ noServer: true });
const avesServer = new AvesServer();

server.on("upgrade", (request, socket, head) => {
  // 从 URL 解析认证令牌
  const { query } = parse(request.url, true);
  const token = query.token;

  // 验证令牌
  if (!isValidToken(token)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  // 接受连接
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
    avesServer.handleConnection(ws);
  });
});

function isValidToken(token: string): boolean {
  // 实现你的认证逻辑
  return token === "valid-token";
}
```

### 速率限制

实现速率限制以防止滥用：

```typescript
import { WebSocketServer } from "ws";
import { AvesServer } from "aves-node";

const wss = new WebSocketServer({ port: 3000 });
const avesServer = new AvesServer();

// Track message rates per connection
const messageRates = new Map<WebSocket, number[]>();

wss.on("connection", (ws) => {
  messageRates.set(ws, []);

  // Wrap the connection handler to add rate limiting
  const originalOn = ws.on.bind(ws);
  ws.on = function (event: string, listener: any) {
    if (event === "message") {
      return originalOn(event, (data: Buffer) => {
        const now = Date.now();
        const rates = messageRates.get(ws) || [];

        // Remove old timestamps (older than 1 second)
        const recentRates = rates.filter((time) => now - time < 1000);

        // Check rate limit (e.g., 10 messages per second)
        if (recentRates.length >= 10) {
          console.warn("Rate limit exceeded");
          ws.close(1008, "Rate limit exceeded");
          return;
        }

        recentRates.push(now);
        messageRates.set(ws, recentRates);

        // Call original listener
        listener(data);
      });
    }
    return originalOn(event, listener);
  };

  avesServer.handleConnection(ws);

  ws.on("close", () => {
    messageRates.delete(ws);
  });
});
```

## Error Handling

Aves Node handles errors gracefully:

- **Invalid messages**: Logged and ignored, error sent to client
- **Missing required fields**: Error sent to client
- **Room not found**: Error sent to client
- **Connection errors**: Logged, connection cleaned up
- **Target user not found**: Warning logged, message skipped

All errors are logged to the console when debug mode is enabled.

## Automatic Cleanup

Aves Node automatically manages resources:

- **Empty rooms**: Deleted when the last participant leaves
- **Disconnected users**: Removed from rooms on WebSocket close
- **Stale connections**: Cleaned up when WebSocket errors occur

## Performance Considerations

- **Scalability**: Single-server design suitable for small to medium deployments
- **Memory**: Rooms and participants stored in memory (consider Redis for multi-server setups)
- **Broadcasting**: Messages sent to all room participants (O(n) per message)
- **Connection limits**: Limited by Node.js and OS (typically 10,000+ concurrent connections)

## License

MIT

## Related Packages

- [aves-core](https://www.npmjs.com/package/aves-core) - WebRTC client library for browsers
