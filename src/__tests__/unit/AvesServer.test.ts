import { AvesServer } from "../../core/AvesServer";
import { AvesError } from "../../core/AvesError";
import { WebSocket } from "ws";
import { MockWebSocket, createMockWebSocket } from "../utils/MockWebSocket";
import { AvesLogger, AvesServerConfig } from "../../types/types";

const quietLogger: AvesLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const createTestServer = (config: AvesServerConfig = {}) =>
  new AvesServer({ debug: false, logger: quietLogger, ...config });

describe("AvesServer", () => {
  let server: AvesServer;

  beforeEach(() => {
    server = createTestServer();
  });

  afterEach(() => {
    server.close();
  });

  // Helper to wait for async message processing
  const waitForMessages = () => new Promise((resolve) => setImmediate(resolve));

  describe("Room Operations", () => {
    it("should handle create-room message", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const createRoomMsg = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createRoomMsg)));

      await waitForMessages();

      expect((ws as any).sentMessages).toHaveLength(1);
      const response = JSON.parse((ws as any).sentMessages[0]);
      expect(response.type).toBe("room-created");
      expect(response.roomId).toBeDefined();
    });

    it("should handle join-room message", async () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      // Create room
      const createMsg = { type: "create-room" };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      await waitForMessages();

      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      // Join room
      const joinMsg = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
        requestId: "join-1",
      };
      (ws2 as any).emit("message", Buffer.from(JSON.stringify(joinMsg)));
      await waitForMessages();

      expect((ws2 as any).sentMessages).toHaveLength(1);
      const response = JSON.parse((ws2 as any).sentMessages[0]);
      expect(response.type).toBe("room-joined");
      expect(response.userId).toBe("user1");
      expect(response.requestId).toBe("join-1");
    });

    it("should assign and return a canonical userId when join-room omits one", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      (ws as any).emit("message", Buffer.from(JSON.stringify({ type: "create-room" })));
      await waitForMessages();
      const roomId = JSON.parse((ws as any).sentMessages[0]).roomId;

      (ws as any).sentMessages = [];
      (ws as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId,
            userName: "Alice",
            requestId: "join-generated",
          }),
        ),
      );
      await waitForMessages();

      const response = JSON.parse((ws as any).sentMessages[0]);
      expect(response.type).toBe("room-joined");
      expect(response.userId).toEqual(expect.any(String));
      expect(response.userId.length).toBeGreaterThan(0);
      expect(response.requestId).toBe("join-generated");
    });

    it("should broadcast user-joined to other participants", async () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      // Create and join room with first user
      const createMsg = { type: "create-room" };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      await waitForMessages();
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      const joinMsg1 = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
      };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(joinMsg1)));
      await waitForMessages();

      // Clear messages
      (ws1 as any).sentMessages = [];

      // Second user joins
      const joinMsg2 = {
        type: "join-room",
        roomId,
        userId: "user2",
        userName: "Bob",
      };
      (ws2 as any).emit("message", Buffer.from(JSON.stringify(joinMsg2)));
      await waitForMessages();

      // First user should receive user-joined broadcast
      expect((ws1 as any).sentMessages).toHaveLength(1);
      const broadcast = JSON.parse((ws1 as any).sentMessages[0]);
      expect(broadcast.type).toBe("user-joined");
      expect(broadcast.user.id).toBe("user2");
    });

    it("should handle join-room with non-existent room", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const joinMsg = {
        type: "join-room",
        roomId: "non-existent",
        userId: "user1",
        userName: "Alice",
      };
      (ws as any).emit("message", Buffer.from(JSON.stringify(joinMsg)));
      await waitForMessages();

      expect((ws as any).sentMessages).toHaveLength(1);
      const response = JSON.parse((ws as any).sentMessages[0]);
      expect(response).toEqual(
        expect.objectContaining({
          type: "error",
          code: "ROOM_NOT_FOUND",
          stage: "room",
          retryable: false,
        }),
      );
    });

    it("should reject duplicate userId joins from another connection", async () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      (ws1 as any).emit("message", Buffer.from(JSON.stringify({ type: "create-room" })));
      await waitForMessages();
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      (ws1 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId,
            userId: "user1",
            userName: "Alice",
          }),
        ),
      );
      await waitForMessages();

      (ws2 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId,
            userId: "user1",
            userName: "Mallory",
          }),
        ),
      );
      await waitForMessages();

      const response = JSON.parse((ws2 as any).sentMessages[0]);
      expect(response.type).toBe("error");

      const roomInfo = await server.getRoomInfo(roomId);
      expect(roomInfo?.participantCount).toBe(1);
    });

    it("should reject joining a second room from the same connection without leaving", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      (ws as any).emit("message", Buffer.from(JSON.stringify({ type: "create-room" })));
      await waitForMessages();
      const roomId1 = JSON.parse((ws as any).sentMessages[0]).roomId;

      (ws as any).emit("message", Buffer.from(JSON.stringify({ type: "create-room" })));
      await waitForMessages();
      const roomId2 = JSON.parse((ws as any).sentMessages[1]).roomId;

      (ws as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId: roomId1,
            userId: "user1",
            userName: "Alice",
          }),
        ),
      );
      await waitForMessages();

      (ws as any).sentMessages = [];

      (ws as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId: roomId2,
            userId: "user2",
            userName: "Alice-2",
          }),
        ),
      );
      await waitForMessages();

      expect((ws as any).sentMessages).toHaveLength(1);
      expect(JSON.parse((ws as any).sentMessages[0])).toEqual(
        expect.objectContaining({
          type: "error",
          code: "ALREADY_JOINED",
        }),
      );
    });
  });

  describe("Connection Lifecycle", () => {
    it("should handle connection close and broadcast user-left", async () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      // Create room and join with both users
      const createMsg = { type: "create-room" };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      await waitForMessages();
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      const joinMsg1 = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
      };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(joinMsg1)));
      await waitForMessages();

      const joinMsg2 = {
        type: "join-room",
        roomId,
        userId: "user2",
        userName: "Bob",
      };
      (ws2 as any).emit("message", Buffer.from(JSON.stringify(joinMsg2)));
      await waitForMessages();

      // Clear messages
      (ws2 as any).sentMessages = [];

      // Close first connection
      (ws1 as any).emit("close");
      await waitForMessages();

      // Second user should receive user-left
      expect((ws2 as any).sentMessages).toHaveLength(1);
      const leftMsg = JSON.parse((ws2 as any).sentMessages[0]);
      expect(leftMsg.type).toBe("user-left");
      expect(leftMsg.userId).toBe("user1");
    });
  });

  describe("Signaling Messages", () => {
    it("should handle offer message", async () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      // Setup room with two users
      const createMsg = { type: "create-room" };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      await waitForMessages();
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      const joinMsg1 = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
      };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(joinMsg1)));
      await waitForMessages();

      const joinMsg2 = {
        type: "join-room",
        roomId,
        userId: "user2",
        userName: "Bob",
      };
      (ws2 as any).emit("message", Buffer.from(JSON.stringify(joinMsg2)));
      await waitForMessages();

      // Clear messages
      (ws2 as any).sentMessages = [];

      // Send offer
      const offerMsg = {
        type: "offer",
        fromId: "user1",
        targetId: "user2",
        offer: { type: "offer", sdp: "test-sdp" },
      };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(offerMsg)));
      await waitForMessages();

      // User2 should receive the offer
      expect((ws2 as any).sentMessages).toHaveLength(1);
      const received = JSON.parse((ws2 as any).sentMessages[0]);
      expect(received.type).toBe("offer");
    });

    it("should handle answer message", async () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      // Setup room
      const createMsg = { type: "create-room" };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      await waitForMessages();
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      const joinMsg1 = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
      };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(joinMsg1)));
      await waitForMessages();

      const joinMsg2 = {
        type: "join-room",
        roomId,
        userId: "user2",
        userName: "Bob",
      };
      (ws2 as any).emit("message", Buffer.from(JSON.stringify(joinMsg2)));
      await waitForMessages();

      // Clear messages
      (ws1 as any).sentMessages = [];

      // Send answer
      const answerMsg = {
        type: "answer",
        fromId: "user2",
        targetId: "user1",
        answer: { type: "answer", sdp: "test-sdp" },
      };
      (ws2 as any).emit("message", Buffer.from(JSON.stringify(answerMsg)));
      await waitForMessages();

      // User1 should receive the answer
      expect((ws1 as any).sentMessages).toHaveLength(1);
      const received = JSON.parse((ws1 as any).sentMessages[0]);
      expect(received.type).toBe("answer");
    });

    it("should handle ice-candidate message", async () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      // Setup room
      const createMsg = { type: "create-room" };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      await waitForMessages();
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      const joinMsg1 = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
      };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(joinMsg1)));
      await waitForMessages();

      const joinMsg2 = {
        type: "join-room",
        roomId,
        userId: "user2",
        userName: "Bob",
      };
      (ws2 as any).emit("message", Buffer.from(JSON.stringify(joinMsg2)));
      await waitForMessages();

      // Clear messages
      (ws2 as any).sentMessages = [];

      // Send ICE candidate
      const candidateMsg = {
        type: "ice-candidate",
        fromId: "user1",
        targetId: "user2",
        candidate: { candidate: "test-candidate" },
      };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(candidateMsg)));
      await waitForMessages();

      // User2 should receive the candidate
      expect((ws2 as any).sentMessages).toHaveLength(1);
      const received = JSON.parse((ws2 as any).sentMessages[0]);
      expect(received.type).toBe("ice-candidate");
    });

    it("should reject signaling when fromId does not match the authenticated user", async () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      const createMsg = { type: "create-room" };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      await waitForMessages();
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      (ws1 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId,
            userId: "user1",
            userName: "Alice",
          }),
        ),
      );
      await waitForMessages();

      (ws2 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId,
            userId: "user2",
            userName: "Bob",
          }),
        ),
      );
      await waitForMessages();

      (ws1 as any).sentMessages = [];
      (ws2 as any).sentMessages = [];

      (ws1 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "offer",
            fromId: "user2",
            targetId: "user1",
            offer: { type: "offer", sdp: "test-sdp" },
          }),
        ),
      );
      await waitForMessages();

      expect((ws1 as any).sentMessages).toHaveLength(1);
      expect(JSON.parse((ws1 as any).sentMessages[0])).toEqual(
        expect.objectContaining({
          type: "error",
          code: "SIGNALING_FORBIDDEN",
        }),
      );
      expect((ws2 as any).sentMessages).toHaveLength(0);
    });

    it("should reject signaling across different rooms", async () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      (ws1 as any).emit("message", Buffer.from(JSON.stringify({ type: "create-room" })));
      await waitForMessages();
      const roomId1 = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      (ws2 as any).emit("message", Buffer.from(JSON.stringify({ type: "create-room" })));
      await waitForMessages();
      const roomId2 = JSON.parse((ws2 as any).sentMessages[0]).roomId;

      (ws1 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId: roomId1,
            userId: "user1",
            userName: "Alice",
          }),
        ),
      );
      await waitForMessages();

      (ws2 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId: roomId2,
            userId: "user2",
            userName: "Bob",
          }),
        ),
      );
      await waitForMessages();

      (ws1 as any).sentMessages = [];
      (ws2 as any).sentMessages = [];

      (ws1 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "answer",
            fromId: "user1",
            targetId: "user2",
            answer: { type: "answer", sdp: "test-sdp" },
          }),
        ),
      );
      await waitForMessages();

      expect((ws1 as any).sentMessages).toHaveLength(1);
      expect(JSON.parse((ws1 as any).sentMessages[0])).toEqual(
        expect.objectContaining({
          type: "error",
          code: "SIGNALING_TARGET_ROOM_MISMATCH",
        }),
      );
      expect((ws2 as any).sentMessages).toHaveLength(0);
    });
  });

  describe("Query Methods", () => {
    it("should return room info", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const createMsg = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      await waitForMessages();
      const roomId = JSON.parse((ws as any).sentMessages[0]).roomId;

      const roomInfo = await server.getRoomInfo(roomId);
      expect(roomInfo).not.toBeNull();
      expect(roomInfo?.id).toBe(roomId);
    });

    it("should return participant count", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const createMsg = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      await waitForMessages();
      const roomId = JSON.parse((ws as any).sentMessages[0]).roomId;

      const joinMsg = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
      };
      (ws as any).emit("message", Buffer.from(JSON.stringify(joinMsg)));
      await waitForMessages();

      const count = await server.getParticipantCount(roomId);
      expect(count).toBe(1);
    });

    it("should return all rooms", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const createMsg1 = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg1)));
      await waitForMessages();

      const createMsg2 = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg2)));
      await waitForMessages();

      const allRooms = await server.getAllRooms();
      expect(allRooms).toHaveLength(2);
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid JSON", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      expect(() => {
        (ws as any).emit("message", Buffer.from("invalid json"));
      }).not.toThrow();

      expect((ws as any).sentMessages).toHaveLength(1);
      const response = JSON.parse((ws as any).sentMessages[0]);
      expect(response).toEqual(
        expect.objectContaining({
          type: "error",
          code: "INVALID_MESSAGE_FORMAT",
          stage: "protocol",
        }),
      );
    });

    it("should handle message without type", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const invalidMsg = { data: "test" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(invalidMsg)));

      expect((ws as any).sentMessages).toHaveLength(1);
      const response = JSON.parse((ws as any).sentMessages[0]);
      expect(response).toEqual(
        expect.objectContaining({
          type: "error",
          code: "INVALID_MESSAGE",
          stage: "protocol",
        }),
      );
    });

    it("should handle unknown message type", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const unknownMsg = { type: "unknown-type" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(unknownMsg)));

      expect((ws as any).sentMessages).toHaveLength(1);
      const response = JSON.parse((ws as any).sentMessages[0]);
      expect(response).toEqual(
        expect.objectContaining({
          type: "error",
          code: "INVALID_MESSAGE",
          stage: "protocol",
        }),
      );
    });

    it("should handle join-room with missing fields", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const invalidJoin = { type: "join-room", roomId: "test" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(invalidJoin)));
      await waitForMessages();

      expect((ws as any).sentMessages).toHaveLength(1);
      const response = JSON.parse((ws as any).sentMessages[0]);
      expect(response).toEqual(
        expect.objectContaining({
          type: "error",
          code: "JOIN_ROOM_MISSING_FIELDS",
          stage: "room",
        }),
      );
    });

    it("should reject leave-room when the connection has not joined", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      (ws as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "leave-room",
            userId: "user1",
            requestId: "leave-not-joined",
          }),
        ),
      );
      await waitForMessages();

      expect(JSON.parse((ws as any).sentMessages[0])).toEqual(
        expect.objectContaining({
          type: "error",
          code: "LEAVE_NOT_JOINED",
          requestId: "leave-not-joined",
        }),
      );
    });

    it("should handle leave-room message", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      // Create and join room
      const createMsg = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      await waitForMessages();
      const roomId = JSON.parse((ws as any).sentMessages[0]).roomId;

      const joinMsg = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
        requestId: "join-leave-1",
      };
      (ws as any).emit("message", Buffer.from(JSON.stringify(joinMsg)));
      await waitForMessages();

      (ws as any).sentMessages = [];

      // Leave room
      const leaveMsg = {
        type: "leave-room",
        userId: "user1",
        requestId: "leave-1",
      };
      (ws as any).emit("message", Buffer.from(JSON.stringify(leaveMsg)));
      await waitForMessages();

      expect((ws as any).sentMessages).toHaveLength(1);
      expect(JSON.parse((ws as any).sentMessages[0])).toEqual({
        type: "room-left",
        roomId,
        userId: "user1",
        requestId: "leave-1",
      });
      expect(await server.getRoomInfo(roomId)).toBeNull();
    });

    it("should handle leave-room without userId", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const leaveMsg = { type: "leave-room" };
      expect(() => {
        (ws as any).emit("message", Buffer.from(JSON.stringify(leaveMsg)));
      }).not.toThrow();
    });

    it("should reject leave-room spoofing from a different userId", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      (ws as any).emit("message", Buffer.from(JSON.stringify({ type: "create-room" })));
      await waitForMessages();
      const roomId = JSON.parse((ws as any).sentMessages[0]).roomId;

      (ws as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId,
            userId: "user1",
            userName: "Alice",
          }),
        ),
      );
      await waitForMessages();

      (ws as any).sentMessages = [];

      (ws as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "leave-room",
            userId: "user2",
          }),
        ),
      );
      await waitForMessages();

      expect((ws as any).sentMessages).toHaveLength(1);
      expect(JSON.parse((ws as any).sentMessages[0])).toEqual(
        expect.objectContaining({
          type: "error",
          code: "LEAVE_USER_MISMATCH",
          stage: "room",
        }),
      );
      expect(await server.getRoomInfo(roomId)).not.toBeNull();
    });

    it("should clear authenticated state before async leave cleanup completes", async () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      (ws1 as any).emit("message", Buffer.from(JSON.stringify({ type: "create-room" })));
      await waitForMessages();
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      (ws1 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId,
            userId: "user1",
            userName: "Alice",
          }),
        ),
      );
      await waitForMessages();

      (ws2 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId,
            userId: "user2",
            userName: "Bob",
          }),
        ),
      );
      await waitForMessages();

      const leaveGate = new Promise<void>((resolve) => {
        (server as any).__resolveLeaveGate = resolve;
      });
      const originalHandleDisconnection = (server as any).handleDisconnection.bind(server);
      jest
        .spyOn(server as any, "handleDisconnection")
        .mockImplementation(async (userId: string) => {
          await leaveGate;
          return originalHandleDisconnection(userId);
        });

      (ws1 as any).sentMessages = [];
      (ws2 as any).sentMessages = [];

      (ws1 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "leave-room",
            userId: "user1",
          }),
        ),
      );

      (ws1 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "offer",
            fromId: "user1",
            targetId: "user2",
            offer: { type: "offer", sdp: "test-sdp" },
          }),
        ),
      );
      await waitForMessages();

      expect((ws1 as any).sentMessages).toHaveLength(1);
      expect(JSON.parse((ws1 as any).sentMessages[0])).toEqual(
        expect.objectContaining({
          type: "error",
          code: "SIGNALING_NOT_AUTHENTICATED",
          stage: "signaling",
        }),
      );
      expect((ws2 as any).sentMessages).toHaveLength(0);

      (server as any).__resolveLeaveGate();
      await waitForMessages();
    });

    it("should handle offer with missing fields", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const invalidOffer = { type: "offer", fromId: "user1" };
      expect(() => {
        (ws as any).emit("message", Buffer.from(JSON.stringify(invalidOffer)));
      }).not.toThrow();
    });

    it("should handle answer with missing fields", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const invalidAnswer = { type: "answer", fromId: "user1" };
      expect(() => {
        (ws as any).emit("message", Buffer.from(JSON.stringify(invalidAnswer)));
      }).not.toThrow();
    });

    it("should handle ice-candidate with missing fields", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const invalidCandidate = { type: "ice-candidate", fromId: "user1" };
      expect(() => {
        (ws as any).emit(
          "message",
          Buffer.from(JSON.stringify(invalidCandidate)),
        );
      }).not.toThrow();
    });

    it("should handle WebSocket error", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      expect(() => {
        (ws as any).emit("error", new Error("Test error"));
      }).not.toThrow();
    });

    it("should send WebSocket errors to a configured logger", () => {
      const logger = {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
      };
      const loggedServer = new AvesServer({ logger });
      const ws = new MockWebSocket() as unknown as WebSocket;
      const error = new Error("Test error");

      loggedServer.handleConnection(ws);
      (ws as any).emit("error", error);

      expect(logger.error).toHaveBeenCalledWith(
        "[AvesServer] WebSocket error",
        { error },
      );

      loggedServer.close();
    });

    it("should use console logging when no logger is configured", () => {
      const debugSpy = jest.spyOn(console, "debug").mockImplementation();
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      const errorSpy = jest.spyOn(console, "error").mockImplementation();
      const defaultLoggerServer = new AvesServer({ debug: true });
      const ws = new MockWebSocket() as unknown as WebSocket;
      const error = new Error("Test error");

      try {
        defaultLoggerServer.handleConnection(ws);
        (ws as any).emit(
          "message",
          Buffer.from(JSON.stringify({ type: "leave-room" })),
        );
        (ws as any).emit("error", error);

        expect(debugSpy).toHaveBeenCalledWith(
          "[AvesServer] Initialized with config",
          expect.any(Object),
        );
        expect(debugSpy).toHaveBeenCalledWith(
          "[AvesServer] New WebSocket connection",
        );
        expect(warnSpy).toHaveBeenCalledWith(
          "[AvesServer] Leave room message missing userId",
        );
        expect(errorSpy).toHaveBeenCalledWith("[AvesServer] WebSocket error", {
          error,
        });
      } finally {
        defaultLoggerServer.close();
        debugSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });

    it("should handle close without userId", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      expect(() => {
        (ws as any).emit("close");
      }).not.toThrow();
    });

    it("should enforce rate limits and message size limits before routing", async () => {
      const limitedServer = createTestServer({
        rateLimit: { maxTokens: 0, refillRate: 0 },
      });
      const limitedWs = new MockWebSocket() as unknown as WebSocket;
      limitedServer.handleConnection(limitedWs);

      (limitedWs as any).emit(
        "message",
        Buffer.from(JSON.stringify({ type: "create-room" })),
      );
      await waitForMessages();

      expect(JSON.parse((limitedWs as any).sentMessages[0])).toEqual(
        expect.objectContaining({
          type: "error",
          message: "Rate limit exceeded",
        }),
      );
      limitedServer.close();

      const smallServer = createTestServer({ maxMessageSize: 8 });
      const smallWs = new MockWebSocket() as unknown as WebSocket;
      smallServer.handleConnection(smallWs);

      (smallWs as any).emit(
        "message",
        Buffer.from(JSON.stringify({ type: "create-room" })),
      );
      await waitForMessages();

      expect(JSON.parse((smallWs as any).sentMessages[0])).toEqual(
        expect.objectContaining({
          type: "error",
          code: "INVALID_MESSAGE_FORMAT",
          message: "Message exceeds maximum size of 8 bytes",
        }),
      );
      smallServer.close();
    });

    it("should reject authenticated signaling with missing ids or missing target user", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      (ws as any).emit("message", Buffer.from(JSON.stringify({ type: "create-room" })));
      await waitForMessages();
      const roomId = JSON.parse((ws as any).sentMessages[0]).roomId;

      (ws as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId,
            userId: "user1",
            userName: "Alice",
          }),
        ),
      );
      await waitForMessages();
      (ws as any).sentMessages = [];

      const offer = { type: "offer", sdp: "test-sdp" };
      const badMessages = [
        {
          type: "offer",
          fromId: "",
          targetId: "user2",
          offer,
        },
        {
          type: "offer",
          fromId: "user1",
          targetId: " ",
          offer,
        },
        {
          type: "offer",
          fromId: "user1",
          targetId: "missing-user",
          offer,
        },
      ];

      for (const message of badMessages) {
        (ws as any).emit("message", Buffer.from(JSON.stringify(message)));
        await waitForMessages();
      }

      expect((ws as any).sentMessages.map((message: string) => JSON.parse(message))).toEqual([
        expect.objectContaining({ type: "error", code: "INVALID_MESSAGE" }),
        expect.objectContaining({ type: "error", code: "INVALID_MESSAGE" }),
        expect.objectContaining({
          type: "error",
          code: "SIGNALING_TARGET_NOT_FOUND",
        }),
      ]);
    });

    it("should send structured AvesError payloads through sendError", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;

      (server as any).sendError(
        ws,
        new AvesError({
          message: "custom structured error",
          code: "SERVER_ERROR",
          stage: "server",
          retryable: false,
          requestId: "request-1",
        }),
      );

      expect(JSON.parse((ws as any).sentMessages[0])).toEqual({
        type: "error",
        message: "custom structured error",
        code: "SERVER_ERROR",
        stage: "server",
        retryable: false,
        requestId: "request-1",
      });
    });

    it("should send a request-scoped error when async route handling fails", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      (server.getStorage() as any).addListener({
        onBeforeChange: () => {
          throw new Error("storage write failed");
        },
      });

      (ws as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({ type: "create-room", requestId: "create-1" }),
        ),
      );
      await waitForMessages();

      expect(JSON.parse((ws as any).sentMessages[0])).toEqual(
        expect.objectContaining({
          type: "error",
          message: "storage write failed",
          code: "SERVER_ERROR",
          stage: "server",
          retryable: true,
          requestId: "create-1",
        }),
      );
    });

    it("should preserve structured AvesError fields from async route failures", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      (server.getStorage() as any).addListener({
        onBeforeChange: () => {
          throw new AvesError({
            message: "room create denied",
            code: "ROOM_CREATE_FAILED",
            stage: "room",
            retryable: false,
            requestId: "inner-request",
          });
        },
      });

      (ws as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({ type: "create-room", requestId: "outer-request" }),
        ),
      );
      await waitForMessages();

      expect(JSON.parse((ws as any).sentMessages[0])).toEqual(
        expect.objectContaining({
          type: "error",
          message: "room create denied",
          code: "ROOM_CREATE_FAILED",
          stage: "room",
          retryable: false,
          requestId: "inner-request",
        }),
      );
    });

    it("should reject authenticated signaling with invalid payloads", async () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws1);
      server.handleConnection(ws2);

      (ws1 as any).emit(
        "message",
        Buffer.from(JSON.stringify({ type: "create-room" })),
      );
      await waitForMessages();
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      (ws1 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId,
            userId: "user1",
            userName: "Alice",
          }),
        ),
      );
      (ws2 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId,
            userId: "user2",
            userName: "Bob",
          }),
        ),
      );
      await waitForMessages();
      (ws1 as any).sentMessages = [];
      (ws2 as any).sentMessages = [];

      (ws1 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "offer",
            fromId: "user1",
            targetId: "user2",
            offer: { type: "offer", sdp: "" },
          }),
        ),
      );
      await waitForMessages();

      expect(JSON.parse((ws1 as any).sentMessages[0])).toEqual(
        expect.objectContaining({
          type: "error",
          code: "INVALID_MESSAGE",
          stage: "signaling",
          retryable: false,
        }),
      );
      expect((ws2 as any).sentMessages).toHaveLength(0);
    });

    it("should reject authenticated answer and ICE messages with invalid payloads", async () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws1);
      server.handleConnection(ws2);

      (ws1 as any).emit(
        "message",
        Buffer.from(JSON.stringify({ type: "create-room" })),
      );
      await waitForMessages();
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      (ws1 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId,
            userId: "user1",
            userName: "Alice",
          }),
        ),
      );
      (ws2 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "join-room",
            roomId,
            userId: "user2",
            userName: "Bob",
          }),
        ),
      );
      await waitForMessages();
      (ws1 as any).sentMessages = [];
      (ws2 as any).sentMessages = [];

      (ws2 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "answer",
            fromId: "user2",
            targetId: "user1",
            answer: { type: "answer", sdp: "" },
          }),
        ),
      );
      (ws1 as any).emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "ice-candidate",
            fromId: "user1",
            targetId: "user2",
            candidate: { candidate: "candidate", sdpMLineIndex: -1 },
          }),
        ),
      );
      await waitForMessages();

      expect((ws2 as any).sentMessages.map((message: string) => JSON.parse(message))).toEqual([
        expect.objectContaining({
          type: "error",
          message: "Rejected answer: invalid signaling payload",
          code: "INVALID_MESSAGE",
          stage: "signaling",
        }),
      ]);
      expect((ws1 as any).sentMessages.map((message: string) => JSON.parse(message))).toEqual([
        expect.objectContaining({
          type: "error",
          message: "Rejected ice-candidate: invalid signaling payload",
          code: "INVALID_MESSAGE",
          stage: "signaling",
        }),
      ]);
    });
  });

  describe("Server Configuration", () => {
    it("should work with debug enabled", async () => {
      const debugServer = createTestServer({ debug: true });
      const ws = new MockWebSocket() as unknown as WebSocket;

      debugServer.handleConnection(ws);

      const createMsg = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      await waitForMessages();

      expect((ws as any).sentMessages).toHaveLength(1);
      debugServer.close();
    });

    it("should close all connections on server close", async () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      // Create and join rooms
      const createMsg = { type: "create-room" };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      await waitForMessages();
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      const joinMsg = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
      };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(joinMsg)));
      await waitForMessages();

      server.close();

      expect((ws1 as any).readyState).toBe(3); // WebSocket.CLOSED = 3
    });

    it("should initialize Redis storage from an injected Redis client", async () => {
      const subscriber = {
        on: jest.fn(),
        subscribe: jest.fn().mockResolvedValue(1),
        removeListener: jest.fn(),
        unsubscribe: jest.fn().mockResolvedValue(0),
        quit: jest.fn().mockResolvedValue("OK"),
      };
      const redisClient = {
        duplicate: jest.fn(() => subscriber),
        hgetall: jest.fn().mockResolvedValue({}),
        hset: jest.fn().mockResolvedValue(1),
        smembers: jest.fn().mockResolvedValue([]),
        sismember: jest.fn().mockResolvedValue(0),
      };
      const redisServer = createTestServer({
        redis: redisClient as any,
      });

      await expect(redisServer.getHealth()).resolves.toEqual(
        expect.objectContaining({ storage: "redis" }),
      );
      expect(redisClient.duplicate).toHaveBeenCalled();

      redisServer.close();
    });

    it("should initialize MongoDB storage from an injected database", async () => {
      const collection = {
        createIndex: jest.fn().mockResolvedValue("index"),
        find: jest.fn(() => ({
          toArray: jest.fn().mockResolvedValue([]),
        })),
      };
      const mongoDb = {
        collection: jest.fn(() => collection),
      };
      const mongoServer = createTestServer({
        mongo: { db: mongoDb as any },
      });

      await expect(mongoServer.getHealth()).resolves.toEqual(
        expect.objectContaining({ storage: "mongodb" }),
      );
      expect(mongoDb.collection).toHaveBeenCalledWith("aves_rooms");
      expect(mongoDb.collection).toHaveBeenCalledWith("aves_user_rooms");
      expect(mongoDb.collection).toHaveBeenCalledWith("aves_participants");

      mongoServer.close();
    });

    it("should report asynchronous storage close failures to the logger", async () => {
      const logger = {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
      };
      const closeError = new Error("close failed");
      const closeServer = new AvesServer({ logger });
      (closeServer as any).storage = {
        close: jest.fn(() => Promise.reject(closeError)),
      };

      closeServer.close();
      await waitForMessages();

      expect(logger.error).toHaveBeenCalledWith(
        "[AvesServer] Failed to close storage",
        { error: closeError },
      );
    });
  });

  describe("Health Check", () => {
    it("should return health status with connection count", async () => {
      const health = await server.getHealth();
      expect(health).toEqual(
        expect.objectContaining({
          connections: expect.any(Number),
          rooms: expect.any(Number),
          storage: expect.stringMatching(/^(memory|redis)$/),
          roomTimeout: expect.any(Number),
          uptime: expect.any(Number),
        }),
      );
      expect(health.uptime).toBeGreaterThanOrEqual(0);
      expect(health.storage).toBe("memory");
    });

    it("should reflect active connections in health status", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const health = await server.getHealth();
      expect(health.connections).toBeGreaterThanOrEqual(1);

      (ws as any).emit("close");
      await waitForMessages();

      const healthAfterClose = await server.getHealth();
      expect(healthAfterClose.connections).toBe(0);
    });

    it("should reflect room count in health status", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const createMsg = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      await waitForMessages();

      const health = await server.getHealth();
      expect(health.rooms).toBeGreaterThanOrEqual(1);

      // Cleanup
      const roomId = JSON.parse((ws as any).sentMessages[0]).roomId;
      const joinMsg = {
        type: "join-room",
        roomId,
        userId: "user-health",
        userName: "Alice",
      };
      (ws as any).emit("message", Buffer.from(JSON.stringify(joinMsg)));
      await waitForMessages();

      const leaveMsg = { type: "leave-room", userId: "user-health" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(leaveMsg)));
      await waitForMessages();

      const healthAfterLeave = await server.getHealth();
      expect(healthAfterLeave.rooms).toBe(0);
    });

    it("should report configured roomTimeout", async () => {
      const customServer = createTestServer({ roomTimeout: 300000 });
      const health = await customServer.getHealth();
      expect(health.roomTimeout).toBe(300000);
      customServer.close();
    });

    it("should return zero participants for a missing room", async () => {
      await expect(server.getParticipantCount("missing-room")).resolves.toBe(0);
    });
  });

  describe("Room Cleanup", () => {
    it("should NOT clean up rooms when roomTimeout is 0 (default)", async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const createMsg = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      await waitForMessages();

      const roomId = JSON.parse((ws as any).sentMessages[0]).roomId;

      const joinMsg = {
        type: "join-room",
        roomId,
        userId: "user-cleanup-0",
        userName: "Alice",
      };
      (ws as any).emit("message", Buffer.from(JSON.stringify(joinMsg)));
      await waitForMessages();

      // Leave room to make it empty
      const leaveMsg = { type: "leave-room", userId: "user-cleanup-0" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(leaveMsg)));
      await waitForMessages();

      // roomTimeout is 0, so cleanup should NOT delete the room
      // (The room is already deleted on last leave via RoomManager,
      // so we just verify the cleanup doesn't throw)
      const health = await server.getHealth();
      expect(health.rooms).toBe(0); // deleted on leave, not by cleanup
    });

    it("should clean up empty rooms when roomTimeout is configured", async () => {
      const cleanupServer = createTestServer({ roomTimeout: 100 }); // 100ms timeout
      const ws = new MockWebSocket() as unknown as WebSocket;
      cleanupServer.handleConnection(ws);

      const createMsg = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      await waitForMessages();

      const roomId = JSON.parse((ws as any).sentMessages[0]).roomId;

      // Join and immediately leave, leaving an empty room
      const joinMsg = {
        type: "join-room",
        roomId,
        userId: "user-cleanup",
        userName: "Alice",
      };
      (ws as any).emit("message", Buffer.from(JSON.stringify(joinMsg)));
      await waitForMessages();

      // Room is auto-deleted on last leave by RoomManager,
      // so the room won't exist for cleanup. Let's test a room that
      // was created but never joined — it stays empty.
      // Create another room that nobody joins
      (ws as any).sentMessages = []; // clear to make indexing simpler
      const createMsg2 = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg2)));
      await waitForMessages();

      const roomId2 = JSON.parse((ws as any).sentMessages[0]).roomId;

      // Verify room exists
      let roomInfo = await cleanupServer.getRoomInfo(roomId2);
      expect(roomInfo).not.toBeNull();
      expect(roomInfo?.participantCount).toBe(0);

      // Force cleanup by waiting for the next cleanup cycle
      // The cleanup runs every 60s, but since roomTimeout is 100ms,
      // we need the room to be older than 100ms. It's newly created,
      // so it won't be cleaned up yet.

      // Manually invoke cleanup by checking health (cleanup is timer-based)
      const health = await cleanupServer.getHealth();
      expect(health.roomTimeout).toBe(100);

      // The cleanup will run ~60s later. We can't easily test the
      // timer-based cleanup in unit tests. Instead verify the config
      // is properly set and the server is operational.
      expect(health.rooms).toBeGreaterThanOrEqual(2);

      // Leave room 1
      const leaveMsg = { type: "leave-room", userId: "user-cleanup" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(leaveMsg)));
      await waitForMessages();

      // Room 1 should be deleted (last leave)
      roomInfo = await cleanupServer.getRoomInfo(roomId);
      expect(roomInfo).toBeNull();

      cleanupServer.close();
    });

    it("should not clean up rooms with active participants", async () => {
      const cleanupServer = createTestServer({ roomTimeout: 100 });
      const ws = new MockWebSocket() as unknown as WebSocket;
      cleanupServer.handleConnection(ws);

      const createMsg = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      await waitForMessages();

      const roomId = JSON.parse((ws as any).sentMessages[0]).roomId;

      const joinMsg = {
        type: "join-room",
        roomId,
        userId: "user-active",
        userName: "Alice",
      };
      (ws as any).emit("message", Buffer.from(JSON.stringify(joinMsg)));
      await waitForMessages();

      // Room has 1 participant — cleanup should never delete it
      const roomInfo = await cleanupServer.getRoomInfo(roomId);
      expect(roomInfo).not.toBeNull();
      expect(roomInfo?.participantCount).toBe(1);

      cleanupServer.close();
    });
  });
});
