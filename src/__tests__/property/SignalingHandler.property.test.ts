/**
 * Property-based tests for SignalingHandler
 * Feature: webrtc-library-extraction
 *
 * Validates:
 * - signaling messages forward to the right peer
 * - validation rejects malformed payloads
 */

import * as fc from "fast-check";
import { WebSocket } from "ws";
import { SignalingHandler } from "../../core/SignalingHandler";
import { RoomManager } from "../../core/RoomManager";
import { MemoryStorage } from "../../storage/MemoryStorage";
import {
  RTCIceCandidateInit,
  RTCSessionDescriptionInit,
} from "../../types/types";

class MockWebSocket {
  readyState = WebSocket.OPEN;
  sentMessages: string[] = [];

  send(data: string): void {
    this.sentMessages.push(data);
  }
}

function createRoomManager(): RoomManager {
  return new RoomManager(new MemoryStorage());
}

const validUserIdArbitrary = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((userId) => userId.trim().length > 0)
  .map((userId) => userId.trim());

describe("SignalingHandler Property Tests", () => {
  describe("Message forwarding", () => {
    it("forwards valid offer messages to the target participant", async () => {
      await fc.assert(
        fc.asyncProperty(
          validUserIdArbitrary,
          validUserIdArbitrary,
          fc.string({ minLength: 1, maxLength: 100 }),
          async (fromId, targetId, sdp) => {
            fc.pre(fromId !== targetId);

            const roomManager = createRoomManager();
            const signalingHandler = new SignalingHandler(roomManager);
            const roomId = await roomManager.createRoom();
            const fromSocket = new MockWebSocket() as unknown as WebSocket;
            const targetSocket = new MockWebSocket() as unknown as WebSocket;

            await roomManager.joinRoom(roomId, fromId, "From User", fromSocket);
            await roomManager.joinRoom(
              roomId,
              targetId,
              "Target User",
              targetSocket,
            );

            const offer: RTCSessionDescriptionInit = { type: "offer", sdp };
            await signalingHandler.handleOffer(fromId, targetId, offer);

            expect(targetSocket.sentMessages).toHaveLength(1);
            const received = JSON.parse(targetSocket.sentMessages[0]);
            expect(received.type).toBe("offer");
            expect(received.fromId).toBe(fromId);
            expect(received.targetId).toBe(targetId);
            expect(received.offer.sdp).toBe(sdp);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("forwards valid answer messages to the target participant", async () => {
      await fc.assert(
        fc.asyncProperty(
          validUserIdArbitrary,
          validUserIdArbitrary,
          fc.string({ minLength: 1, maxLength: 100 }),
          async (fromId, targetId, sdp) => {
            fc.pre(fromId !== targetId);

            const roomManager = createRoomManager();
            const signalingHandler = new SignalingHandler(roomManager);
            const roomId = await roomManager.createRoom();
            const fromSocket = new MockWebSocket() as unknown as WebSocket;
            const targetSocket = new MockWebSocket() as unknown as WebSocket;

            await roomManager.joinRoom(roomId, fromId, "From User", fromSocket);
            await roomManager.joinRoom(
              roomId,
              targetId,
              "Target User",
              targetSocket,
            );

            const answer: RTCSessionDescriptionInit = { type: "answer", sdp };
            await signalingHandler.handleAnswer(fromId, targetId, answer);

            expect(targetSocket.sentMessages).toHaveLength(1);
            const received = JSON.parse(targetSocket.sentMessages[0]);
            expect(received.type).toBe("answer");
            expect(received.fromId).toBe(fromId);
            expect(received.targetId).toBe(targetId);
            expect(received.answer.sdp).toBe(sdp);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("forwards valid ICE candidates to the target participant", async () => {
      await fc.assert(
        fc.asyncProperty(
          validUserIdArbitrary,
          validUserIdArbitrary,
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
          fc.option(fc.integer({ min: 0, max: 10 }), { nil: null }),
          async (fromId, targetId, candidateStr, sdpMid, sdpMLineIndex) => {
            fc.pre(fromId !== targetId);

            const roomManager = createRoomManager();
            const signalingHandler = new SignalingHandler(roomManager);
            const roomId = await roomManager.createRoom();
            const fromSocket = new MockWebSocket() as unknown as WebSocket;
            const targetSocket = new MockWebSocket() as unknown as WebSocket;

            await roomManager.joinRoom(roomId, fromId, "From User", fromSocket);
            await roomManager.joinRoom(
              roomId,
              targetId,
              "Target User",
              targetSocket,
            );

            const candidate: RTCIceCandidateInit = {
              candidate: candidateStr,
              sdpMid,
              sdpMLineIndex,
            };

            await signalingHandler.handleIceCandidate(fromId, targetId, candidate);

            expect(targetSocket.sentMessages).toHaveLength(1);
            const received = JSON.parse(targetSocket.sentMessages[0]);
            expect(received.type).toBe("ice-candidate");
            expect(received.fromId).toBe(fromId);
            expect(received.targetId).toBe(targetId);
            expect(received.candidate.candidate).toBe(candidateStr);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("does not forward to a missing target participant", async () => {
      await fc.assert(
        fc.asyncProperty(
          validUserIdArbitrary,
          validUserIdArbitrary,
          fc.string({ minLength: 1, maxLength: 100 }),
          async (fromId, targetId, sdp) => {
            fc.pre(fromId !== targetId);

            const roomManager = createRoomManager();
            const signalingHandler = new SignalingHandler(roomManager);
            const roomId = await roomManager.createRoom();
            const fromSocket = new MockWebSocket() as unknown as WebSocket;
            await roomManager.joinRoom(roomId, fromId, "From User", fromSocket);

            const offer: RTCSessionDescriptionInit = { type: "offer", sdp };
            await expect(
              signalingHandler.handleOffer(fromId, targetId, offer),
            ).resolves.not.toThrow();
            expect(fromSocket.sentMessages).toHaveLength(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Message validation", () => {
    it("accepts valid signaling messages", () => {
      const roomManager = createRoomManager();
      const signalingHandler = new SignalingHandler(roomManager);

      expect(
        signalingHandler.validateSignalingMessage({
          type: "offer",
          fromId: "user1",
          targetId: "user2",
          offer: { type: "offer", sdp: "test-sdp" },
        }),
      ).toBe(true);

      expect(
        signalingHandler.validateSignalingMessage({
          type: "answer",
          fromId: "user2",
          targetId: "user1",
          answer: { type: "answer", sdp: "test-sdp" },
        }),
      ).toBe(true);

      expect(
        signalingHandler.validateSignalingMessage({
          type: "ice-candidate",
          fromId: "user1",
          targetId: "user2",
          candidate: { candidate: "test-candidate" },
        }),
      ).toBe(true);
    });

    it("rejects malformed or unsupported signaling messages", () => {
      const roomManager = createRoomManager();
      const signalingHandler = new SignalingHandler(roomManager);

      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.array(fc.anything()),
          ),
          (invalidMessage) => {
            expect(
              signalingHandler.validateSignalingMessage(invalidMessage),
            ).toBe(false);
          },
        ),
        { numRuns: 100 },
      );

      expect(signalingHandler.validateSignalingMessage({})).toBe(false);
      expect(signalingHandler.validateSignalingMessage({ type: "unknown" })).toBe(false);
      expect(
        signalingHandler.validateSignalingMessage({
          type: "offer",
          fromId: "user1",
          targetId: "user2",
          offer: { type: "offer", sdp: "" },
        }),
      ).toBe(false);
      expect(
        signalingHandler.validateSignalingMessage({
          type: "ice-candidate",
          fromId: "user1",
          targetId: "user2",
          candidate: { candidate: "" },
        }),
      ).toBe(false);
    });
  });
});
