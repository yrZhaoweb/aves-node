# Aves Node

Node.js WebRTC 信令服务器库。负责房间管理和信令转发，不传输媒体流。支持可插拔存储和多实例部署。

版本：`0.3.1`

## 安装

```bash
npm install @yrzhao/aves-node ws
```

可选存储：`npm install ioredis`（Redis）或 `npm install mongodb`（MongoDB）

## 快速开始

```typescript
import { WebSocketServer } from "ws";
import { AvesServer } from "@yrzhao/aves-node";

const wss = new WebSocketServer({ port: 8080 });
const aves = new AvesServer({ debug: true });

wss.on("connection", (ws) => aves.handleConnection(ws));
```

## 存储

| 存储 | 说明 | 适用场景 |
|------|------|----------|
| `MemoryStorage` | 默认，内置 | 单实例 |
| `RedisStorage` | pub/sub 跨实例 | 多实例部署 |
| `MongoStorage` | 持久化 | 会话审计 |

```typescript
// Redis
new AvesServer({ redis: { host: "127.0.0.1", port: 6379 } });

// MongoDB
new AvesServer({ mongo: { uri: process.env.MONGODB_URI, dbName: "aves" } });
```

## 事件钩子

```typescript
const storage = aves.getStorage();
storage.addListener({
  onBeforeChange: (event) => {
    console.log(`${event.type}: ${event.roomId}`);
    return true;  // 返回 false 取消操作
  },
});
```

支持事件：`room:create`、`room:update`、`room:delete`、`participant:join`、`participant:leave`、`user:bindRoom`、`user:unbindRoom`

## 配置

```typescript
new AvesServer({
  debug: false,
  roomTimeout: 0,              // 空房间清理延迟（ms）
  maxMessageSize: 65536,       // 最大消息体（bytes）
  rateLimit: { maxTokens: 60, refillRate: 10 },
  redis: { host, port, password, db },
  mongo: { uri, dbName, collectionPrefix },
});
```

## API

| 方法 | 返回 | 说明 |
|------|------|------|
| `handleConnection(ws)` | `void` | 处理 WebSocket 连接 |
| `getRoomInfo(roomId)` | `Promise<RoomInfo>` | 房间信息 |
| `getAllRooms()` | `Promise<RoomInfo[]>` | 所有房间 |
| `getHealth()` | `Promise<HealthStatus>` | 健康状态 |
| `getStorage()` | `IDataStorage` | 存储实例 |
| `close()` | `void` | 关闭服务器 |

## 消息协议

### 客户端 → 服务器

| type | 必需字段 | 说明 |
|------|----------|------|
| `create-room` | — | 创建房间 |
| `join-room` | `roomId`, `userName` | 加入房间 |
| `leave-room` | `userId` | 离开房间 |
| `offer` | `fromId`, `targetId`, `offer` | WebRTC offer |
| `answer` | `fromId`, `targetId`, `answer` | WebRTC answer |
| `ice-candidate` | `fromId`, `targetId`, `candidate` | ICE candidate |

### 服务器 → 客户端

`room-created`、`room-joined`、`room-left`、`user-joined`、`user-left`、`offer`、`answer`、`ice-candidate`、`error`

### 错误格式

```typescript
interface SignalingErrorPayload {
  message: string;
  code: SignalingErrorCode;
  stage: "protocol" | "room" | "signaling" | "transport" | "server";
  retryable: boolean;
  requestId?: string;
}
```

### 鉴权

服务器校验：`fromId` 一致性、跨房间隔离。

## 类型

```typescript
interface RoomInfo {
  id: string;
  name?: string;
  maxCapacity?: number;
  hasPassword: boolean;
  participantCount: number;
  createdAt: number;
}

interface HealthStatus {
  connections: number;
  rooms: number;
  storage: "memory" | "redis" | "mongodb";
  uptime: number;
}
```

## 发布信息

- 包大小：~28 KiB gzip
- O(n) 广播复杂度
- 支持 Express 集成

MIT
