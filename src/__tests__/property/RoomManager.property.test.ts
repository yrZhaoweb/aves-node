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
    it("should generate unique room IDs for all createRoom calls", async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 2, max: 100 }), async (roomCount) => {
          const roomManager = createRoomManager();
          const roomIds = new Set<string>();

          for (let i = 0; i < roomCount; i++) {
            roomIds.add(await roomManager.createRoom());
          }

          expect(roomIds.size).toBe(roomCount);
        }),
        { numRuns: 100 },
      );
    });

    it("should generate unique room IDs across sequential operations", async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 5, max: 50 }), async (roomCount) => {
          const roomManager = createRoomManager();
          const roomIds: string[] = [];

          for (let i = 0; i < roomCount; i++) {
            roomIds.push(await roomManager.createRoom());
          }

          expect(new Set(roomIds).size).toBe(roomIds.length);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 9: 用户加入广播", () => {
    it("should broadcast to all other participants when a user joins", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          async (initialCount, newUserId, newUserName) => {
            const roomManager = createRoomManager();
            const roomId = await roomManager.createRoom();
            const sockets: MockWebSocket[] = [];

            for (let i = 0; i < initialCount; i++) {
              const socket = new MockWebSocket();
              sockets.push(socket);
              await roomManager.joinRoom(
                roomId,
                `user${i}`,
                `User${i}`,
                socket as unknown as WebSocket,
              );
            }

            sockets.forEach((s) => (s.sentMessages = []));

            const message = {
              type: "user-joined" as const,
              user: { id: newUserId, name: newUserName },
            };

            await roomManager.broadcastToRoom(roomId, message);

            for (const socket of sockets) {
              expect(socket.sentMessages).toHaveLength(1);
              expect(JSON.parse(socket.sentMessages[0])).toEqual(message);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it("should exclude specified user from broadcast", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 10 }),
          fc.integer({ min: 0, max: 9 }),
          async (participantCount, excludeIndex) => {
            const validExcludeIndex = excludeIndex % participantCount;
            const roomManager = createRoomManager();
            const roomId = await roomManager.createRoom();
            const sockets: MockWebSocket[] = [];
            const userIds: string[] = [];

            for (let i = 0; i < participantCount; i++) {
              const socket = new MockWebSocket();
              const userId = `user${i}`;
              sockets.push(socket);
              userIds.push(userId);
              await roomManager.joinRoom(
                roomId,
                userId,
                `User${i}`,
                socket as unknown as WebSocket,
              );
            }

            sockets.forEach((s) => (s.sentMessages = []));

            const message = {
              type: "user-joined" as const,
              user: { id: "newUser", name: "New User" },
            };

            await roomManager.broadcastToRoom(
              roomId,
              message,
              userIds[validExcludeIndex],
            );

            expect(sockets[validExcludeIndex].sentMessages).toHaveLength(0);
            for (let i = 0; i < participantCount; i++) {
              if (i !== validExcludeIndex) {
                expect(sockets[i].sentMessages).toHaveLength(1);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 10: 空房间自动清理", () => {
    it("should automatically delete room when last participant leaves", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 20 }),
          async (participantCount) => {
            const roomManager = createRoomManager();
            const roomId = await roomManager.createRoom();
            const userIds: string[] = [];

            for (let i = 0; i < participantCount; i++) {
              const socket = new MockWebSocket();
              const userId = `user${i}`;
              userIds.push(userId);
              await roomManager.joinRoom(
                roomId,
                userId,
                `User${i}`,
                socket as unknown as WebSocket,
              );
            }

            expect(await roomManager.roomExists(roomId)).toBe(true);

            for (let i = 0; i < participantCount; i++) {
              await roomManager.leaveRoom(roomId, userIds[i]);
            }

            expect(await roomManager.roomExists(roomId)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("should not include empty rooms in getAllRooms", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 1, max: 5 }),
          async (roomCount, participantsPerRoom) => {
            const roomManager = createRoomManager();
            const roomIds: string[] = [];

            for (let i = 0; i < roomCount; i++) {
              const roomId = await roomManager.createRoom();
              roomIds.push(roomId);

              for (let j = 0; j < participantsPerRoom; j++) {
                const socket = new MockWebSocket();
                await roomManager.joinRoom(
                  roomId,
                  `user${i}-${j}`,
                  `User${i}-${j}`,
                  socket as unknown as WebSocket,
                );
              }
            }

            expect((await roomManager.getAllRooms()).length).toBe(roomCount);

            for (const roomId of roomIds) {
              const participants = await roomManager.getRoomParticipants(roomId);
              for (const participant of participants) {
                await roomManager.leaveRoom(roomId, participant.id);
              }
            }

            expect((await roomManager.getAllRooms()).length).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 12: 房间信息查询准确性", () => {
    it("should return correct room info for existing rooms and null for non-existent rooms", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          async (roomCount, nonExistentRoomId) => {
            const roomManager = createRoomManager();
            const roomIds: string[] = [];

            for (let i = 0; i < roomCount; i++) {
              roomIds.push(await roomManager.createRoom());
            }

            for (const roomId of roomIds) {
              const roomInfo = await roomManager.getRoomInfo(roomId);
              expect(roomInfo).not.toBeNull();
              expect(roomInfo?.id).toBe(roomId);
              expect(roomInfo?.participantCount).toBe(0);
              expect(typeof roomInfo?.createdAt).toBe("number");
            }

            if (!roomIds.includes(nonExistentRoomId)) {
              const roomInfo = await roomManager.getRoomInfo(nonExistentRoomId);
              expect(roomInfo).toBeNull();
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it("should return room info with accurate participant count", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 20 }),
          async (participantCount) => {
            const roomManager = createRoomManager();
            const roomId = await roomManager.createRoom();

            for (let i = 0; i < participantCount; i++) {
              const socket = new MockWebSocket();
              await roomManager.joinRoom(
                roomId,
                `user${i}`,
                `User${i}`,
                socket as unknown as WebSocket,
              );
            }

            const roomInfo = await roomManager.getRoomInfo(roomId);
            expect(roomInfo).not.toBeNull();
            expect(roomInfo?.participantCount).toBe(participantCount);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("Property 13: 参与者计数准确性", () => {
    it("should return accurate participant count matching actual participants", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 20 }),
          async (participantCount) => {
            const roomManager = createRoomManager();
            const roomId = await roomManager.createRoom();

            for (let i = 0; i < participantCount; i++) {
              const socket = new MockWebSocket();
              await roomManager.joinRoom(
                roomId,
                `user${i}`,
                `User${i}`,
                socket as unknown as WebSocket,
              );
            }

            const roomInfo = await roomManager.getRoomInfo(roomId);
            const participantList = await roomManager.getRoomParticipants(roomId);

            expect(roomInfo?.participantCount).toBe(participantCount);
            expect(participantList.length).toBe(participantCount);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("should maintain accurate participant count through joins and leaves (until room deletion)", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              action: fc.constantFrom("join" as const, "leave" as const),
              userId: fc.string({ minLength: 1, maxLength: 10 }),
              userName: fc.string({ minLength: 1, maxLength: 10 }),
            }),
            { minLength: 1, maxLength: 20 },
          ),
          async (actions) => {
            const roomManager = createRoomManager();
            const roomId = await roomManager.createRoom();
            const currentParticipants = new Set<string>();
            const sockets = new Map<string, MockWebSocket>();
            let hadParticipants = false;

            for (const action of actions) {
              const exists = await roomManager.roomExists(roomId);
              if (!exists) break;

              if (action.action === "join") {
                if (!currentParticipants.has(action.userId)) {
                  const socket = new MockWebSocket();
                  sockets.set(action.userId, socket);
                  const joined = await roomManager.joinRoom(
                    roomId,
                    action.userId,
                    action.userName,
                    socket as unknown as WebSocket,
                  );
                  if (joined) {
                    currentParticipants.add(action.userId);
                    hadParticipants = true;
                  }
                }
              } else if (action.action === "leave") {
                if (currentParticipants.has(action.userId)) {
                  await roomManager.leaveRoom(roomId, action.userId);
                  currentParticipants.delete(action.userId);
                }
              }

              const stillExists = await roomManager.roomExists(roomId);
              if (currentParticipants.size > 0) {
                expect(stillExists).toBe(true);
                const roomInfo = await roomManager.getRoomInfo(roomId);
                expect(roomInfo?.participantCount).toBe(currentParticipants.size);
              } else if (hadParticipants) {
                // Room should be deleted when empty after having participants.
                expect(stillExists).toBe(false);
              } else {
                // Room can exist empty if it never had participants.
                expect(stillExists).toBe(true);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it("should return accurate participant counts in getAllRooms", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 1, maxLength: 10 }),
          async (participantCounts) => {
            const roomManager = createRoomManager();
            const roomData: Array<{ roomId: string; expectedCount: number }> = [];

            for (let i = 0; i < participantCounts.length; i++) {
              const roomId = await roomManager.createRoom();
              const count = participantCounts[i];

              for (let j = 0; j < count; j++) {
                const socket = new MockWebSocket();
                await roomManager.joinRoom(
                  roomId,
                  `user${i}-${j}`,
                  `User${i}-${j}`,
                  socket as unknown as WebSocket,
                );
              }

              roomData.push({ roomId, expectedCount: count });
            }

            const allRooms = await roomManager.getAllRooms();
            expect(allRooms.length).toBe(roomData.length);

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

