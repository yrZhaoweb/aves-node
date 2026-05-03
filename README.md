# Aves Node

轻量级 Node.js WebRTC 信令服务器库。负责房间管理和信令转发，不传输 WebRTC 媒体数据。支持可插拔存储（内存 / Redis）和多实例部署。

当前版本：`0.3.0`

## 特性

- 基于房间的信令架构
- 信令消息鉴权：防伪造（fromId 校验）、跨房间保护
- 房间密码与容量限制
- Token bucket rate limit 与最大消息体限制
- 可插拔存储：MemoryStorage（默认）、RedisStorage（可选，支持多实例 pub/sub）
- 存储事件钩子：before/after change 回调，支持取消操作
- 自动清理空房间和断开连接
- 结构化 `AvesError` 与 JSON error payload，支持 requestId 透传
- 健康检查：连接数、房间数、存储类型、运行时间
- 完整 TypeScript 类型定义
- CJS / ESM / TypeScript types 发布入口

## 安装

```bash
npm install @yrzhao/aves-node ws
```

`ws` 是运行时依赖。如需 Redis 存储，额外安装 `ioredis`：

```bash
npm install ioredis
```

## 快速开始

```typescript
import { WebSocketServer } from "ws";
import { AvesServer } from "@yrzhao/aves-node";

const wss = new WebSocketServer({ port: 8080 });
const avesServer = new AvesServer({ debug: true });

wss.on("connection", (ws) => {
  avesServer.handleConnection(ws);
});

console.log("信令服务器运行在 ws://localhost:8080");
```

### 使用 Redis 存储

```typescript
import { AvesServer } from "@yrzhao/aves-node";

const avesServer = new AvesServer({
  redis: {
    host: "127.0.0.1",
    port: 6379,
  },
});
```

RedisStorage 使用 Redis pub/sub 实现跨实例信令转发，适用于多服务器部署。

### 存储事件钩子

```typescript
import { AvesServer } from "@yrzhao/aves-node";

const avesServer = new AvesServer();
const storage = avesServer.getStorage();

storage.addListener({
  onBeforeChange: (event) => {
    // 返回 false 可取消操作
    console.log(`${event.type}: ${event.roomId}`);
    return true;
  },
  onAfterChange: (event) => {
    // 持久化到数据库等
  },
});
```

支持的事件类型：`room:create`、`room:update`、`room:delete`、`participant:join`、`participant:leave`、`user:bindRoom`、`user:unbindRoom`

### 集成 Express

```typescript
import express from "express";
import { WebSocketServer } from "ws";
import { AvesServer } from "@yrzhao/aves-node";

const app = express();
const server = app.listen(3000);
const wss = new WebSocketServer({ server });
const avesServer = new AvesServer();

wss.on("connection", (ws) => {
  avesServer.handleConnection(ws);
});

app.get("/api/rooms", async (req, res) => {
  res.json(await avesServer.getAllRooms());
});
```

## 配置

```typescript
interface AvesServerConfig {
  debug?: boolean;         // 调试日志（默认：false）
  roomTimeout?: number;    // 空房间自动清理延迟 ms（默认：0，永不按计时器清理）
  redis?: Redis | RedisConfig;
  rateLimit?: {
    maxTokens?: number;    // 突发消息数（默认：60）
    refillRate?: number;   // 每秒补充令牌数（默认：10）
  };
  maxMessageSize?: number; // 最大 WebSocket 消息体字节数（默认：65536）
  logger?: {
    debug?: (message: string, context?: Record<string, unknown>) => void;
    info?: (message: string, context?: Record<string, unknown>) => void;
    warn?: (message: string, context?: Record<string, unknown>) => void;
    error?: (message: string, context?: Record<string, unknown>) => void;
  };
}
```

## API 参考

### 连接管理

**`handleConnection(ws: WebSocket, req?: IncomingMessage): void`**

处理新 WebSocket 连接。自动处理消息解析、房间管理、信令转发和断开清理。

### 房间查询

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `getRoomInfo(roomId)` | `Promise<RoomInfo \| null>` | 房间信息 |
| `getParticipantCount(roomId)` | `Promise<number>` | 参与者数量 |
| `getAllRooms()` | `Promise<RoomInfo[]>` | 所有活动房间 |
| `getHealth()` | `Promise<HealthStatus>` | 连接数、房间数、存储类型、roomTimeout、uptime |
| `getStorage()` | `IDataStorage` | 当前存储实例，用于事件钩子或高级集成 |

### 生命周期

**`close(): void`**

关闭服务器，清理所有连接和存储资源。

## 消息协议

基于 JSON 的 WebSocket 协议。所有消息通过 `type` 字段路由。

