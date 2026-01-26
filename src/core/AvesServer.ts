import { WebSocket } from "ws";
import { Redis } from "ioredis";
import { RoomManager } from "./RoomManager";
import { SignalingHandler } from "./SignalingHandler";
import {
  AvesServerConfig,
  RoomInfo,
  InboundSignalingMessage,
  OutboundSignalingMessage,
  RedisConfig,
} from "../types/types";
import { IDataStorage } from "../storage/IDataStorage";
import { MemoryStorage } from "../storage/MemoryStorage";
import { RedisStorage } from "../storage/RedisStorage";
import * as crypto from "crypto";

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

  /**
   * Create a new AvesServer instance
   * @param config Optional configuration object
   */
  constructor(config?: AvesServerConfig) {
    this.config = {
      debug: config?.debug ?? false,
      roomTimeout: config?.roomTimeout ?? 0,
      redis: config?.redis,
    };

    this.storage = this.initializeStorage();
    this.roomManager = new RoomManager(this.storage);
    this.signalingHandler = new SignalingHandler(this.roomManager);

    if (this.config.debug) {
      console.log("[AvesServer] Initialized with config:", this.config);
    }
  }

  private initializeStorage(): IDataStorage {
    if (this.config.redis) {
      let redisClient: Redis;

      if (this.config.redis instanceof Redis) {
        redisClient = this.config.redis;
      } else {
        const redisConfig = this.config.redis as RedisConfig;
        redisClient = new Redis({
          host: redisConfig.host || "localhost",
          port: redisConfig.port || 6379,
          password: redisConfig.password,
          db: redisConfig.db || 0,
        });
      }

      return new RedisStorage(redisClient);
    }

    return new MemoryStorage();
  }

  /**
   * Handle a new WebSocket connection
   * Sets up message routing and connection lifecycle management
   * Requirements: 7.3
   */
  handleConnection(ws: WebSocket): void {
    if (this.config.debug) {
      console.log("[AvesServer] New WebSocket connection");
    }

    this.connections.add(ws);
    let currentUserId: string | undefined;

    // Handle incoming messages
    ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        if (this.config.debug) {
          console.log("[AvesServer] Received message:", message);
        }

        this.routeMessage(ws, message, (userId) => {
          currentUserId = userId;
        }).catch((error) => {
          console.error("[AvesServer] Error handling message:", error);
        });
      } catch (error) {
        console.error("[AvesServer] Failed to parse message:", error);
        this.sendError(ws, "Invalid message format");
      }
    });

    // Handle connection close
    ws.on("close", () => {
      if (this.config.debug) {
        console.log("[AvesServer] WebSocket connection closed");
      }

      this.connections.delete(ws);

      if (currentUserId) {
        this.handleDisconnection(currentUserId);
      }
    });

    // Handle connection errors
    ws.on("error", (error) => {
      console.error("[AvesServer] WebSocket error:", error);
    });
  }

  /**
   * Route incoming messages to appropriate handlers
   * Requirements: 7.3
   */
  private async routeMessage(
    ws: WebSocket,
    message: unknown,
    setUserId: (userId: string) => void,
  ): Promise<void> {
    if (!this.isValidInboundMessage(message)) {
      this.sendError(ws, "Invalid message: missing or invalid type field");
      return;
    }

    switch (message.type) {
      case "create-room":
        await this.handleCreateRoom(ws, message);
        break;

      case "join-room":
        await this.handleJoinRoom(ws, message, setUserId);
        break;

      case "leave-room":
        this.handleLeaveRoom(message);
        break;

      case "offer":
        this.handleOffer(message);
        break;

      case "answer":
        this.handleAnswer(message);
        break;

      case "ice-candidate":
        this.handleIceCandidate(message);
        break;

      default: {
        const exhaustiveCheck: never = message;
        if (this.config.debug) {
          console.warn(
            "[AvesServer] Unknown message type:",
            (exhaustiveCheck as { type: string }).type,
          );
        }
        this.sendError(
          ws,
          `Unknown message type: ${(message as { type: string }).type}`,
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
    };

    this.sendMessage(ws, response);

    if (this.config.debug) {
      console.log(`[AvesServer] Room created: ${roomId}`, options);
    }
  }

  /**
   * Handle join-room message
   */
  private async handleJoinRoom(
    ws: WebSocket,
    message: Extract<InboundSignalingMessage, { type: "join-room" }>,
    setUserId: (userId: string) => void,
  ): Promise<void> {
    const { roomId, userName, password } = message;
    let userId = message.userId;

    if (!roomId || !userName) {
      this.sendError(ws, "Missing required fields: roomId, userName");
      return;
    }

    if (!userId) {
      userId = this.generateUserId();
    }

    const roomExists = await this.roomManager.roomExists(roomId);
    if (!roomExists) {
      this.sendError(ws, `Room ${roomId} does not exist`);
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
        `Failed to join room ${roomId}. Check password or room capacity.`,
      );
      return;
    }

    setUserId(userId);

    const joinedResponse: OutboundSignalingMessage = {
      type: "room-joined",
      participants: currentParticipants,
      userId,
    };
    this.sendMessage(ws, joinedResponse);

    const userJoinedMessage: OutboundSignalingMessage = {
      type: "user-joined",
      user: { id: userId, name: userName },
    };
    await this.roomManager.broadcastToRoom(roomId, userJoinedMessage, userId);

    if (this.config.debug) {
      console.log(`[AvesServer] User ${userId} joined room ${roomId}`);
    }
  }

  private generateUserId(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  /**
   * Handle leave-room message
   */
  private handleLeaveRoom(
    message: Extract<InboundSignalingMessage, { type: "leave-room" }>,
  ): void {
    const { userId } = message;

    if (!userId) {
      console.warn("[AvesServer] Leave room message missing userId");
      return;
    }

    this.handleDisconnection(userId);
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
      console.log(`[AvesServer] User ${userId} left room ${roomId}`);
    }
  }

  /**
   * Handle offer message
   */
  private handleOffer(
    message: Extract<InboundSignalingMessage, { type: "offer" }>,
  ): void {
    this.signalingHandler.handleOffer(
      message.fromId,
      message.targetId,
      message.offer,
    );
  }

  /**
   * Handle answer message
   */
  private handleAnswer(
    message: Extract<InboundSignalingMessage, { type: "answer" }>,
  ): void {
    this.signalingHandler.handleAnswer(
      message.fromId,
      message.targetId,
      message.answer,
    );
  }

  /**
   * Handle ice-candidate message
   */
  private handleIceCandidate(
    message: Extract<InboundSignalingMessage, { type: "ice-candidate" }>,
  ): void {
    this.signalingHandler.handleIceCandidate(
      message.fromId,
      message.targetId,
      message.candidate,
    );
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
   * Close the server and clean up resources
   */
  close(): void {
    if (this.config.debug) {
      console.log("[AvesServer] Closing server");
    }

    for (const ws of this.connections) {
      ws.close();
    }
    this.connections.clear();

    if (this.config.debug) {
      console.log("[AvesServer] Server closed");
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
        console.error("[AvesServer] Failed to send message:", error);
      }
    }
  }

  /**
   * Send an error message to a WebSocket connection
   */
  private sendError(ws: WebSocket, errorMessage: string): void {
    const message: OutboundSignalingMessage = {
      type: "error",
      message: errorMessage,
    };
    this.sendMessage(ws, message);
  }
}
