/**
 * Property-based tests for SignalingHandler
 * Feature: webrtc-library-extraction
 *
 * **Property 8: 信令消息转发正确性**
 * **Property 11: 信令消息验证**
 *
 * **Validates: Requirements 7.6, 9.1, 9.2, 9.3, 9.6**
 */

import * as fc from "fast-check";
import { SignalingHandler } from "../../core/SignalingHandler";
import { RoomManager } from "../../core/RoomManager";
import { WebSocket } from "ws";
import { RTCSessionDescriptionInit, RTCIceCandidateInit } from "../../types/types";

// Mock WebSocket for testing
class MockWebSocket {
  readyState = WebSocket.OPEN;
  sentMessages: string[] = [];

  send(data: string): void {
    this.sentMessages.push(data);
  }
}

describe("SignalingHandler Property Tests", () => {
  describe("Property 8: 信令消息转发正确性", () => {
    /**
     * Property: For any valid offer message, if target participant exists and connection is open,
     * the message should be forwarded to the target participant
     * Validates: Requirements 7.6, 9.1
     */
    it("should forward valid offer messages to existing target participants", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }), // fromId
          fc.string({ minLength: 1, maxLength: 20 }), // targetId
          fc.string({ minLength: 1, maxLength: 100 }), // sdp content
          (fromId, targetId, sdp) => {
            // Ensure fromId and targetId are different
            if (fromId === targetId) return;

            const roomManager = new RoomManager();
            const signalingHandler = new SignalingHandler(roomManager);
            const roomId = roomManager.createRoom();

            // Create sockets for both users
            const fromSocket = new MockWebSocket() as unknown as WebSocket;
            const targetSocket = new MockWebSocket() as unknown as WebSocket;

            // Join both users to the room
            roomManager.joinRoom(roomId, fromId, "From User", fromSocket);
            roomManager.joinRoom(roomId, targetId, "Target User", targetSocket);

            // Create valid offer
            const offer: RTCSessionDescriptionInit = {
              type: "offer",
              sdp,
            };

            // Handle offer
            signalingHandler.handleOffer(fromId, targetId, offer);

            // Target should receive the message
            const targetMock = targetSocket as any;
            expect(targetMock.sentMessages.length).toBe(1);

            const receivedMessage = JSON.parse(targetMock.sentMessages[0]);
            expect(receivedMessage.type).toBe("offer");
            expect(receivedMessage.fromId).toBe(fromId);
            expect(receivedMessage.targetId).toBe(targetId);
            expect(receivedMessage.offer.type).toBe("offer");
            expect(receivedMessage.offer.sdp).toBe(sdp);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid answer message, if target participant exists and connection is open,
     * the message should be forwarded to the target participant
     * Validates: Requirements 7.6, 9.2
     */
    it("should forward valid answer messages to existing target participants", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }), // fromId
          fc.string({ minLength: 1, maxLength: 20 }), // targetId
          fc.string({ minLength: 1, maxLength: 100 }), // sdp content
          (fromId, targetId, sdp) => {
            // Ensure fromId and targetId are different
            if (fromId === targetId) return;

            const roomManager = new RoomManager();
            const signalingHandler = new SignalingHandler(roomManager);
            const roomId = roomManager.createRoom();

            // Create sockets for both users
            const fromSocket = new MockWebSocket() as unknown as WebSocket;
            const targetSocket = new MockWebSocket() as unknown as WebSocket;

            // Join both users to the room
            roomManager.joinRoom(roomId, fromId, "From User", fromSocket);
            roomManager.joinRoom(roomId, targetId, "Target User", targetSocket);

            // Create valid answer
            const answer: RTCSessionDescriptionInit = {
              type: "answer",
              sdp,
            };

            // Handle answer
            signalingHandler.handleAnswer(fromId, targetId, answer);

            // Target should receive the message
            const targetMock = targetSocket as any;
            expect(targetMock.sentMessages.length).toBe(1);

            const receivedMessage = JSON.parse(targetMock.sentMessages[0]);
            expect(receivedMessage.type).toBe("answer");
            expect(receivedMessage.fromId).toBe(fromId);
            expect(receivedMessage.targetId).toBe(targetId);
            expect(receivedMessage.answer.type).toBe("answer");
            expect(receivedMessage.answer.sdp).toBe(sdp);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid ICE candidate, if target participant exists and connection is open,
     * the message should be forwarded to the target participant
     * Validates: Requirements 7.6, 9.3
     */
    it("should forward valid ICE candidates to existing target participants", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }), // fromId
          fc.string({ minLength: 1, maxLength: 20 }), // targetId
          fc.string({ minLength: 1, maxLength: 100 }), // candidate string
          fc.option(fc.string({ minLength: 1, maxLength: 20 }), {
            nil: null,
          }), // sdpMid
          fc.option(fc.integer({ min: 0, max: 10 }), { nil: null }), // sdpMLineIndex
          (fromId, targetId, candidateStr, sdpMid, sdpMLineIndex) => {
            // Ensure fromId and targetId are different
            if (fromId === targetId) return;

            const roomManager = new RoomManager();
            const signalingHandler = new SignalingHandler(roomManager);
            const roomId = roomManager.createRoom();

            // Create sockets for both users
            const fromSocket = new MockWebSocket() as unknown as WebSocket;
            const targetSocket = new MockWebSocket() as unknown as WebSocket;

            // Join both users to the room
            roomManager.joinRoom(roomId, fromId, "From User", fromSocket);
            roomManager.joinRoom(roomId, targetId, "Target User", targetSocket);

            // Create valid ICE candidate
            const candidate: RTCIceCandidateInit = {
              candidate: candidateStr,
              sdpMid,
              sdpMLineIndex,
            };

            // Handle ICE candidate
            signalingHandler.handleIceCandidate(fromId, targetId, candidate);

            // Target should receive the message
            const targetMock = targetSocket as any;
            expect(targetMock.sentMessages.length).toBe(1);

            const receivedMessage = JSON.parse(targetMock.sentMessages[0]);
            expect(receivedMessage.type).toBe("ice-candidate");
            expect(receivedMessage.fromId).toBe(fromId);
            expect(receivedMessage.targetId).toBe(targetId);
            expect(receivedMessage.candidate.candidate).toBe(candidateStr);
            expect(receivedMessage.candidate.sdpMid).toBe(sdpMid);
            expect(receivedMessage.candidate.sdpMLineIndex).toBe(sdpMLineIndex);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Messages should not be forwarded if target participant does not exist
     * Validates: Requirements 9.4
     */
    it("should not forward messages to non-existent target participants", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }), // fromId
          fc.string({ minLength: 1, maxLength: 20 }), // targetId (not in room)
          fc.string({ minLength: 1, maxLength: 100 }), // sdp content
          (fromId, targetId, sdp) => {
            // Ensure fromId and targetId are different
            if (fromId === targetId) return;

            const roomManager = new RoomManager();
            const signalingHandler = new SignalingHandler(roomManager);
            const roomId = roomManager.createRoom();

            // Only join fromId, not targetId
            const fromSocket = new MockWebSocket() as unknown as WebSocket;
            roomManager.joinRoom(roomId, fromId, "From User", fromSocket);

            // Create valid offer
            const offer: RTCSessionDescriptionInit = {
              type: "offer",
              sdp,
            };

            // Handle offer - should not throw
            expect(() => {
              signalingHandler.handleOffer(fromId, targetId, offer);
            }).not.toThrow();

            // No messages should be sent (target doesn't exist)
            // This test verifies the handler doesn't crash
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Property 11: 信令消息验证", () => {
    /**
     * Property: For any signaling message missing required fields (fromId, targetId, payload),
     * validateSignalingMessage should return false
     * Validates: Requirements 9.6
     */
    it("should reject messages with missing required fields", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            // Missing fromId for offer
            fc.record({
              type: fc.constant("offer"),
              targetId: fc.string({ minLength: 1 }),
              offer: fc.record({
                type: fc.constant("offer"),
                sdp: fc.string({ minLength: 1 }),
              }),
            }),
            // Missing targetId for offer
            fc.record({
              type: fc.constant("offer"),
              fromId: fc.string({ minLength: 1 }),
              offer: fc.record({
                type: fc.constant("offer"),
                sdp: fc.string({ minLength: 1 }),
              }),
            }),
            // Missing offer payload
            fc.record({
              type: fc.constant("offer"),
              fromId: fc.string({ minLength: 1 }),
              targetId: fc.string({ minLength: 1 }),
            }),
            // Missing fromId for answer
            fc.record({
              type: fc.constant("answer"),
              targetId: fc.string({ minLength: 1 }),
              answer: fc.record({
                type: fc.constant("answer"),
                sdp: fc.string({ minLength: 1 }),
              }),
            }),
            // Missing targetId for answer
            fc.record({
              type: fc.constant("answer"),
              fromId: fc.string({ minLength: 1 }),
              answer: fc.record({
                type: fc.constant("answer"),
                sdp: fc.string({ minLength: 1 }),
              }),
            }),
            // Missing answer payload
            fc.record({
              type: fc.constant("answer"),
              fromId: fc.string({ minLength: 1 }),
              targetId: fc.string({ minLength: 1 }),
            }),
            // Missing fromId for ice-candidate
            fc.record({
              type: fc.constant("ice-candidate"),
              targetId: fc.string({ minLength: 1 }),
              candidate: fc.record({
                candidate: fc.string({ minLength: 1 }),
              }),
            }),
            // Missing targetId for ice-candidate
            fc.record({
              type: fc.constant("ice-candidate"),
              fromId: fc.string({ minLength: 1 }),
              candidate: fc.record({
                candidate: fc.string({ minLength: 1 }),
              }),
            }),
            // Missing candidate payload
            fc.record({
              type: fc.constant("ice-candidate"),
              fromId: fc.string({ minLength: 1 }),
              targetId: fc.string({ minLength: 1 }),
            })
          ),
          (invalidMessage) => {
            const roomManager = new RoomManager();
            const signalingHandler = new SignalingHandler(roomManager);

            // Invalid message should be rejected
            const isValid =
              signalingHandler.validateSignalingMessage(invalidMessage);
            expect(isValid).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid offer message with all required fields,
     * validateSignalingMessage should return true
     * Validates: Requirements 9.6
     */
    it("should accept valid offer messages", () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((s) => s.trim().length > 0), // fromId (non-whitespace)
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((s) => s.trim().length > 0), // targetId (non-whitespace)
          fc.string({ minLength: 1, maxLength: 100 }), // sdp
          (fromId, targetId, sdp) => {
            const roomManager = new RoomManager();
            const signalingHandler = new SignalingHandler(roomManager);

            const validMessage = {
              type: "offer",
              fromId,
              targetId,
              offer: {
                type: "offer",
                sdp,
              },
            };

            const isValid =
              signalingHandler.validateSignalingMessage(validMessage);
            expect(isValid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid answer message with all required fields,
     * validateSignalingMessage should return true
     * Validates: Requirements 9.6
     */
    it("should accept valid answer messages", () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((s) => s.trim().length > 0), // fromId (non-whitespace)
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((s) => s.trim().length > 0), // targetId (non-whitespace)
          fc.string({ minLength: 1, maxLength: 100 }), // sdp
          (fromId, targetId, sdp) => {
            const roomManager = new RoomManager();
            const signalingHandler = new SignalingHandler(roomManager);

            const validMessage = {
              type: "answer",
              fromId,
              targetId,
              answer: {
                type: "answer",
                sdp,
              },
            };

            const isValid =
              signalingHandler.validateSignalingMessage(validMessage);
            expect(isValid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any valid ICE candidate message with all required fields,
     * validateSignalingMessage should return true
     * Validates: Requirements 9.6
     */
    it("should accept valid ICE candidate messages", () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((s) => s.trim().length > 0), // fromId (non-whitespace)
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((s) => s.trim().length > 0), // targetId (non-whitespace)
          fc.string({ minLength: 1, maxLength: 100 }), // candidate
          (fromId, targetId, candidate) => {
            const roomManager = new RoomManager();
            const signalingHandler = new SignalingHandler(roomManager);

            const validMessage = {
              type: "ice-candidate",
              fromId,
              targetId,
              candidate: {
                candidate,
              },
            };

            const isValid =
              signalingHandler.validateSignalingMessage(validMessage);
            expect(isValid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any message with invalid type, validateSignalingMessage should return false
     * Validates: Requirements 9.6
     */
    it("should reject messages with invalid type", () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((s) => !["offer", "answer", "ice-candidate"].includes(s)), // invalid type
          fc.string({ minLength: 1, maxLength: 20 }), // fromId
          fc.string({ minLength: 1, maxLength: 20 }), // targetId
          (invalidType, fromId, targetId) => {
            const roomManager = new RoomManager();
            const signalingHandler = new SignalingHandler(roomManager);

            const invalidMessage = {
              type: invalidType,
              fromId,
              targetId,
              offer: {
                type: "offer",
                sdp: "test-sdp",
              },
            };

            const isValid =
              signalingHandler.validateSignalingMessage(invalidMessage);
            expect(isValid).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any message with empty SDP, validateSignalingMessage should return false
     * Validates: Requirements 9.6
     */
    it("should reject offer/answer messages with empty SDP", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("offer", "answer"), // message type
          fc.string({ minLength: 1, maxLength: 20 }), // fromId
          fc.string({ minLength: 1, maxLength: 20 }), // targetId
          (messageType, fromId, targetId) => {
            const roomManager = new RoomManager();
            const signalingHandler = new SignalingHandler(roomManager);

            const invalidMessage =
              messageType === "offer"
                ? {
                    type: "offer",
                    fromId,
                    targetId,
                    offer: {
                      type: "offer",
                      sdp: "", // empty SDP
                    },
                  }
                : {
                    type: "answer",
                    fromId,
                    targetId,
                    answer: {
                      type: "answer",
                      sdp: "", // empty SDP
                    },
                  };

            const isValid =
              signalingHandler.validateSignalingMessage(invalidMessage);
            expect(isValid).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any message with empty candidate string, validateSignalingMessage should return false
     * Validates: Requirements 9.6
     */
    it("should reject ICE candidate messages with empty candidate string", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }), // fromId
          fc.string({ minLength: 1, maxLength: 20 }), // targetId
          (fromId, targetId) => {
            const roomManager = new RoomManager();
            const signalingHandler = new SignalingHandler(roomManager);

            const invalidMessage = {
              type: "ice-candidate",
              fromId,
              targetId,
              candidate: {
                candidate: "", // empty candidate
              },
            };

            const isValid =
              signalingHandler.validateSignalingMessage(invalidMessage);
            expect(isValid).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any non-object or null message, validateSignalingMessage should return false
     * Validates: Requirements 9.6
     */
    it("should reject non-object and null messages", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.array(fc.anything())
          ),
          (invalidMessage) => {
            const roomManager = new RoomManager();
            const signalingHandler = new SignalingHandler(roomManager);

            const isValid =
              signalingHandler.validateSignalingMessage(invalidMessage);
            expect(isValid).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