### 客户端 → 服务器

| type | 必需字段 | 说明 |
|------|----------|------|
| `create-room` | — | 创建房间 |
| `join-room` | `roomId`, `userName` | 加入房间（`userId`、`password` 可选） |
| `leave-room` | `userId` | 离开房间 |
| `offer` | `fromId`, `targetId`, `offer` | WebRTC offer |
| `answer` | `fromId`, `targetId`, `answer` | WebRTC answer |
| `ice-candidate` | `fromId`, `targetId`, `candidate` | ICE candidate |

`create-room`、`join-room`、`leave-room` 支持 `requestId`，服务端会在响应或错误中原样返回，方便客户端关联 pending request。

### 服务器 → 客户端

| type | 说明 |
|------|------|
| `room-created` | 房间创建成功，含 `roomId` |
| `room-joined` | 加入成功，含 `participants` 列表 |
| `room-left` | 离开确认 |
| `user-joined` | 广播：新用户加入 |
| `user-left` | 广播：用户离开 |
| `offer` / `answer` / `ice-candidate` | 信令转发 |
| `error` | 错误消息 |

错误消息包含结构化字段：

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

服务器对 offer / answer / ice-candidate 执行以下校验：

1. 发送者必须已加入房间（已认证）
2. `fromId` 必须与当前连接的用户 ID 一致（防伪造）
3. 发送者与目标必须在同一房间（跨房间保护）

## 类型定义

```typescript
interface RoomInfo {
  id: string;
  name?: string;
  maxCapacity?: number;
  hasPassword: boolean;
  participantCount: number;
  createdAt: number;
}

interface Participant {
  id: string;
  name: string;
}

interface CreateRoomOptions {
  name?: string;           // 房间名称
  maxCapacity?: number;    // 最大容量
  password?: string;       // 房间密码
}

interface HealthStatus {
  connections: number;
  rooms: number;
  storage: "memory" | "redis";
  roomTimeout: number;
  uptime: number;
}
```

## 存储层

### IDataStorage 接口

实现 `IDataStorage` 即可接入自定义存储后端。

```typescript
interface IDataStorage {
  setRoom(roomId: string, room: Room): Promise<void>;
  getRoom(roomId: string): Promise<Room | null>;
  deleteRoom(roomId: string): Promise<void>;
  getAllRooms(): Promise<Room[]>;
  roomExists(roomId: string): Promise<boolean>;
  setUserRoom(userId: string, roomId: string): Promise<boolean>;
  getUserRoom(userId: string): Promise<string | null>;
  deleteUserRoom(userId: string): Promise<void>;
  setParticipant(roomId: string, userId: string, participant: ParticipantInfo): Promise<boolean>;
  getParticipant(roomId: string, userId: string): Promise<Participant | null>;
  deleteParticipant(roomId: string, userId: string): Promise<void>;
  getAllParticipants(roomId: string): Promise<Map<string, ParticipantInfo>>;
  close(): Promise<void>;
}
```

### MemoryStorage

默认存储，基于内存 Map。适合单实例部署。

### RedisStorage

基于 Redis 的存储实现。每个实例通过唯一 `instanceId` 订阅自己的信令通道，使用 pub/sub 进行跨实例消息投递。

```typescript
const avesServer = new AvesServer({
  redis: {
    host: "127.0.0.1",
    port: 6379,
    password: process.env.REDIS_PASSWORD,
    db: 0,
  },
});
```

也可以传入预配置的 `ioredis` 实例：

```typescript
import Redis from "ioredis";
import { RedisStorage } from "@yrzhao/aves-node";

const redis = new Redis({
  host: "127.0.0.1",
  port: 6379,
});

const storage = new RedisStorage(redis, "aves");
```

### BaseStorage

抽象基类，提供事件钩子系统。MemoryStorage 和 RedisStorage 均继承自此类。

## 性能

- 发布包仅包含 `dist`、`README.md`、`LICENSE` 和 `package.json`
- 当前 dry-run tarball 约 25 KiB，解包后约 175 KiB
- 单实例适合中小型部署；RedisStorage 可用于多实例横向扩展
- 房间内广播复杂度 O(n)，n 为房间参与者数；信令服务器不转发媒体流
- 默认 `rateLimit` 为 60 个突发 token、每秒补 10 个 token；默认 `maxMessageSize` 为 64 KiB
- 实际连接上限取决于 Node.js、操作系统 fd 限制、负载均衡和 Redis 延迟

## 许可证

MIT

## 相关包

- [@yrzhao/aves-core](https://www.npmjs.com/package/@yrzhao/aves-core) - 浏览器 WebRTC 客户端库
