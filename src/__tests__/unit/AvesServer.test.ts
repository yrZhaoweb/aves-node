import { AvesServer } from "../../core/AvesServer";
import { WebSocket } from "ws";
import { EventEmitter } from "events";

// Mock WebSocket that extends EventEmitter
class MockWebSocket extends EventEmitter {
  readyState: number = 1; // WebSocket.OPEN = 1, WebSocket.CLOSED = 3
  sentMessages: string[] = [];

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = 3; // WebSocket.CLOSED
    this.emit("close");
  }
}

describe("AvesServer", () => {
  let server: AvesServer;

  beforeEach(() => {
    server = new AvesServer({ debug: false });
  });

  afterEach(() => {
    server.close();
  });

  describe("Room Operations", () => {
    it("should handle create-room message", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const createRoomMsg = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createRoomMsg)));

      expect((ws as any).sentMessages).toHaveLength(1);
      const response = JSON.parse((ws as any).sentMessages[0]);
      expect(response.type).toBe("room-created");
      expect(response.roomId).toBeDefined();
    });

    it("should handle join-room message", () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      // Create room
      const createMsg = { type: "create-room" };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(createMsg)));

      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      // Join room
      const joinMsg = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
      };
      (ws2 as any).emit("message", Buffer.from(JSON.stringify(joinMsg)));

      expect((ws2 as any).sentMessages).toHaveLength(1);
      const response = JSON.parse((ws2 as any).sentMessages[0]);
      expect(response.type).toBe("room-joined");
    });

    it("should broadcast user-joined to other participants", () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      // Create and join room with first user
      const createMsg = { type: "create-room" };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      const joinMsg1 = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
      };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(joinMsg1)));

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

      // First user should receive user-joined broadcast
      expect((ws1 as any).sentMessages).toHaveLength(1);
      const broadcast = JSON.parse((ws1 as any).sentMessages[0]);
      expect(broadcast.type).toBe("user-joined");
      expect(broadcast.user.id).toBe("user2");
    });

    it("should handle join-room with non-existent room", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const joinMsg = {
        type: "join-room",
        roomId: "non-existent",
        userId: "user1",
        userName: "Alice",
      };
      (ws as any).emit("message", Buffer.from(JSON.stringify(joinMsg)));

      expect((ws as any).sentMessages).toHaveLength(1);
      const response = JSON.parse((ws as any).sentMessages[0]);
      expect(response.type).toBe("error");
    });
  });

  describe("Connection Lifecycle", () => {
    it("should handle connection close and broadcast user-left", () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      // Create room and join with both users
      const createMsg = { type: "create-room" };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      const joinMsg1 = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
      };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(joinMsg1)));

      const joinMsg2 = {
        type: "join-room",
        roomId,
        userId: "user2",
        userName: "Bob",
      };
      (ws2 as any).emit("message", Buffer.from(JSON.stringify(joinMsg2)));

      // Clear messages
      (ws2 as any).sentMessages = [];

      // Close first connection
      (ws1 as any).emit("close");

      // Second user should receive user-left
      expect((ws2 as any).sentMessages).toHaveLength(1);
      const leftMsg = JSON.parse((ws2 as any).sentMessages[0]);
      expect(leftMsg.type).toBe("user-left");
      expect(leftMsg.userId).toBe("user1");
    });
  });

  describe("Signaling Messages", () => {
    it("should handle offer message", () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      // Setup room with two users
      const createMsg = { type: "create-room" };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      const joinMsg1 = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
      };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(joinMsg1)));

      const joinMsg2 = {
        type: "join-room",
        roomId,
        userId: "user2",
        userName: "Bob",
      };
      (ws2 as any).emit("message", Buffer.from(JSON.stringify(joinMsg2)));

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

      // User2 should receive the offer
      expect((ws2 as any).sentMessages).toHaveLength(1);
      const received = JSON.parse((ws2 as any).sentMessages[0]);
      expect(received.type).toBe("offer");
    });

    it("should handle answer message", () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      // Setup room
      const createMsg = { type: "create-room" };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      const joinMsg1 = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
      };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(joinMsg1)));

      const joinMsg2 = {
        type: "join-room",
        roomId,
        userId: "user2",
        userName: "Bob",
      };
      (ws2 as any).emit("message", Buffer.from(JSON.stringify(joinMsg2)));

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

      // User1 should receive the answer
      expect((ws1 as any).sentMessages).toHaveLength(1);
      const received = JSON.parse((ws1 as any).sentMessages[0]);
      expect(received.type).toBe("answer");
    });

    it("should handle ice-candidate message", () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      // Setup room
      const createMsg = { type: "create-room" };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      const joinMsg1 = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
      };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(joinMsg1)));

      const joinMsg2 = {
        type: "join-room",
        roomId,
        userId: "user2",
        userName: "Bob",
      };
      (ws2 as any).emit("message", Buffer.from(JSON.stringify(joinMsg2)));

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

      // User2 should receive the candidate
      expect((ws2 as any).sentMessages).toHaveLength(1);
      const received = JSON.parse((ws2 as any).sentMessages[0]);
      expect(received.type).toBe("ice-candidate");
    });
  });

  describe("Query Methods", () => {
    it("should return room info", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const createMsg = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      const roomId = JSON.parse((ws as any).sentMessages[0]).roomId;

      const roomInfo = server.getRoomInfo(roomId);
      expect(roomInfo).not.toBeNull();
      expect(roomInfo?.id).toBe(roomId);
    });

    it("should return participant count", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const createMsg = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      const roomId = JSON.parse((ws as any).sentMessages[0]).roomId;

      const joinMsg = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
      };
      (ws as any).emit("message", Buffer.from(JSON.stringify(joinMsg)));

      const count = server.getParticipantCount(roomId);
      expect(count).toBe(1);
    });

    it("should return all rooms", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const createMsg1 = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg1)));

      const createMsg2 = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg2)));

      const allRooms = server.getAllRooms();
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
      expect(response.type).toBe("error");
    });

    it("should handle message without type", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const invalidMsg = { data: "test" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(invalidMsg)));

      expect((ws as any).sentMessages).toHaveLength(1);
      const response = JSON.parse((ws as any).sentMessages[0]);
      expect(response.type).toBe("error");
    });

    it("should handle unknown message type", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const unknownMsg = { type: "unknown-type" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(unknownMsg)));

      expect((ws as any).sentMessages).toHaveLength(1);
      const response = JSON.parse((ws as any).sentMessages[0]);
      expect(response.type).toBe("error");
    });

    it("should handle join-room with missing fields", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const invalidJoin = { type: "join-room", roomId: "test" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(invalidJoin)));

      expect((ws as any).sentMessages).toHaveLength(1);
      const response = JSON.parse((ws as any).sentMessages[0]);
      expect(response.type).toBe("error");
    });

    it("should handle leave-room message", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      // Create and join room
      const createMsg = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      const roomId = JSON.parse((ws as any).sentMessages[0]).roomId;

      const joinMsg = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
      };
      (ws as any).emit("message", Buffer.from(JSON.stringify(joinMsg)));

      // Leave room
      const leaveMsg = { type: "leave-room", userId: "user1" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(leaveMsg)));

      expect(server.getRoomInfo(roomId)).toBeNull();
    });

    it("should handle leave-room without userId", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      server.handleConnection(ws);

      const leaveMsg = { type: "leave-room" };
      expect(() => {
        (ws as any).emit("message", Buffer.from(JSON.stringify(leaveMsg)));
      }).not.toThrow();
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
          Buffer.from(JSON.stringify(invalidCandidate))
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
    it("should work with debug enabled", () => {
      const debugServer = new AvesServer({ debug: true });
      const ws = new MockWebSocket() as unknown as WebSocket;

      debugServer.handleConnection(ws);

      const createMsg = { type: "create-room" };
      (ws as any).emit("message", Buffer.from(JSON.stringify(createMsg)));

      expect((ws as any).sentMessages).toHaveLength(1);
      debugServer.close();
    });

    it("should close all connections on server close", () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      server.handleConnection(ws1);
      server.handleConnection(ws2);

      // Create and join rooms
      const createMsg = { type: "create-room" };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(createMsg)));
      const roomId = JSON.parse((ws1 as any).sentMessages[0]).roomId;

      const joinMsg = {
        type: "join-room",
        roomId,
        userId: "user1",
        userName: "Alice",
      };
      (ws1 as any).emit("message", Buffer.from(JSON.stringify(joinMsg)));

      server.close();

      expect((ws1 as any).readyState).toBe(3); // WebSocket.CLOSED = 3
    });
  });
});
