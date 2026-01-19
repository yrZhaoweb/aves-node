import { SignalingHandler } from "../../core/SignalingHandler";
import { RoomManager } from "../../core/RoomManager";
import { WebSocket } from "ws";

// Mock WebSocket
class MockWebSocket {
  readyState = WebSocket.OPEN;
  sentMessages: string[] = [];

  send(data: string): void {
    this.sentMessages.push(data);
  }
}

describe("SignalingHandler", () => {
  let roomManager: RoomManager;
  let signalingHandler: SignalingHandler;

  beforeEach(() => {
    roomManager = new RoomManager();
    signalingHandler = new SignalingHandler(roomManager);
  });

  describe("Message Forwarding", () => {
    it("should forward offer to target user", () => {
      const roomId = roomManager.createRoom();
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      roomManager.joinRoom(roomId, "user2", "Bob", socket2);

      const offer = { type: "offer" as const, sdp: "test-sdp" };
      signalingHandler.handleOffer("user1", "user2", offer);

      expect((socket2 as any).sentMessages).toHaveLength(1);
      const message = JSON.parse((socket2 as any).sentMessages[0]);
      expect(message.type).toBe("offer");
      expect(message.fromId).toBe("user1");
      expect(message.targetId).toBe("user2");
    });

    it("should forward answer to target user", () => {
      const roomId = roomManager.createRoom();
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      roomManager.joinRoom(roomId, "user2", "Bob", socket2);

      const answer = { type: "answer" as const, sdp: "test-sdp" };
      signalingHandler.handleAnswer("user2", "user1", answer);

      expect((socket1 as any).sentMessages).toHaveLength(1);
      const message = JSON.parse((socket1 as any).sentMessages[0]);
      expect(message.type).toBe("answer");
    });

    it("should forward ICE candidate to target user", () => {
      const roomId = roomManager.createRoom();
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      roomManager.joinRoom(roomId, "user2", "Bob", socket2);

      const candidate = { candidate: "test-candidate" };
      signalingHandler.handleIceCandidate("user1", "user2", candidate);

      expect((socket2 as any).sentMessages).toHaveLength(1);
      const message = JSON.parse((socket2 as any).sentMessages[0]);
      expect(message.type).toBe("ice-candidate");
    });
  });

  describe("Message Validation", () => {
    it("should validate offer messages", () => {
      const validOffer = {
        type: "offer",
        fromId: "user1",
        targetId: "user2",
        offer: { type: "offer", sdp: "test-sdp" },
      };
      expect(signalingHandler.validateSignalingMessage(validOffer)).toBe(true);
    });

    it("should validate answer messages", () => {
      const validAnswer = {
        type: "answer",
        fromId: "user1",
        targetId: "user2",
        answer: { type: "answer", sdp: "test-sdp" },
      };
      expect(signalingHandler.validateSignalingMessage(validAnswer)).toBe(true);
    });

    it("should validate ice-candidate messages", () => {
      const validCandidate = {
        type: "ice-candidate",
        fromId: "user1",
        targetId: "user2",
        candidate: { candidate: "test-candidate" },
      };
      expect(signalingHandler.validateSignalingMessage(validCandidate)).toBe(
        true
      );
    });

    it("should reject invalid messages", () => {
      expect(signalingHandler.validateSignalingMessage(null)).toBe(false);
      expect(signalingHandler.validateSignalingMessage({})).toBe(false);
      expect(
        signalingHandler.validateSignalingMessage({ type: "unknown" })
      ).toBe(false);
    });

    it("should reject messages with missing fields", () => {
      const invalidOffer = {
        type: "offer",
        fromId: "user1",
        // missing targetId
        offer: { type: "offer", sdp: "test-sdp" },
      };
      expect(signalingHandler.validateSignalingMessage(invalidOffer)).toBe(
        false
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle forwarding to non-existent user", () => {
      const offer = { type: "offer" as const, sdp: "test-sdp" };
      expect(() => {
        signalingHandler.handleOffer("user1", "non-existent", offer);
      }).not.toThrow();
    });

    it("should handle invalid offer", () => {
      const roomId = roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;
      roomManager.joinRoom(roomId, "user1", "Alice", socket);

      const invalidOffer = { type: "offer" as const, sdp: "" };
      expect(() => {
        signalingHandler.handleOffer("user2", "user1", invalidOffer);
      }).not.toThrow();
    });

    it("should handle invalid answer", () => {
      const roomId = roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;
      roomManager.joinRoom(roomId, "user1", "Alice", socket);

      const invalidAnswer = { type: "answer" as const, sdp: "" };
      expect(() => {
        signalingHandler.handleAnswer("user2", "user1", invalidAnswer);
      }).not.toThrow();
    });

    it("should handle invalid ICE candidate", () => {
      const roomId = roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;
      roomManager.joinRoom(roomId, "user1", "Alice", socket);

      const invalidCandidate = { candidate: "" };
      expect(() => {
        signalingHandler.handleIceCandidate("user2", "user1", invalidCandidate);
      }).not.toThrow();
    });

    it("should handle closed WebSocket connection gracefully", () => {
      const roomId = roomManager.createRoom();
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      roomManager.joinRoom(roomId, "user2", "Bob", socket2);

      // Close the target socket
      (socket2 as any).readyState = WebSocket.CLOSED;

      const offer = { type: "offer" as const, sdp: "test-sdp" };
      expect(() => {
        signalingHandler.handleOffer("user1", "user2", offer);
      }).not.toThrow();

      // Message should not be sent to closed socket
      expect((socket2 as any).sentMessages).toHaveLength(0);
    });

    it("should not forward answer to non-existent user", () => {
      const answer = { type: "answer" as const, sdp: "test-sdp" };
      expect(() => {
        signalingHandler.handleAnswer("user1", "non-existent", answer);
      }).not.toThrow();
    });

    it("should not forward ICE candidate to non-existent user", () => {
      const candidate = { candidate: "test-candidate" };
      expect(() => {
        signalingHandler.handleIceCandidate("user1", "non-existent", candidate);
      }).not.toThrow();
    });
  });
});
