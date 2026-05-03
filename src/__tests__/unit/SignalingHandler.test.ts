import { SignalingHandler } from "../../core/SignalingHandler";
import { RoomManager } from "../../core/RoomManager";
import { MemoryStorage } from "../../storage/MemoryStorage";
import { WebSocket } from "ws";
import { MockWebSocket, createMockWebSocket } from "../utils/MockWebSocket";

describe("SignalingHandler", () => {
  let roomManager: RoomManager;
  let signalingHandler: SignalingHandler;

  beforeEach(() => {
    const storage = new MemoryStorage();
    roomManager = new RoomManager(storage);
    signalingHandler = new SignalingHandler(roomManager);
  });

  describe("Message Forwarding", () => {
    it("should forward offer to target user", async () => {
      const roomId = await roomManager.createRoom();
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      await roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      await roomManager.joinRoom(roomId, "user2", "Bob", socket2);

      const offer = { type: "offer" as const, sdp: "test-sdp" };
      await signalingHandler.handleOffer("user1", "user2", offer);

      expect((socket2 as any).sentMessages).toHaveLength(1);
      const message = JSON.parse((socket2 as any).sentMessages[0]);
      expect(message.type).toBe("offer");
      expect(message.fromId).toBe("user1");
      expect(message.targetId).toBe("user2");
    });

    it("should forward answer to target user", async () => {
      const roomId = await roomManager.createRoom();
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      await roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      await roomManager.joinRoom(roomId, "user2", "Bob", socket2);

      const answer = { type: "answer" as const, sdp: "test-sdp" };
      await signalingHandler.handleAnswer("user2", "user1", answer);

      expect((socket1 as any).sentMessages).toHaveLength(1);
      const message = JSON.parse((socket1 as any).sentMessages[0]);
      expect(message.type).toBe("answer");
    });

    it("should forward ICE candidate to target user", async () => {
      const roomId = await roomManager.createRoom();
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      await roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      await roomManager.joinRoom(roomId, "user2", "Bob", socket2);

      const candidate = { candidate: "test-candidate" };
      await signalingHandler.handleIceCandidate("user1", "user2", candidate);

      expect((socket2 as any).sentMessages).toHaveLength(1);
      const message = JSON.parse((socket2 as any).sentMessages[0]);
      expect(message.type).toBe("ice-candidate");
    });
  });

  describe("Error Handling", () => {
    it("should handle forwarding to non-existent user", async () => {
      const offer = { type: "offer" as const, sdp: "test-sdp" };
      await expect(
        signalingHandler.handleOffer("user1", "non-existent", offer),
      ).resolves.not.toThrow();
    });

    it("should handle invalid offer", async () => {
      const roomId = await roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;
      await roomManager.joinRoom(roomId, "user1", "Alice", socket);

      const invalidOffer = { type: "offer" as const, sdp: "" };
      await expect(
        signalingHandler.handleOffer("user2", "user1", invalidOffer),
      ).resolves.not.toThrow();
    });

    it("should handle invalid answer", async () => {
      const roomId = await roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;
      await roomManager.joinRoom(roomId, "user1", "Alice", socket);

      const invalidAnswer = { type: "answer" as const, sdp: "" };
      await expect(
        signalingHandler.handleAnswer("user2", "user1", invalidAnswer),
      ).resolves.not.toThrow();
    });

    it("should handle invalid ICE candidate", async () => {
      const roomId = await roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;
      await roomManager.joinRoom(roomId, "user1", "Alice", socket);

      const invalidCandidate = { candidate: "" };
      await expect(
        signalingHandler.handleIceCandidate("user2", "user1", invalidCandidate),
      ).resolves.not.toThrow();
    });

    it("should handle closed WebSocket connection gracefully", async () => {
      const roomId = await roomManager.createRoom();
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      await roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      await roomManager.joinRoom(roomId, "user2", "Bob", socket2);

      // Close the target socket
      (socket2 as any).readyState = WebSocket.CLOSED;

      const offer = { type: "offer" as const, sdp: "test-sdp" };
      await signalingHandler.handleOffer("user1", "user2", offer);

      // Message should not be sent to closed socket
      expect((socket2 as any).sentMessages).toHaveLength(0);
    });

    it("should not forward answer to non-existent user", async () => {
      const answer = { type: "answer" as const, sdp: "test-sdp" };
      await expect(
        signalingHandler.handleAnswer("user1", "non-existent", answer),
      ).resolves.not.toThrow();
    });

    it("should not forward ICE candidate to non-existent user", async () => {
      const candidate = { candidate: "test-candidate" };
      await expect(
        signalingHandler.handleIceCandidate("user1", "non-existent", candidate),
      ).resolves.not.toThrow();
    });
  });

  describe("Message Validation", () => {
    it("should reject non-object messages and messages with invalid peer ids", () => {
      expect(signalingHandler.validateSignalingMessage(null)).toBe(false);
      expect(signalingHandler.validateSignalingMessage("offer")).toBe(false);
      expect(
        signalingHandler.validateSignalingMessage({
          type: "offer",
          fromId: "",
          targetId: "user2",
          offer: { type: "offer", sdp: "sdp" },
        }),
      ).toBe(false);
      expect(
        signalingHandler.validateSignalingMessage({
          type: "offer",
          fromId: "user1",
          targetId: "   ",
          offer: { type: "offer", sdp: "sdp" },
        }),
      ).toBe(false);
    });

    it("should validate offer, answer, ICE candidate, and unknown signaling messages", () => {
      expect(
        signalingHandler.validateSignalingMessage({
          type: "offer",
          fromId: "user1",
          targetId: "user2",
          offer: { type: "offer", sdp: "offer-sdp" },
        }),
      ).toBe(true);
      expect(
        signalingHandler.validateSignalingMessage({
          type: "answer",
          fromId: "user2",
          targetId: "user1",
          answer: { type: "answer", sdp: "answer-sdp" },
        }),
      ).toBe(true);
      expect(
        signalingHandler.validateSignalingMessage({
          type: "ice-candidate",
          fromId: "user1",
          targetId: "user2",
          candidate: { candidate: "candidate-data" },
        }),
      ).toBe(true);
      expect(
        signalingHandler.validateSignalingMessage({
          type: "offer",
          fromId: "user1",
          targetId: "user2",
          offer: { type: "answer", sdp: "wrong-type" },
        }),
      ).toBe(false);
      expect(
        signalingHandler.validateSignalingMessage({
          type: "unknown",
          fromId: "user1",
          targetId: "user2",
        }),
      ).toBe(false);
    });

    it("should reject malformed descriptions and invalid ICE metadata", () => {
      expect(
        signalingHandler.validateSignalingMessage({
          type: "offer",
          fromId: "user1",
          targetId: "user2",
          offer: null,
        }),
      ).toBe(false);
      expect(
        signalingHandler.validateSignalingMessage({
          type: "answer",
          fromId: "user2",
          targetId: "user1",
          answer: "answer-sdp",
        }),
      ).toBe(false);
      expect(
        signalingHandler.validateSignalingMessage({
          type: "ice-candidate",
          fromId: "user1",
          targetId: "user2",
          candidate: null,
        }),
      ).toBe(false);
      expect(
        signalingHandler.validateSignalingMessage({
          type: "ice-candidate",
          fromId: "user1",
          targetId: "user2",
          candidate: {
            candidate: "candidate-data",
            sdpMid: null,
            sdpMLineIndex: 0,
          },
        }),
      ).toBe(true);
      expect(
        signalingHandler.validateSignalingMessage({
          type: "ice-candidate",
          fromId: "user1",
          targetId: "user2",
          candidate: { candidate: "candidate-data", sdpMid: 7 },
        }),
      ).toBe(false);
      expect(
        signalingHandler.validateSignalingMessage({
          type: "ice-candidate",
          fromId: "user1",
          targetId: "user2",
          candidate: { candidate: "candidate-data", sdpMLineIndex: 1.5 },
        }),
      ).toBe(false);
      expect(
        signalingHandler.validateSignalingMessage({
          type: "ice-candidate",
          fromId: "user1",
          targetId: "user2",
          candidate: { candidate: "candidate-data", sdpMLineIndex: "0" },
        }),
      ).toBe(false);
    });

    it("should emit structured errors for invalid signaling payloads", async () => {
      const errorListener = jest.fn();
      signalingHandler.onError(errorListener);

      await signalingHandler.handleOffer("user1", "user2", {
        type: "offer",
        sdp: "",
      });
      await signalingHandler.handleAnswer("user2", "user1", {
        type: "answer",
        sdp: "",
      });
      await signalingHandler.handleIceCandidate("user1", "user2", {
        candidate: "",
      });

      expect(errorListener).toHaveBeenCalledTimes(3);
      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "INVALID_MESSAGE",
          stage: "signaling",
          retryable: false,
        }),
      );
    });
  });
});
