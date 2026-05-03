import { RoomManager } from "../../core/RoomManager";
import { MemoryStorage } from "../../storage/MemoryStorage";
import { WebSocket } from "ws";
import { MockWebSocket, createMockWebSocket } from "../utils/MockWebSocket";

describe("RoomManager", () => {
  let roomManager: RoomManager;

  beforeEach(() => {
    const storage = new MemoryStorage();
    roomManager = new RoomManager(storage);
  });

  describe("Room Creation", () => {
    it("should create a room and return a unique ID", async () => {
      const roomId = await roomManager.createRoom();
      expect(roomId).toBeDefined();
      expect(typeof roomId).toBe("string");
      expect(await roomManager.roomExists(roomId)).toBe(true);
    });

    it("should create unique room IDs for multiple rooms", async () => {
      const roomId1 = await roomManager.createRoom();
      const roomId2 = await roomManager.createRoom();
      expect(roomId1).not.toBe(roomId2);
    });

    it("should create a room with name, max capacity, and password", async () => {
      const roomId = await roomManager.createRoom({
        name: "Test Room",
        maxCapacity: 5,
        password: "secret123",
      });
      const roomInfo = await roomManager.getRoomInfo(roomId);
      expect(roomInfo?.name).toBe("Test Room");
      expect(roomInfo?.maxCapacity).toBe(5);
      expect(roomInfo?.hasPassword).toBe(true);
    });
  });

  describe("User Join and Leave", () => {
    it("should allow a user to join an existing room", async () => {
      const roomId = await roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;
      const result = await roomManager.joinRoom(
        roomId,
        "user1",
        "Alice",
        socket,
      );

      expect(result).toBe(true);
      const participants = await roomManager.getRoomParticipants(roomId);
      expect(participants).toHaveLength(1);
      expect(participants[0]).toEqual({ id: "user1", name: "Alice" });
    });

    it("should return false when joining a non-existent room", async () => {
      const socket = new MockWebSocket() as unknown as WebSocket;
      const result = await roomManager.joinRoom(
        "non-existent",
        "user1",
        "Alice",
        socket,
      );
      expect(result).toBe(false);
    });

    it("should allow multiple users to join the same room", async () => {
      const roomId = await roomManager.createRoom();
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      await roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      await roomManager.joinRoom(roomId, "user2", "Bob", socket2);

      const participants = await roomManager.getRoomParticipants(roomId);
      expect(participants).toHaveLength(2);
    });

    it("should remove a user from a room when they leave", async () => {
      const roomId = await roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;

      await roomManager.joinRoom(roomId, "user1", "Alice", socket);
      await roomManager.leaveRoom(roomId, "user1");

      const participants = await roomManager.getRoomParticipants(roomId);
      expect(participants).toHaveLength(0);
    });

    it("should automatically delete empty rooms", async () => {
      const roomId = await roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;

      await roomManager.joinRoom(roomId, "user1", "Alice", socket);
      await roomManager.leaveRoom(roomId, "user1");

      expect(await roomManager.roomExists(roomId)).toBe(false);
    });

    it("should not delete a room if other participants remain", async () => {
      const roomId = await roomManager.createRoom();
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      await roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      await roomManager.joinRoom(roomId, "user2", "Bob", socket2);
      await roomManager.leaveRoom(roomId, "user1");

      expect(await roomManager.roomExists(roomId)).toBe(true);
      const participants = await roomManager.getRoomParticipants(roomId);
      expect(participants).toHaveLength(1);
      expect(participants[0].id).toBe("user2");
    });

    it("should reject join with wrong password", async () => {
      const roomId = await roomManager.createRoom({ password: "correct" });
      const socket = new MockWebSocket() as unknown as WebSocket;
      const result = await roomManager.joinRoom(
        roomId,
        "user1",
        "Alice",
        socket,
        "wrong",
      );
      expect(result).toBe(false);
    });

    it("should allow join with correct password", async () => {
      const roomId = await roomManager.createRoom({ password: "correct" });
      const socket = new MockWebSocket() as unknown as WebSocket;
      const result = await roomManager.joinRoom(
        roomId,
        "user1",
        "Alice",
        socket,
        "correct",
      );
      expect(result).toBe(true);
    });

    it("should reject join when room is at max capacity", async () => {
      const roomId = await roomManager.createRoom({ maxCapacity: 2 });
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;
      const socket3 = new MockWebSocket() as unknown as WebSocket;

      await roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      await roomManager.joinRoom(roomId, "user2", "Bob", socket2);
      const result = await roomManager.joinRoom(
        roomId,
        "user3",
        "Charlie",
        socket3,
      );

      expect(result).toBe(false);
    });

    it("should roll back user-room binding when participant storage is cancelled", async () => {
      const storage = new MemoryStorage();
      storage.addListener({
        onBeforeChange: (event) => event.type !== "participant:join",
      });
      const managerWithCancellableStorage = new RoomManager(storage);
      const roomId = await managerWithCancellableStorage.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;

      const result = await managerWithCancellableStorage.joinRoom(
        roomId,
        "user1",
        "Alice",
        socket,
      );

      expect(result).toBe(false);
      expect(await storage.getUserRoom("user1")).toBeNull();
      expect(
        await managerWithCancellableStorage.getRoomParticipants(roomId),
      ).toHaveLength(0);
    });
  });

  describe("Message Broadcasting", () => {
    it("should broadcast a message to all participants in a room", async () => {
      const roomId = await roomManager.createRoom();
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      await roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      await roomManager.joinRoom(roomId, "user2", "Bob", socket2);

      const message = {
        type: "user-joined" as const,
        user: { id: "user3", name: "Charlie" },
      };
      await roomManager.broadcastToRoom(roomId, message);

      expect((socket1 as any).sentMessages).toHaveLength(1);
      expect((socket2 as any).sentMessages).toHaveLength(1);
      expect(JSON.parse((socket1 as any).sentMessages[0])).toEqual(message);
    });

    it("should exclude a specific user from broadcast", async () => {
      const roomId = await roomManager.createRoom();
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      await roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      await roomManager.joinRoom(roomId, "user2", "Bob", socket2);

      const message = {
        type: "user-joined" as const,
        user: { id: "user3", name: "Charlie" },
      };
      await roomManager.broadcastToRoom(roomId, message, "user1");

      expect((socket1 as any).sentMessages).toHaveLength(0);
      expect((socket2 as any).sentMessages).toHaveLength(1);
    });

    it("should send a message to a specific user", async () => {
      const roomId = await roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;

      await roomManager.joinRoom(roomId, "user1", "Alice", socket);

      const message = {
        type: "room-joined" as const,
        participants: [],
        userId: "user1",
      };
      await roomManager.sendToUser("user1", message);

      expect((socket as any).sentMessages).toHaveLength(1);
      expect(JSON.parse((socket as any).sentMessages[0])).toEqual(message);
    });
  });

  describe("Query Methods", () => {
    it("should return room info for an existing room", async () => {
      const roomId = await roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;
      await roomManager.joinRoom(roomId, "user1", "Alice", socket);

      const roomInfo = await roomManager.getRoomInfo(roomId);
      expect(roomInfo).not.toBeNull();
      expect(roomInfo?.id).toBe(roomId);
      expect(roomInfo?.participantCount).toBe(1);
      expect(roomInfo?.createdAt).toBeDefined();
    });

    it("should return null for a non-existent room", async () => {
      const roomInfo = await roomManager.getRoomInfo("non-existent");
      expect(roomInfo).toBeNull();
    });

    it("should return all rooms", async () => {
      const roomId1 = await roomManager.createRoom();
      const roomId2 = await roomManager.createRoom();

      const allRooms = await roomManager.getAllRooms();
      expect(allRooms).toHaveLength(2);
      expect(allRooms.map((r) => r.id)).toContain(roomId1);
      expect(allRooms.map((r) => r.id)).toContain(roomId2);
    });

    it("should return the room ID for a given user", async () => {
      const roomId = await roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;
      await roomManager.joinRoom(roomId, "user1", "Alice", socket);

      const foundRoomId = await roomManager.getRoomIdByUserId("user1");
      expect(foundRoomId).toBe(roomId);
    });

    it("should return null for a user not in any room", async () => {
      const foundRoomId = await roomManager.getRoomIdByUserId("non-existent");
      expect(foundRoomId).toBeNull();
    });
  });

  describe("Error Handling", () => {
    it("should handle leaving a non-existent room gracefully", async () => {
      await expect(async () => {
        await roomManager.leaveRoom("non-existent", "user1");
      }).not.toThrow();
    });

    it("should handle broadcasting to a non-existent room gracefully", async () => {
      await expect(async () => {
        await roomManager.broadcastToRoom("non-existent", {
          type: "user-joined",
          user: { id: "user1", name: "Alice" },
        });
      }).not.toThrow();
    });

    it("should handle sending to a non-existent user gracefully", async () => {
      await expect(async () => {
        await roomManager.sendToUser("non-existent", {
          type: "room-joined",
          participants: [],
          userId: "non-existent",
        });
      }).not.toThrow();
    });
  });
});
