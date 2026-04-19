import { AvesServer } from "../../core/AvesServer";
import { WebSocket } from "ws";
import { MockWebSocket, createMockWebSocket } from "../utils/MockWebSocket";

describe("AvesServer", () => {
  let server: AvesServer;

  beforeEach(() => {
    server = new AvesServer({ debug: false });
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

    it("should handle close without userId", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      expect(() => {
        (ws as any).emit("close");
      }).not.toThrow();
    });
  });

  describe("Server Configuration", () => {
    it("should work with debug enabled", async () => {
      const debugServer = new AvesServer({ debug: true });
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
  });
});
