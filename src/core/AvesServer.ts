import { WebSocket } from "ws";
import { RoomManager } from "./RoomManager";
import { SignalingHandler } from "./SignalingHandler";
import { AvesServerConfig, RoomInfo, SignalingMessage } from "../types/types";

/**
 * AvesServer is the main class for the aves-node signaling server
 * It coordinates RoomManager and SignalingHandler to provide WebRTC signaling functionality
 * Requirements: 7.1, 7.2, 7.3, 10.1, 10.2, 10.3, 10.4
 */
export class AvesServer {
  private roomManager: RoomManager;
  private signalingHandler: SignalingHandler;
  private config: AvesServerConfig;
  private userSockets: Map<string, WebSocket> = new Map();

  /**
   * Create a new AvesServer instance
   * @param config Optional configuration object
   */
  constructor(config?: AvesServerConfig) {
    this.config = {
      debug: config?.debug ?? false,
      roomTimeout: config?.roomTimeout ?? 0,
    };

    this.roomManager = new RoomManager();
    this.signalingHandler = new SignalingHandler(this.roomManager);

    if (this.config.debug) {
      console.log("[AvesServer] Initialized with config:", this.config);
    }
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
  private routeMessage(
    ws: WebSocket,
    message: any,
    setUserId: (userId: string) => void
  ): void {
    if (!message || typeof message.type !== "string") {
      this.sendError(ws, "Invalid message: missing type field");
      return;
    }

    switch (message.type) {
      case "create-room":
        this.handleCreateRoom(ws);
        break;

      case "join-room":
        this.handleJoinRoom(ws, message, setUserId);
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

      default:
        if (this.config.debug) {
          console.warn("[AvesServer] Unknown message type:", message.type);
        }
        this.sendError(ws, `Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handle create-room message
   */
  private handleCreateRoom(ws: WebSocket): void {
    const roomId = this.roomManager.createRoom();

    const response: SignalingMessage = {
      type: "room-created",
      roomId,
    };

    this.sendMessage(ws, response);

    if (this.config.debug) {
      console.log(`[AvesServer] Room created: ${roomId}`);
    }
  }

  /**
   * Handle join-room message
   */
  private handleJoinRoom(
    ws: WebSocket,
    message: any,
    setUserId: (userId: string) => void
  ): void {
    const { roomId, userId, userName } = message;

    if (!roomId || !userId || !userName) {
      this.sendError(ws, "Missing required fields: roomId, userId, userName");
      return;
    }

    // Check if room exists
    if (!this.roomManager.roomExists(roomId)) {
      this.sendError(ws, `Room ${roomId} does not exist`);
      return;
    }

    // Get current participants before joining
    const currentParticipants = this.roomManager.getRoomParticipants(roomId);

    // Join the room
    const success = this.roomManager.joinRoom(roomId, userId, userName, ws);

    if (!success) {
      this.sendError(ws, `Failed to join room ${roomId}`);
      return;
    }

    // Store user socket mapping
    this.userSockets.set(userId, ws);
    setUserId(userId);

    // Send room-joined message to the new user
    const joinedResponse: SignalingMessage = {
      type: "room-joined",
      participants: currentParticipants,
    };
    this.sendMessage(ws, joinedResponse);

    // Broadcast user-joined to other participants
    const userJoinedMessage: SignalingMessage = {
      type: "user-joined",
      user: { id: userId, name: userName },
    };
    this.roomManager.broadcastToRoom(roomId, userJoinedMessage, userId);

    if (this.config.debug) {
      console.log(`[AvesServer] User ${userId} joined room ${roomId}`);
    }
  }

  /**
   * Handle leave-room message
   */
  private handleLeaveRoom(message: any): void {
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
  private handleDisconnection(userId: string): void {
    const roomId = this.roomManager.getRoomIdByUserId(userId);

    if (!roomId) {
      return;
    }

    // Remove user from room
    this.roomManager.leaveRoom(roomId, userId);
    this.userSockets.delete(userId);

    // Broadcast user-left to remaining participants
    const userLeftMessage: SignalingMessage = {
      type: "user-left",
      userId,
    };
    this.roomManager.broadcastToRoom(roomId, userLeftMessage);

    if (this.config.debug) {
      console.log(`[AvesServer] User ${userId} left room ${roomId}`);
    }
  }

  /**
   * Handle offer message
   */
  private handleOffer(message: any): void {
    const { fromId, targetId, offer } = message;

    if (!fromId || !targetId || !offer) {
      console.warn("[AvesServer] Offer message missing required fields");
      return;
    }

    this.signalingHandler.handleOffer(fromId, targetId, offer);
  }

  /**
   * Handle answer message
   */
  private handleAnswer(message: any): void {
    const { fromId, targetId, answer } = message;

    if (!fromId || !targetId || !answer) {
      console.warn("[AvesServer] Answer message missing required fields");
      return;
    }

    this.signalingHandler.handleAnswer(fromId, targetId, answer);
  }

  /**
   * Handle ice-candidate message
   */
  private handleIceCandidate(message: any): void {
    const { fromId, targetId, candidate } = message;

    if (!fromId || !targetId || !candidate) {
      console.warn(
        "[AvesServer] ICE candidate message missing required fields"
      );
      return;
    }

    this.signalingHandler.handleIceCandidate(fromId, targetId, candidate);
  }

  /**
   * Get room information
   * Requirements: 10.3
   */
  getRoomInfo(roomId: string): RoomInfo | null {
    return this.roomManager.getRoomInfo(roomId);
  }

  /**
   * Get participant count for a room
   * Requirements: 10.4
   */
  getParticipantCount(roomId: string): number {
    const roomInfo = this.roomManager.getRoomInfo(roomId);
    return roomInfo ? roomInfo.participantCount : 0;
  }

  /**
   * Get all rooms information
   * Requirements: 10.3
   */
  getAllRooms(): RoomInfo[] {
    return this.roomManager.getAllRooms();
  }

  /**
   * Close the server and clean up resources
   */
  close(): void {
    if (this.config.debug) {
      console.log("[AvesServer] Closing server");
    }

    // Close all WebSocket connections
    this.userSockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    this.userSockets.clear();

    if (this.config.debug) {
      console.log("[AvesServer] Server closed");
    }
  }

  /**
   * Send a message to a WebSocket connection
   */
  private sendMessage(ws: WebSocket, message: SignalingMessage): void {
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
    const message: SignalingMessage = {
      type: "error",
      message: errorMessage,
    };
    this.sendMessage(ws, message);
  }
}
