/**
 * Property-based tests for RoomManager
 * Feature: webrtc-library-extraction
 *
 * **Property 7: 房间 ID 唯一性**
 * **Property 9: 用户加入广播**
 * **Property 10: 空房间自动清理**
 * **Property 12: 房间信息查询准确性**
 * **Property 13: 参与者计数准确性**
 *
 * **Validates: Requirements 8.1, 8.5, 8.6, 10.3, 10.4**
 */

import * as fc from "fast-check";
import { RoomManager } from "../../core/RoomManager";
import { MemoryStorage } from "../../storage/MemoryStorage";
import { WebSocket } from "ws";

function createRoomManager(): RoomManager {
  return new RoomManager(new MemoryStorage());
}

// Mock WebSocket for testing
class MockWebSocket {
  readyState = WebSocket.OPEN;
  sentMessages: string[] = [];

  send(data: string): void {
    this.sentMessages.push(data);
  }
}

describe("RoomManager Property Tests", () => {
  describe("Property 7: 房间 ID 唯一性", () => {
    /**
     * Property: For any two createRoom calls, the returned room IDs should be different
     * Validates: Requirements 8.1
     */
    it("should generate unique room IDs for all createRoom calls", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 100 }), // number of rooms to create
          async (roomCount) => {
            const roomManager = createRoomManager();
            const roomIds = new Set<string>();

            // Create multiple rooms
            for (let i = 0; i < roomCount; i++) {
              const roomId = await roomManager.createRoom();
              roomIds.add(roomId);
            }

            // All room IDs should be unique
            expect(roomIds.size).toBe(roomCount);
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * Property: Room IDs should remain unique even across multiple RoomManager instances
     * Validates: Requirements 8.1
     */
    it("should generate unique room IDs across sequential operations", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 5, max: 50 }), // number of rooms
          (roomCount) => {
            const roomManager = new RoomManager();
            const roomIds: string[] = [];

            // Create rooms sequentially
            for (let i = 0; i < roomCount; i++) {
              roomIds.push(roomManager.createRoom());
            }

            // Check all IDs are unique
            const uniqueIds = new Set(roomIds);
            expect(uniqueIds.size).toBe(roomIds.length);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 9: 用户加入广播", () => {
    /**
     * Property: For any user joining a room, all other participants should receive a broadcast
     * Validates: Requirements 8.5
     */
    it("should broadcast to all other participants when a user joins", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }), // initial participant count
          fc.string({ minLength: 1, maxLength: 20 }), // new user ID
          fc.string({ minLength: 1, maxLength: 20 }), // new user name
          (initialCount, newUserId, newUserName) => {
            const roomManager = new RoomManager();
            const roomId = roomManager.createRoom();
            const sockets: MockWebSocket[] = [];

            // Add initial participants
            for (let i = 0; i < initialCount; i++) {
              const socket = new MockWebSocket();
              sockets.push(socket);
              roomManager.joinRoom(
                roomId,
                `user${i}`,
                `User${i}`,
                socket as unknown as WebSocket,
              );
            }

            // Clear sent messages
            sockets.forEach((s) => (s.sentMessages = []));

            // Broadcast user-joined message (simulating what AvesServer would do)
            const message = {
              type: "user-joined" as const,
              user: { id: newUserId, name: newUserName },
            };
            roomManager.broadcastToRoom(roomId, message);

            // All initial participants should receive the broadcast
            for (const socket of sockets) {
              expect(socket.sentMessages.length).toBe(1);
              expect(JSON.parse(socket.sentMessages[0])).toEqual(message);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * Property: Broadcast should exclude the specified user
     * Validates: Requirements 8.5
     */
    it("should exclude specified user from broadcast", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 10 }), // participant count
          fc.integer({ min: 0, max: 9 }), // index of user to exclude
          (participantCount, excludeIndex) => {
            const validExcludeIndex = excludeIndex % participantCount;
            const roomManager = new RoomManager();
            const roomId = roomManager.createRoom();
            const sockets: MockWebSocket[] = [];
            const userIds: string[] = [];

            // Add participants
            for (let i = 0; i < participantCount; i++) {
              const socket = new MockWebSocket();
              const userId = `user${i}`;
              sockets.push(socket);
              userIds.push(userId);
              roomManager.joinRoom(
                roomId,
                userId,
                `User${i}`,
                socket as unknown as WebSocket,
              );
            }

            // Clear sent messages
            sockets.forEach((s) => (s.sentMessages = []));

            // Broadcast with exclusion
            const message = {
              type: "user-joined" as const,
              user: { id: "newUser", name: "New User" },
            };
            roomManager.broadcastToRoom(
              roomId,
              message,
              userIds[validExcludeIndex],
            );

            // Excluded user should not receive the message
            expect(sockets[validExcludeIndex].sentMessages.length).toBe(0);

            // All other users should receive the message
            for (let i = 0; i < participantCount; i++) {
              if (i !== validExcludeIndex) {
                expect(sockets[i].sentMessages.length).toBe(1);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 10: 空房间自动清理", () => {
    /**
     * Property: For any room, when the last participant leaves, the room should be deleted
     * Validates: Requirements 8.6
     */
    it("should automatically delete room when last participant leaves", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }), // number of participants
          (participantCount) => {
            const roomManager = new RoomManager();
            const roomId = roomManager.createRoom();
            const userIds: string[] = [];

            // Add participants
            for (let i = 0; i < participantCount; i++) {
              const socket = new MockWebSocket();
              const userId = `user${i}`;
              userIds.push(userId);
              roomManager.joinRoom(
                roomId,
                userId,
                `User${i}`,
                socket as unknown as WebSocket,
              );
            }

            // Room should exist
            expect(roomManager.roomExists(roomId)).toBe(true);

            // Remove all participants except the last one
            for (let i = 0; i < participantCount - 1; i++) {
              roomManager.leaveRoom(roomId, userIds[i]);
              // Room should still exist
              expect(roomManager.roomExists(roomId)).toBe(true);
            }

            // Remove the last participant
            roomManager.leaveRoom(roomId, userIds[participantCount - 1]);

            // Room should be deleted
            expect(roomManager.roomExists(roomId)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * Property: Empty room should not exist in getAllRooms
     * Validates: Requirements 8.6
     */
    it("should not include empty rooms in getAllRooms", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }), // number of rooms
          fc.integer({ min: 1, max: 5 }), // participants per room
          (roomCount, participantsPerRoom) => {
            const roomManager = new RoomManager();
            const roomIds: string[] = [];

            // Create rooms with participants
            for (let i = 0; i < roomCount; i++) {
              const roomId = roomManager.createRoom();
              roomIds.push(roomId);

              for (let j = 0; j < participantsPerRoom; j++) {
                const socket = new MockWebSocket();
                roomManager.joinRoom(
                  roomId,
                  `user${i}-${j}`,
                  `User${i}-${j}`,
                  socket as unknown as WebSocket,
                );
              }
            }

            // All rooms should exist
            expect(roomManager.getAllRooms().length).toBe(roomCount);

            // Empty all rooms
            for (const roomId of roomIds) {
              const participants = roomManager.getRoomParticipants(roomId);
              for (const participant of participants) {
                roomManager.leaveRoom(roomId, participant.id);
              }
            }

            // No rooms should exist
            expect(roomManager.getAllRooms().length).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 12: 房间信息查询准确性", () => {
    /**
     * Property: For any existing room ID, getRoomInfo should return correct information
     * For non-existent room ID, getRoomInfo should return null
     * Validates: Requirements 10.3
     */
    it("should return correct room info for existing rooms and null for non-existent rooms", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }), // number of rooms
          fc.string({ minLength: 1, maxLength: 20 }), // non-existent room ID
          (roomCount, nonExistentRoomId) => {
            const roomManager = new RoomManager();
            const roomIds: string[] = [];

            // Create rooms
            for (let i = 0; i < roomCount; i++) {
              const roomId = roomManager.createRoom();
              roomIds.push(roomId);
            }

            // Check all existing rooms
            for (const roomId of roomIds) {
              const roomInfo = roomManager.getRoomInfo(roomId);
              expect(roomInfo).not.toBeNull();
              expect(roomInfo?.id).toBe(roomId);
              expect(roomInfo?.participantCount).toBe(0);
              expect(roomInfo?.createdAt).toBeDefined();
              expect(typeof roomInfo?.createdAt).toBe("number");
            }

            // Check non-existent room (if it doesn't accidentally match)
            if (!roomIds.includes(nonExistentRoomId)) {
              const roomInfo = roomManager.getRoomInfo(nonExistentRoomId);
              expect(roomInfo).toBeNull();
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * Property: Room info should reflect current participant count
     * Validates: Requirements 10.3, 10.4
     */
    it("should return room info with accurate participant count", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 20 }), // number of participants
          (participantCount) => {
            const roomManager = new RoomManager();
            const roomId = roomManager.createRoom();

            // Add participants
            for (let i = 0; i < participantCount; i++) {
              const socket = new MockWebSocket();
              roomManager.joinRoom(
                roomId,
                `user${i}`,
                `User${i}`,
                socket as unknown as WebSocket,
              );
            }

            // Check room info
            const roomInfo = roomManager.getRoomInfo(roomId);
            expect(roomInfo).not.toBeNull();
            expect(roomInfo?.participantCount).toBe(participantCount);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 13: 参与者计数准确性", () => {
    /**
     * Property: For any room, getParticipantCount should equal the actual number of participants
     * Validates: Requirements 10.4
     */
    it("should return accurate participant count matching actual participants", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 20 }), // number of participants to add
          (participantCount) => {
            const roomManager = new RoomManager();
            const roomId = roomManager.createRoom();

            // Add participants
            for (let i = 0; i < participantCount; i++) {
              const socket = new MockWebSocket();
              roomManager.joinRoom(
                roomId,
                `user${i}`,
                `User${i}`,
                socket as unknown as WebSocket,
              );
            }

            // Get participant count from room info
            const roomInfo = roomManager.getRoomInfo(roomId);
            const participantList = roomManager.getRoomParticipants(roomId);

            // Count should match actual participants
            expect(roomInfo?.participantCount).toBe(participantCount);
            expect(participantList.length).toBe(participantCount);
            expect(roomInfo?.participantCount).toBe(participantList.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * Property: Participant count should update correctly after joins and leaves
     * Validates: Requirements 10.4
     */
    it("should maintain accurate participant count through joins and leaves", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              action: fc.constantFrom("join" as const, "leave" as const),
              userId: fc.string({ minLength: 1, maxLength: 10 }),
              userName: fc.string({ minLength: 1, maxLength: 10 }),
            }),
            { minLength: 1, maxLength: 20 },
          ),
          (actions) => {
            const roomManager = new RoomManager();
            const roomId = roomManager.createRoom();
            const currentParticipants = new Set<string>();
            const sockets = new Map<string, MockWebSocket>();
            let hadParticipants = false; // Track if room ever had participants

            // Execute actions
            for (const action of actions) {
              if (action.action === "join") {
                if (!currentParticipants.has(action.userId)) {
                  const socket = new MockWebSocket();
                  sockets.set(action.userId, socket);
                  roomManager.joinRoom(
                    roomId,
                    action.userId,
                    action.userName,
                    socket as unknown as WebSocket,
                  );
                  currentParticipants.add(action.userId);
                  hadParticipants = true;
                }
              } else if (action.action === "leave") {
                if (currentParticipants.has(action.userId)) {
                  roomManager.leaveRoom(roomId, action.userId);
                  currentParticipants.delete(action.userId);
                }
              }

              // Verify count after each action
              if (currentParticipants.size > 0) {
                const roomInfo = roomManager.getRoomInfo(roomId);
                expect(roomInfo?.participantCount).toBe(
                  currentParticipants.size,
                );
              } else if (hadParticipants) {
                // Room should be deleted when empty (only if it had participants before)
                expect(roomManager.roomExists(roomId)).toBe(false);
              } else {
                // Room never had participants, so it still exists
                expect(roomManager.roomExists(roomId)).toBe(true);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * Property: getAllRooms should return accurate participant counts for all rooms
     * Validates: Requirements 10.4
     */
    it("should return accurate participant counts in getAllRooms", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.integer({ min: 0, max: 10 }), // participants per room
            { minLength: 1, maxLength: 10 },
          ),
          (participantCounts) => {
            const roomManager = new RoomManager();
            const roomData: Array<{ roomId: string; expectedCount: number }> =
              [];

            // Create rooms with different participant counts
            for (let i = 0; i < participantCounts.length; i++) {
              const roomId = roomManager.createRoom();
              const count = participantCounts[i];

              for (let j = 0; j < count; j++) {
                const socket = new MockWebSocket();
                roomManager.joinRoom(
                  roomId,
                  `user${i}-${j}`,
                  `User${i}-${j}`,
                  socket as unknown as WebSocket,
                );
              }

              // Track all rooms (even empty ones, as they still exist until they become empty after having participants)
              roomData.push({ roomId, expectedCount: count });
            }

            // Get all rooms
            const allRooms = roomManager.getAllRooms();

            // Should have all rooms (including empty ones that were never populated)
            expect(allRooms.length).toBe(roomData.length);

            // Each room should have correct participant count
            for (const { roomId, expectedCount } of roomData) {
              const roomInfo = allRooms.find((r) => r.id === roomId);
              expect(roomInfo).toBeDefined();
              expect(roomInfo?.participantCount).toBe(expectedCount);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
