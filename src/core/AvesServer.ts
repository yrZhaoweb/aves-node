import { WebSocket } from "ws";
import type { Redis } from "ioredis";
import type { IncomingMessage } from "http";
import { AvesError } from "./AvesError";
import { RoomManager } from "./RoomManager";
import { SignalingHandler } from "./SignalingHandler";
import { RateLimiter } from "./RateLimiter";
import {
  AvesServerConfig,
  AvesLogger,
  HealthStatus,
  RoomInfo,
  InboundSignalingMessage,
  OutboundSignalingMessage,
  RedisConfig,
  SignalingErrorCode,
  SignalingErrorPayload,
  SignalingErrorStage,
} from "../types/types";
import { IDataStorage } from "../storage/IDataStorage";
import { MemoryStorage } from "../storage/MemoryStorage";
import { RedisStorage } from "../storage/RedisStorage";
import * as crypto from "crypto";

type NormalizedAvesLogger = Required<AvesLogger>;

function writeConsoleLog(
  level: "debug" | "info" | "warn" | "error",
): (message: string, context?: Record<string, unknown>) => void {
  return (message, context) => {
    if (context === undefined) {
      console[level](message);
      return;
    }

    console[level](message, context);
  };
}

function createLogger(logger?: AvesLogger): NormalizedAvesLogger {
  return {
    debug: logger?.debug ?? writeConsoleLog("debug"),
    info: logger?.info ?? writeConsoleLog("info"),
    warn: logger?.warn ?? writeConsoleLog("warn"),
    error: logger?.error ?? writeConsoleLog("error"),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * AvesServer is the main class for the aves-node signaling server
 * It coordinates RoomManager and SignalingHandler to provide WebRTC signaling functionality
 * Requirements: 7.1, 7.2, 7.3, 10.1, 10.2, 10.3, 10.4
 */
export class AvesServer {
  private roomManager: RoomManager;
  private signalingHandler: SignalingHandler;
  private config: AvesServerConfig;
  private storage: IDataStorage;
  private connections: Set<WebSocket> = new Set();
  private rateLimiter: RateLimiter;
  private maxMessageSize: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly startTime: number;
  private readonly logger: NormalizedAvesLogger;

  /**
   * Create a new AvesServer instance
   * @param config Optional configuration object
   */
  constructor(config?: AvesServerConfig) {
    this.startTime = Date.now();
    this.logger = createLogger(config?.logger);

    this.config = {
      debug: config?.debug ?? false,
      roomTimeout: config?.roomTimeout ?? 0,
      redis: config?.redis,
      rateLimit: config?.rateLimit ?? { maxTokens: 60, refillRate: 10 },
      maxMessageSize: config?.maxMessageSize ?? 65536,
    };

    this.rateLimiter = new RateLimiter(
      this.config.rateLimit!.maxTokens,
      this.config.rateLimit!.refillRate,
    );
    this.maxMessageSize = this.config.maxMessageSize!;

    this.storage = this.initializeStorage();
    this.roomManager = new RoomManager(this.storage);
    this.signalingHandler = new SignalingHandler(this.roomManager);

    this.startPeriodicCleanup();

    if (this.config.debug) {
      this.logDebug("[AvesServer] Initialized with config", {
        config: this.config,
      });
    }
  }

  private initializeStorage(): IDataStorage {
    const redis = this.config.redis;
    if (redis) {
      const redisClient = isRedisClient(redis) ? redis : createRedisClient(redis);
      return new RedisStorage(redisClient);
    }

    return new MemoryStorage();
  }

  /**
   * Handle a new WebSocket connection
   * Sets up message routing and connection lifecycle management
   * Requirements: 7.3
   */
  handleConnection(ws: WebSocket, req?: IncomingMessage): void {
    if (this.config.debug) {
      this.logDebug("[AvesServer] New WebSocket connection");
    }

    const clientKey = req?.socket?.remoteAddress ?? "unknown";
    this.connections.add(ws);
    let currentUserId: string | undefined;

    // Handle incoming messages
    ws.on("message", (data: Buffer) => {
      // Rate limiting
      if (!this.rateLimiter.consume(clientKey)) {
        this.sendError(
          ws,
          new AvesError({
            message: "Rate limit exceeded",
            code: "SERVER_ERROR",
            stage: "protocol",
            retryable: true,
          }),
        );
        return;
      }

      // Message size limit
      if (data.byteLength > this.maxMessageSize) {
        this.sendError(
          ws,
          new AvesError({
            message: `Message exceeds maximum size of ${this.maxMessageSize} bytes`,
            code: "INVALID_MESSAGE_FORMAT",
            stage: "protocol",
            retryable: false,
          }),
        );
        return;
      }

      try {
        const message = JSON.parse(data.toString());

        if (this.config.debug) {
          this.logDebug("[AvesServer] Received message", { message });
        }

        this.routeMessage(ws, message, currentUserId, (userId) => {
          currentUserId = userId;
        }).catch((error) => {
          this.logger.error("[AvesServer] Error handling message", { error });
          this.sendError(ws, this.createRouteErrorPayload(error, message));
        });
      } catch (error) {
        if (this.config.debug) {
          this.logger.error("[AvesServer] Failed to parse message", { error });
        }
        this.sendError(
          ws,
          this.createErrorPayload(
            "Invalid message format",
            "INVALID_MESSAGE_FORMAT",
            "protocol",
            false,
          ),
        );
      }
    });

    // Handle connection close
    ws.on("close", () => {
      if (this.config.debug) {
        this.logDebug("[AvesServer] WebSocket connection closed");
      }

      this.connections.delete(ws);

      if (currentUserId) {
        const disconnectedUserId = currentUserId;
        currentUserId = undefined;
        this.handleDisconnection(disconnectedUserId);
      }
    });

    // Handle connection errors
    ws.on("error", (error) => {
      this.logger.error("[AvesServer] WebSocket error", { error });
    });
  }

  /**
   * Route incoming messages to appropriate handlers
   * Requirements: 7.3
   */
  private async routeMessage(
    ws: WebSocket,
    message: unknown,
    authenticatedUserId: string | undefined,
    setUserId: (userId?: string) => void,
  ): Promise<void> {
    if (!this.isValidInboundMessage(message)) {
      this.sendError(
        ws,
        this.createErrorPayload(
          "Invalid message: missing or invalid type field",
          "INVALID_MESSAGE",
          "protocol",
          false,
        ),
      );
      return;
    }

    switch (message.type) {
      case "create-room":
        await this.handleCreateRoom(ws, message);
        break;

      case "join-room":
        await this.handleJoinRoom(ws, message, authenticatedUserId, setUserId);
        break;

      case "leave-room":
        await this.handleLeaveRoom(ws, message, authenticatedUserId, setUserId);
        break;

      case "offer":
        await this.handleOffer(ws, authenticatedUserId, message);
        break;

      case "answer":
        await this.handleAnswer(ws, authenticatedUserId, message);
        break;

      case "ice-candidate":
        await this.handleIceCandidate(ws, authenticatedUserId, message);
        break;

      default: {
        const exhaustiveCheck: never = message;
        if (this.config.debug) {
          this.logger.warn("[AvesServer] Unknown message type", {
            type: (exhaustiveCheck as { type: string }).type,
          });
        }
        this.sendError(
          ws,
          this.createErrorPayload(
            `Unknown message type: ${(message as { type: string }).type}`,
            "INVALID_MESSAGE",
            "protocol",
            false,
          ),
        );
      }
    }
  }

  /**
   * Type guard to validate inbound message structure
   */
  private isValidInboundMessage(
    message: unknown,
  ): message is InboundSignalingMessage {
    if (!message || typeof message !== "object") {
      return false;
    }
    const msg = message as Record<string, unknown>;
    return (
      typeof msg.type === "string" &&
      [
        "create-room",
        "join-room",
        "leave-room",
        "offer",
        "answer",
        "ice-candidate",
      ].includes(msg.type)
    );
  }

  /**
   * Handle create-room message
   */
  private async handleCreateRoom(
    ws: WebSocket,
    message: Extract<InboundSignalingMessage, { type: "create-room" }>,
  ): Promise<void> {
    const options = message.options;
    const roomId = await this.roomManager.createRoom(options);

    const response: OutboundSignalingMessage = {
      type: "room-created",
      roomId,
      requestId: message.requestId,
    };

    this.sendMessage(ws, response);

    if (this.config.debug) {
      this.logDebug("[AvesServer] Room created", { roomId, options });
    }
  }

  /**
   * Handle join-room message
   */
  private async handleJoinRoom(
    ws: WebSocket,
    message: Extract<InboundSignalingMessage, { type: "join-room" }>,
    authenticatedUserId: string | undefined,
    setUserId: (userId: string) => void,
  ): Promise<void> {
    const { roomId, userName, password } = message;
    let userId = message.userId;

    if (authenticatedUserId) {
      this.sendError(
        ws,
        this.createErrorPayload(
          "Connection already joined to a room; leave first",
          "ALREADY_JOINED",
          "room",
          false,
          message.requestId,
        ),
      );
      return;
    }

    if (!roomId || !userName) {
      this.sendError(
        ws,
        this.createErrorPayload(
          "Missing required fields: roomId, userName",
          "JOIN_ROOM_MISSING_FIELDS",
          "room",
          false,
          message.requestId,
        ),
      );
      return;
    }

    if (!userId) {
      userId = this.generateUserId();
    } else {
      userId = userId.trim();
      if (userId.length === 0) {
        this.sendError(
          ws,
          this.createErrorPayload(
            "Invalid userId",
            "ROOM_JOIN_FAILED",
            "room",
            false,
            message.requestId,
          ),
        );
        return;
      }
    }

    const roomExists = await this.roomManager.roomExists(roomId);
    if (!roomExists) {
      this.sendError(
        ws,
        this.createErrorPayload(
          `Room ${roomId} does not exist`,
          "ROOM_NOT_FOUND",
          "room",
          false,
          message.requestId,
        ),
      );
      return;
    }

    const currentParticipants =
      await this.roomManager.getRoomParticipants(roomId);

    const success = await this.roomManager.joinRoom(
      roomId,
      userId,
      userName,
      ws,
      password,
    );

    if (!success) {
      this.sendError(
        ws,
        this.createErrorPayload(
          `Failed to join room ${roomId}. Check password or room capacity.`,
          "ROOM_JOIN_FAILED",
          "room",
          false,
          message.requestId,
        ),
      );
      return;
    }

    setUserId(userId);

    const joinedResponse: OutboundSignalingMessage = {
      type: "room-joined",
      participants: currentParticipants,
      userId,
      requestId: message.requestId,
    };
    this.sendMessage(ws, joinedResponse);

    const userJoinedMessage: OutboundSignalingMessage = {
      type: "user-joined",
      user: { id: userId, name: userName },
    };
    await this.roomManager.broadcastToRoom(roomId, userJoinedMessage, userId);

    if (this.config.debug) {
      this.logDebug("[AvesServer] User joined room", { userId, roomId });
    }
  }

  private generateUserId(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  /**
   * Handle leave-room message
   */
  private async handleLeaveRoom(
    ws: WebSocket,
    message: Extract<InboundSignalingMessage, { type: "leave-room" }>,
    authenticatedUserId: string | undefined,
    setUserId: (userId?: string) => void,
  ): Promise<void> {
    const { userId } = message;

    if (!userId) {
      this.logger.warn("[AvesServer] Leave room message missing userId");
      return;
    }

    if (!authenticatedUserId) {
      this.sendError(
        ws,
        this.createErrorPayload(
          "Leave denied: user is not joined to a room",
          "LEAVE_NOT_JOINED",
          "room",
          false,
          message.requestId,
        ),
      );
      return;
    }

    if (userId !== authenticatedUserId) {
      this.sendError(
        ws,
        this.createErrorPayload(
          "Leave denied: userId does not match the authenticated connection",
          "LEAVE_USER_MISMATCH",
          "room",
          false,
          message.requestId,
        ),
      );
      return;
    }

    setUserId(undefined);
    const roomId = await this.roomManager.getRoomIdByUserId(userId);
    await this.handleDisconnection(userId);

    if (roomId) {
      this.sendMessage(ws, {
        type: "room-left",
        roomId,
        userId,
        requestId: message.requestId,
      });
    }
  }

  /**
   * Handle user disconnection
   * Requirements: 10.1, 10.2
   */
  private async handleDisconnection(userId: string): Promise<void> {
    const roomId = await this.roomManager.getRoomIdByUserId(userId);

    if (!roomId) {
      return;
    }

    await this.roomManager.leaveRoom(roomId, userId);

    const userLeftMessage: OutboundSignalingMessage = {
      type: "user-left",
      userId,
    };
    await this.roomManager.broadcastToRoom(roomId, userLeftMessage);

    if (this.config.debug) {
      this.logDebug("[AvesServer] User left room", { userId, roomId });
    }
  }

  /**
   * Handle offer message
   */
  private async handleOffer(
    ws: WebSocket,
    authenticatedUserId: string | undefined,
    message: Extract<InboundSignalingMessage, { type: "offer" }>,
  ): Promise<void> {
    if (
      !(await this.authorizeSignalingMessage(
        ws,
        authenticatedUserId,
        message.fromId,
        message.targetId,
        "offer",
      ))
    ) {
      return;
    }

    if (!this.signalingHandler.validateSignalingMessage(message)) {
      this.sendError(
        ws,
        this.createErrorPayload(
          "Rejected offer: invalid signaling payload",
          "INVALID_MESSAGE",
          "signaling",
          false,
        ),
      );
      return;
    }

    await this.signalingHandler.handleOffer(
      message.fromId,
      message.targetId,
      message.offer,
    );
  }

  /**
   * Handle answer message
   */
  private async handleAnswer(
    ws: WebSocket,
    authenticatedUserId: string | undefined,
    message: Extract<InboundSignalingMessage, { type: "answer" }>,
  ): Promise<void> {
    if (
      !(await this.authorizeSignalingMessage(
        ws,
        authenticatedUserId,
        message.fromId,
        message.targetId,
        "answer",
      ))
    ) {
      return;
    }

    if (!this.signalingHandler.validateSignalingMessage(message)) {
      this.sendError(
        ws,
        this.createErrorPayload(
          "Rejected answer: invalid signaling payload",
          "INVALID_MESSAGE",
          "signaling",
          false,
        ),
      );
      return;
    }

    await this.signalingHandler.handleAnswer(
      message.fromId,
      message.targetId,
      message.answer,
    );
  }

  /**
   * Handle ice-candidate message
   */
  private async handleIceCandidate(
    ws: WebSocket,
    authenticatedUserId: string | undefined,
    message: Extract<InboundSignalingMessage, { type: "ice-candidate" }>,
  ): Promise<void> {
    if (
      !(await this.authorizeSignalingMessage(
        ws,
        authenticatedUserId,
        message.fromId,
        message.targetId,
        "ice-candidate",
      ))
    ) {
      return;
    }

    if (!this.signalingHandler.validateSignalingMessage(message)) {
      this.sendError(
        ws,
        this.createErrorPayload(
          "Rejected ice-candidate: invalid signaling payload",
          "INVALID_MESSAGE",
          "signaling",
          false,
        ),
      );
      return;
    }

    await this.signalingHandler.handleIceCandidate(
      message.fromId,
      message.targetId,
      message.candidate,
    );
  }

  /**
   * Validate that the active connection may send the signaling message.
   * This prevents spoofed fromId/targetId values and cross-room routing.
   */
  private async authorizeSignalingMessage(
    ws: WebSocket,
    authenticatedUserId: string | undefined,
    fromId: unknown,
    targetId: unknown,
    messageType: "offer" | "answer" | "ice-candidate",
  ): Promise<boolean> {
    if (!authenticatedUserId) {
      this.sendError(
        ws,
        this.createErrorPayload(
          `Rejected ${messageType}: user is not joined to a room`,
          "SIGNALING_NOT_AUTHENTICATED",
          "signaling",
          false,
        ),
      );
      return false;
    }

    if (typeof fromId !== "string" || fromId.trim().length === 0) {
      this.sendError(
        ws,
        this.createErrorPayload(
          `Rejected ${messageType}: missing fromId`,
          "INVALID_MESSAGE",
          "signaling",
          false,
        ),
      );
      return false;
    }

    if (typeof targetId !== "string" || targetId.trim().length === 0) {
      this.sendError(
        ws,
        this.createErrorPayload(
          `Rejected ${messageType}: missing targetId`,
          "INVALID_MESSAGE",
          "signaling",
          false,
        ),
      );
      return false;
    }

    if (fromId !== authenticatedUserId) {
      this.sendError(
        ws,
        this.createErrorPayload(
          `Rejected ${messageType}: fromId does not match the authenticated user`,
          "SIGNALING_FORBIDDEN",
          "signaling",
          false,
        ),
      );
      return false;
    }

    const senderRoomId = await this.roomManager.getRoomIdByUserId(authenticatedUserId);
    if (!senderRoomId) {
      this.sendError(
        ws,
        this.createErrorPayload(
          `Rejected ${messageType}: sender is not in a room`,
          "SIGNALING_NOT_AUTHENTICATED",
          "signaling",
          false,
        ),
      );
      return false;
    }

    const targetRoomId = await this.roomManager.getRoomIdByUserId(targetId);
    if (!targetRoomId) {
      this.sendError(
        ws,
        this.createErrorPayload(
          `Rejected ${messageType}: target user is not in a room`,
          "SIGNALING_TARGET_NOT_FOUND",
          "signaling",
          true,
        ),
      );
      return false;
    }

    if (senderRoomId !== targetRoomId) {
      this.sendError(
        ws,
        this.createErrorPayload(
          `Rejected ${messageType}: peers must belong to the same room`,
          "SIGNALING_TARGET_ROOM_MISMATCH",
          "signaling",
          false,
        ),
      );
      return false;
    }

    return true;
  }

  /**
   * Get room information
   * Requirements: 10.3
   */
  async getRoomInfo(roomId: string): Promise<RoomInfo | null> {
    return await this.roomManager.getRoomInfo(roomId);
  }

  /**
   * Get participant count for a room
   * Requirements: 10.4
   */
  async getParticipantCount(roomId: string): Promise<number> {
    const roomInfo = await this.roomManager.getRoomInfo(roomId);
    return roomInfo ? roomInfo.participantCount : 0;
  }

  /**
   * Get all rooms information
   * Requirements: 10.3
   */
  async getAllRooms(): Promise<RoomInfo[]> {
    return await this.roomManager.getAllRooms();
  }

  /**
   * Get the storage instance for adding event listeners
   * This allows users to implement custom persistence
   */
  getStorage(): IDataStorage {
    return this.storage;
  }

  /**
   * Get server health status including connections, rooms, and uptime.
   */
  async getHealth(): Promise<HealthStatus> {
    const rooms = await this.roomManager.getAllRooms();
    const isRedis = this.config.redis !== undefined;
    return {
      connections: this.connections.size,
      rooms: rooms.length,
      storage: isRedis ? "redis" : "memory",
      roomTimeout: this.config.roomTimeout ?? 0,
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Close the server and clean up resources
   */
  close(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.config.debug) {
      this.logDebug("[AvesServer] Closing server");
    }

    for (const ws of this.connections) {
      try {
        ws.close();
      } catch (_error) {
        // Connection may already be closing/closed — ignore.
      }
    }
    this.connections.clear();

    const storageCloseResult = this.storage.close?.();
    if (storageCloseResult instanceof Promise) {
      void storageCloseResult.catch((error) => {
        this.logger.error("[AvesServer] Failed to close storage", { error });
      });
    }

    if (this.config.debug) {
      this.logDebug("[AvesServer] Server closed");
    }
  }

  /**
   * Send a message to a WebSocket connection
   */
  private sendMessage(ws: WebSocket, message: OutboundSignalingMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        this.logger.error("[AvesServer] Failed to send message", { error });
      }
    }
  }

  /**
   * Send an error message to a WebSocket connection
   */
  private createErrorPayload(
    message: string,
    code: SignalingErrorCode,
    stage: SignalingErrorStage,
    retryable: boolean,
    requestId?: string,
  ): SignalingErrorPayload {
    return {
      message,
      code,
      stage,
      retryable,
      requestId,
    };
  }

  private sendError(
    ws: WebSocket,
    error: SignalingErrorPayload | AvesError,
  ): void {
    const payload: SignalingErrorPayload =
      error instanceof AvesError
        ? {
            message: error.message,
            code: error.code as SignalingErrorCode,
            stage: error.stage,
            retryable: error.retryable,
            requestId: error.requestId,
          }
        : error;

    const message: OutboundSignalingMessage = {
      type: "error",
      ...payload,
    };
    this.sendMessage(ws, message);
  }

  private createRouteErrorPayload(
    error: unknown,
    message: unknown,
  ): SignalingErrorPayload {
    const requestId = this.extractRequestId(message);

    if (error instanceof AvesError) {
      return {
        message: error.message,
        code: error.code as SignalingErrorCode,
        stage: error.stage,
        retryable: error.retryable,
        requestId: error.requestId ?? requestId,
      };
    }

    return this.createErrorPayload(
      errorMessage(error),
      "SERVER_ERROR",
      "server",
      true,
      requestId,
    );
  }

  private extractRequestId(message: unknown): string | undefined {
    if (!message || typeof message !== "object") {
      return undefined;
    }

    const requestId = (message as Record<string, unknown>).requestId;
    return typeof requestId === "string" ? requestId : undefined;
  }

  /**
   * Periodically clean up dead rooms and prune rate limiter buckets.
   */
  private startPeriodicCleanup(): void {
    this.cleanupTimer = setInterval(async () => {
      this.rateLimiter.prune();

      if (!this.config.roomTimeout || this.config.roomTimeout <= 0) {
        return;
      }

      try {
        const rooms = await this.roomManager.getAllRooms();
        for (const room of rooms) {
          if (room.participantCount === 0) {
            const age = Date.now() - room.createdAt;
            if (age > this.config.roomTimeout) {
              await this.storage.deleteRoom?.(room.id);
              if (this.config.debug) {
                this.logDebug("[AvesServer] Cleaned up empty room", {
                  roomId: room.id,
                  idleMs: age,
                });
              }
            }
          }
        }
      } catch (error) {
        if (this.config.debug) {
          this.logger.warn("[AvesServer] Room cleanup failed", { error });
        }
      }
    }, 60_000);
  }

  private logDebug(
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (this.config.debug) {
      this.logger.debug(message, context);
    }
  }
}

type RedisConstructor = new (options: RedisConfig) => Redis;
type RedisModule =
  | RedisConstructor
  | {
      Redis?: RedisConstructor;
      default?: RedisConstructor;
    };

function isRedisClient(value: Redis | RedisConfig): value is Redis {
  const candidate = value as Partial<Redis>;
  return (
    typeof candidate.duplicate === "function" &&
    typeof candidate.hgetall === "function" &&
    typeof candidate.hset === "function"
  );
}

function createRedisClient(redisConfig: RedisConfig): Redis {
  const RedisClient = loadRedisConstructor();
  return new RedisClient({
    host: redisConfig.host || "localhost",
    port: redisConfig.port || 6379,
    password: redisConfig.password,
    db: redisConfig.db || 0,
  });
}

function loadRedisConstructor(): RedisConstructor {
  try {
    const redisModule = require("ioredis") as RedisModule;

    if (typeof redisModule === "function") {
      return redisModule;
    }

    const RedisClient = redisModule.Redis ?? redisModule.default;
    if (RedisClient) {
      return RedisClient;
    }
  } catch (error) {
    throw new AvesError({
      message: "Redis storage requires the optional ioredis dependency",
      code: "SERVER_ERROR",
      stage: "server",
      retryable: false,
      cause: error,
    });
  }

  throw new AvesError({
    message: "Unable to load Redis constructor from ioredis",
    code: "SERVER_ERROR",
    stage: "server",
    retryable: false,
  });
}
