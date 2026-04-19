/**
 * Property-based tests for AvesServer
 * Feature: webrtc-library-extraction
 *
 * **Property 14: 无效消息处理健壮性**
 *
 * **Validates: Requirements 10.6**
 */

import * as fc from "fast-check";
import { AvesServer } from "../../core/AvesServer";
import { WebSocket } from "ws";
import { EventEmitter } from "events";

// Mock WebSocket that extends EventEmitter
class MockWebSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  sentMessages: string[] = [];

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }
}

describe("AvesServer Property Tests", () => {
  describe("Property 14: 无效消息处理健壮性", () => {
    /**
     * Property: For any malformed or invalid message, AvesServer should handle it gracefully
     * (not crash, not throw uncaught exceptions)
     * Validates: Requirements 10.6
     */
    it("should handle invalid JSON without crashing", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }).filter((s) => {
            try {
              JSON.parse(s);
              return false; // Valid JSON, skip
            } catch {
              return true; // Invalid JSON, use it
            }
          }),
          (invalidJson) => {
            const server = new AvesServer({ debug: false });
            const ws = new MockWebSocket() as unknown as WebSocket;

            server.handleConnection(ws);

            // Send invalid JSON - should not throw
            expect(() => {
              (ws as any).emit("message", Buffer.from(invalidJson));
            }).not.toThrow();

            // Should send error message
            const mock = ws as any;
            expect(mock.sentMessages.length).toBeGreaterThan(0);
            const response = JSON.parse(mock.sentMessages[0]);
            expect(response.type).toBe("error");

            server.close();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any message missing the type field, server should handle gracefully
     * Validates: Requirements 10.6
     */
    it("should handle messages without type field", () => {
      fc.assert(
        fc.property(
          fc.record({
            data: fc.anything(),
            value: fc.anything(),
            content: fc.anything(),
          }),
          (messageWithoutType) => {
            const server = new AvesServer({ debug: false });
            const ws = new MockWebSocket() as unknown as WebSocket;

            server.handleConnection(ws);

            // Send message without type - should not throw
            expect(() => {
              (ws as any).emit(
                "message",
                Buffer.from(JSON.stringify(messageWithoutType))
              );
            }).not.toThrow();

            // Should send error message
            const mock = ws as any;
            expect(mock.sentMessages.length).toBeGreaterThan(0);
            const response = JSON.parse(mock.sentMessages[0]);
            expect(response.type).toBe("error");

            server.close();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any message with unknown type, server should handle gracefully
     * Validates: Requirements 10.6
     */
    it("should handle messages with unknown type", () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 50 })
            .filter(
              (s) =>
                ![
                  "create-room",
                  "join-room",
                  "leave-room",
                  "offer",
                  "answer",
                  "ice-candidate",
                ].includes(s)
            ),
          (unknownType) => {
            const server = new AvesServer({ debug: false });
            const ws = new MockWebSocket() as unknown as WebSocket;

            server.handleConnection(ws);

            const message = { type: unknownType };

            // Send unknown type - should not throw
            expect(() => {
              (ws as any).emit("message", Buffer.from(JSON.stringify(message)));
            }).not.toThrow();

            // Should send error message
            const mock = ws as any;
            expect(mock.sentMessages.length).toBeGreaterThan(0);
            const response = JSON.parse(mock.sentMessages[0]);
            expect(response.type).toBe("error");

            server.close();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any join-room message with missing required fields, server should handle gracefully
     * Validates: Requirements 10.6
     */
    it("should handle join-room messages with missing fields", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            // Missing roomId
            fc.record({
              type: fc.constant("join-room"),
              userId: fc.string({ minLength: 1 }),
              userName: fc.string({ minLength: 1 }),
            }),
            // Missing userId
            fc.record({
              type: fc.constant("join-room"),
              roomId: fc.string({ minLength: 1 }),
              userName: fc.string({ minLength: 1 }),
            }),
            // Missing userName
            fc.record({
              type: fc.constant("join-room"),
              roomId: fc.string({ minLength: 1 }),
              userId: fc.string({ minLength: 1 }),
            }),
            // Missing all fields
            fc.record({
              type: fc.constant("join-room"),
            })
          ),
          async (invalidJoinMessage) => {
            const server = new AvesServer({ debug: false });
            const ws = new MockWebSocket() as unknown as WebSocket;

            server.handleConnection(ws);

            // Send invalid join-room - should not throw
            expect(() => {
              (ws as any).emit(
                "message",
                Buffer.from(JSON.stringify(invalidJoinMessage))
              );
            }).not.toThrow();

            await new Promise((resolve) => setImmediate(resolve));

            // Should send error message
            const mock = ws as any;
            expect(mock.sentMessages.length).toBeGreaterThan(0);
            const response = JSON.parse(mock.sentMessages[0]);
            expect(response.type).toBe("error");

            server.close();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any signaling message (offer/answer/ice-candidate) with missing fields,
     * server should handle gracefully
     * Validates: Requirements 10.6
     */
    it("should handle signaling messages with missing fields", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            // Offer missing fromId
            fc.record({
              type: fc.constant("offer"),
              targetId: fc.string({ minLength: 1 }),
              offer: fc.record({
                type: fc.constant("offer"),
                sdp: fc.string({ minLength: 1 }),
              }),
            }),
            // Offer missing targetId
            fc.record({
              type: fc.constant("offer"),
              fromId: fc.string({ minLength: 1 }),
              offer: fc.record({
                type: fc.constant("offer"),
                sdp: fc.string({ minLength: 1 }),
              }),
            }),
            // Offer missing offer payload
            fc.record({
              type: fc.constant("offer"),
              fromId: fc.string({ minLength: 1 }),
              targetId: fc.string({ minLength: 1 }),
            }),
            // Answer missing fromId
            fc.record({
              type: fc.constant("answer"),
              targetId: fc.string({ minLength: 1 }),
              answer: fc.record({
                type: fc.constant("answer"),
                sdp: fc.string({ minLength: 1 }),
              }),
            }),
            // Answer missing targetId
            fc.record({
              type: fc.constant("answer"),
              fromId: fc.string({ minLength: 1 }),
              answer: fc.record({
                type: fc.constant("answer"),
                sdp: fc.string({ minLength: 1 }),
              }),
            }),
            // Answer missing answer payload
            fc.record({
              type: fc.constant("answer"),
              fromId: fc.string({ minLength: 1 }),
              targetId: fc.string({ minLength: 1 }),
            }),
            // ICE candidate missing fromId
            fc.record({
              type: fc.constant("ice-candidate"),
              targetId: fc.string({ minLength: 1 }),
              candidate: fc.record({
                candidate: fc.string({ minLength: 1 }),
              }),
            }),
            // ICE candidate missing targetId
            fc.record({
              type: fc.constant("ice-candidate"),
              fromId: fc.string({ minLength: 1 }),
              candidate: fc.record({
                candidate: fc.string({ minLength: 1 }),
              }),
            }),
            // ICE candidate missing candidate payload
            fc.record({
              type: fc.constant("ice-candidate"),
              fromId: fc.string({ minLength: 1 }),
              targetId: fc.string({ minLength: 1 }),
            })
          ),
          (invalidSignalingMessage) => {
            const server = new AvesServer({ debug: false });
            const ws = new MockWebSocket() as unknown as WebSocket;

            server.handleConnection(ws);

            // Send invalid signaling message - should not throw
            expect(() => {
              (ws as any).emit(
                "message",
                Buffer.from(JSON.stringify(invalidSignalingMessage))
              );
            }).not.toThrow();

            // Server should handle gracefully (may log warning but not crash)
            server.close();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any leave-room message with missing userId, server should handle gracefully
     * Validates: Requirements 10.6
     */
    it("should handle leave-room messages with missing userId", () => {
      fc.assert(
        fc.property(
          fc.record({
            type: fc.constant("leave-room"),
            // userId is missing
          }),
          (invalidLeaveMessage) => {
            const server = new AvesServer({ debug: false });
            const ws = new MockWebSocket() as unknown as WebSocket;

            server.handleConnection(ws);

            // Send invalid leave-room - should not throw
            expect(() => {
              (ws as any).emit(
                "message",
                Buffer.from(JSON.stringify(invalidLeaveMessage))
              );
            }).not.toThrow();

            // Server should handle gracefully (logs warning but doesn't crash)
            server.close();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any message with non-string type field, server should handle gracefully
     * Validates: Requirements 10.6
     */
    it("should handle messages with non-string type field", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer(),
            fc.boolean(),
            fc.array(fc.string()),
            fc.record({ nested: fc.string() }),
            fc.constant(null)
          ),
          (nonStringType) => {
            const server = new AvesServer({ debug: false });
            const ws = new MockWebSocket() as unknown as WebSocket;

            server.handleConnection(ws);

            const message = { type: nonStringType };

            // Send message with non-string type - should not throw
            expect(() => {
              (ws as any).emit("message", Buffer.from(JSON.stringify(message)));
            }).not.toThrow();

            // Should send error message
            const mock = ws as any;
            expect(mock.sentMessages.length).toBeGreaterThan(0);
            const response = JSON.parse(mock.sentMessages[0]);
            expect(response.type).toBe("error");

            server.close();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any arbitrary object as message, server should handle gracefully
     * Validates: Requirements 10.6
     */
    it("should handle arbitrary objects as messages", () => {
      fc.assert(
        fc.property(
          fc.object(), // Generate arbitrary objects
          (arbitraryMessage) => {
            const server = new AvesServer({ debug: false });
            const ws = new MockWebSocket() as unknown as WebSocket;

            server.handleConnection(ws);

            // Send arbitrary object - should not throw
            expect(() => {
              (ws as any).emit(
                "message",
                Buffer.from(JSON.stringify(arbitraryMessage))
              );
            }).not.toThrow();

            // Server should handle gracefully
            server.close();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: For any join-room with non-existent room, server should handle gracefully
     * Validates: Requirements 10.6
     */
    it("should handle join-room for non-existent rooms", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }), // roomId
          fc.string({ minLength: 1, maxLength: 20 }), // userId
          fc.string({ minLength: 1, maxLength: 20 }), // userName
          async (roomId, userId, userName) => {
            const server = new AvesServer({ debug: false });
            const ws = new MockWebSocket() as unknown as WebSocket;

            server.handleConnection(ws);

            const joinMessage = {
              type: "join-room",
              roomId, // Non-existent room
              userId,
              userName,
            };

            // Send join-room for non-existent room - should not throw
            expect(() => {
              (ws as any).emit(
                "message",
                Buffer.from(JSON.stringify(joinMessage))
              );
            }).not.toThrow();

            await new Promise((resolve) => setImmediate(resolve));

            // Should send error message
            const mock = ws as any;
            expect(mock.sentMessages.length).toBeGreaterThan(0);
            const response = JSON.parse(mock.sentMessages[0]);
            expect(response.type).toBe("error");

            server.close();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Server should handle WebSocket errors without crashing
     * Validates: Requirements 10.6
     */
    it("should handle WebSocket errors gracefully", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }), // error message
          (errorMessage) => {
            const server = new AvesServer({ debug: false });
            const ws = new MockWebSocket() as unknown as WebSocket;

            server.handleConnection(ws);

            // Emit WebSocket error - should not throw
            expect(() => {
              (ws as any).emit("error", new Error(errorMessage));
            }).not.toThrow();

            server.close();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Server should handle connection close without userId gracefully
     * Validates: Requirements 10.6
     */
    it("should handle connection close without userId", () => {
      fc.assert(
        fc.property(fc.constant(true), () => {
          const server = new AvesServer({ debug: false });
          const ws = new MockWebSocket() as unknown as WebSocket;

          server.handleConnection(ws);

          // Close connection without ever setting userId - should not throw
          expect(() => {
            (ws as any).emit("close");
          }).not.toThrow();

          server.close();
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Server should handle multiple invalid messages in sequence without crashing
     * Validates: Requirements 10.6
     */
    it("should handle multiple invalid messages in sequence", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              fc.string(), // Invalid JSON
              fc.record({ data: fc.anything() }), // Missing type
              fc.record({ type: fc.integer() }), // Non-string type
              fc.record({ type: fc.constant("unknown-type") }) // Unknown type
            ),
            { minLength: 1, maxLength: 10 }
          ),
          (invalidMessages) => {
            const server = new AvesServer({ debug: false });
            const ws = new MockWebSocket() as unknown as WebSocket;

            server.handleConnection(ws);

            // Send multiple invalid messages - should not throw
            expect(() => {
              for (const msg of invalidMessages) {
                const data =
                  typeof msg === "string" ? msg : JSON.stringify(msg);
                (ws as any).emit("message", Buffer.from(data));
              }
            }).not.toThrow();

            // Server should still be functional
            server.close();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Server should handle empty messages gracefully
     * Validates: Requirements 10.6
     */
    it("should handle empty messages", () => {
      fc.assert(
        fc.property(fc.constant(true), () => {
          const server = new AvesServer({ debug: false });
          const ws = new MockWebSocket() as unknown as WebSocket;

          server.handleConnection(ws);

          // Send empty buffer - should not throw
          expect(() => {
            (ws as any).emit("message", Buffer.from(""));
          }).not.toThrow();

          server.close();
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Server should handle null and undefined in message fields gracefully
     * Validates: Requirements 10.6
     */
    it("should handle null and undefined in message fields", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.record({
              type: fc.constant("join-room"),
              roomId: fc.constant(null),
              userId: fc.string({ minLength: 1 }),
              userName: fc.string({ minLength: 1 }),
            }),
            fc.record({
              type: fc.constant("join-room"),
              roomId: fc.string({ minLength: 1 }),
              userId: fc.constant(null),
              userName: fc.string({ minLength: 1 }),
            }),
            fc.record({
              type: fc.constant("join-room"),
              roomId: fc.string({ minLength: 1 }),
              userId: fc.string({ minLength: 1 }),
              userName: fc.constant(null),
            }),
            fc.record({
              type: fc.constant("offer"),
              fromId: fc.constant(null),
              targetId: fc.string({ minLength: 1 }),
              offer: fc.record({
                type: fc.constant("offer"),
                sdp: fc.string({ minLength: 1 }),
              }),
            })
          ),
          (messageWithNull) => {
            const server = new AvesServer({ debug: false });
            const ws = new MockWebSocket() as unknown as WebSocket;

            server.handleConnection(ws);

            // Send message with null fields - should not throw
            expect(() => {
              (ws as any).emit(
                "message",
                Buffer.from(JSON.stringify(messageWithNull))
              );
            }).not.toThrow();

            server.close();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
