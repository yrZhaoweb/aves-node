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

describe("RoomManager", () => {
  let roomManager: RoomManager;

  beforeEach(() => {
    roomManager = new RoomManager();
  });

  describe("Room Creation", () => {
    it("should create a room and return a unique ID", () => {
      const roomId = roomManager.createRoom();
      expect(roomId).toBeDefined();
      expect(typeof roomId).toBe("string");
      expect(roomManager.roomExists(roomId)).toBe(true);
    });

    it("should create unique room IDs for multiple rooms", () => {
      const roomId1 = roomManager.createRoom();
      const roomId2 = roomManager.createRoom();
      expect(roomId1).not.toBe(roomId2);
    });
  });

  describe("User Join and Leave", () => {
    it("should allow a user to join an existing room", () => {
      const roomId = roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;
      const result = roomManager.joinRoom(roomId, "user1", "Alice", socket);

      expect(result).toBe(true);
      const participants = roomManager.getRoomParticipants(roomId);
      expect(participants).toHaveLength(1);
      expect(participants[0]).toEqual({ id: "user1", name: "Alice" });
    });

    it("should return false when joining a non-existent room", () => {
      const socket = new MockWebSocket() as unknown as WebSocket;
      const result = roomManager.joinRoom(
        "non-existent",
        "user1",
        "Alice",
        socket
      );
      expect(result).toBe(false);
    });

    it("should allow multiple users to join the same room", () => {
      const roomId = roomManager.createRoom();
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      roomManager.joinRoom(roomId, "user2", "Bob", socket2);

      const participants = roomManager.getRoomParticipants(roomId);
      expect(participants).toHaveLength(2);
    });

    it("should remove a user from a room when they leave", () => {
      const roomId = roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;

      roomManager.joinRoom(roomId, "user1", "Alice", socket);
      roomManager.leaveRoom(roomId, "user1");

      const participants = roomManager.getRoomParticipants(roomId);
      expect(participants).toHaveLength(0);
    });

    it("should automatically delete empty rooms", () => {
      const roomId = roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;

      roomManager.joinRoom(roomId, "user1", "Alice", socket);
      roomManager.leaveRoom(roomId, "user1");

      expect(roomManager.roomExists(roomId)).toBe(false);
    });

    it("should not delete a room if other participants remain", () => {
      const roomId = roomManager.createRoom();
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      roomManager.joinRoom(roomId, "user2", "Bob", socket2);
      roomManager.leaveRoom(roomId, "user1");

      expect(roomManager.roomExists(roomId)).toBe(true);
      const participants = roomManager.getRoomParticipants(roomId);
      expect(participants).toHaveLength(1);
      expect(participants[0].id).toBe("user2");
    });
  });

  describe("Message Broadcasting", () => {
    it("should broadcast a message to all participants in a room", () => {
      const roomId = roomManager.createRoom();
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      roomManager.joinRoom(roomId, "user2", "Bob", socket2);

      const message = {
        type: "user-joined" as const,
        user: { id: "user3", name: "Charlie" },
      };
      roomManager.broadcastToRoom(roomId, message);

      expect((socket1 as any).sentMessages).toHaveLength(1);
      expect((socket2 as any).sentMessages).toHaveLength(1);
      expect(JSON.parse((socket1 as any).sentMessages[0])).toEqual(message);
    });

    it("should exclude a specific user from broadcast", () => {
      const roomId = roomManager.createRoom();
      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      roomManager.joinRoom(roomId, "user1", "Alice", socket1);
      roomManager.joinRoom(roomId, "user2", "Bob", socket2);

      const message = {
        type: "user-joined" as const,
        user: { id: "user3", name: "Charlie" },
      };
      roomManager.broadcastToRoom(roomId, message, "user1");

      expect((socket1 as any).sentMessages).toHaveLength(0);
      expect((socket2 as any).sentMessages).toHaveLength(1);
    });

    it("should send a message to a specific user", () => {
      const roomId = roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;

      roomManager.joinRoom(roomId, "user1", "Alice", socket);

      const message = { type: "room-joined" as const, participants: [] };
      roomManager.sendToUser("user1", message);

      expect((socket as any).sentMessages).toHaveLength(1);
      expect(JSON.parse((socket as any).sentMessages[0])).toEqual(message);
    });
  });

  describe("Query Methods", () => {
    it("should return room info for an existing room", () => {
      const roomId = roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;
      roomManager.joinRoom(roomId, "user1", "Alice", socket);

      const roomInfo = roomManager.getRoomInfo(roomId);
      expect(roomInfo).not.toBeNull();
      expect(roomInfo?.id).toBe(roomId);
      expect(roomInfo?.participantCount).toBe(1);
      expect(roomInfo?.createdAt).toBeDefined();
    });

    it("should return null for a non-existent room", () => {
      const roomInfo = roomManager.getRoomInfo("non-existent");
      expect(roomInfo).toBeNull();
    });

    it("should return all rooms", () => {
      const roomId1 = roomManager.createRoom();
      const roomId2 = roomManager.createRoom();

      const allRooms = roomManager.getAllRooms();
      expect(allRooms).toHaveLength(2);
      expect(allRooms.map((r) => r.id)).toContain(roomId1);
      expect(allRooms.map((r) => r.id)).toContain(roomId2);
    });

    it("should return the room ID for a given user", () => {
      const roomId = roomManager.createRoom();
      const socket = new MockWebSocket() as unknown as WebSocket;
      roomManager.joinRoom(roomId, "user1", "Alice", socket);

      const foundRoomId = roomManager.getRoomIdByUserId("user1");
      expect(foundRoomId).toBe(roomId);
    });

    it("should return undefined for a user not in any room", () => {
      const foundRoomId = roomManager.getRoomIdByUserId("non-existent");
      expect(foundRoomId).toBeUndefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle leaving a non-existent room gracefully", () => {
      expect(() => {
        roomManager.leaveRoom("non-existent", "user1");
      }).not.toThrow();
    });

    it("should handle broadcasting to a non-existent room gracefully", () => {
      expect(() => {
        roomManager.broadcastToRoom("non-existent", {
          type: "user-joined",
          user: { id: "user1", name: "Alice" },
        });
      }).not.toThrow();
    });

    it("should handle sending to a non-existent user gracefully", () => {
      expect(() => {
        roomManager.sendToUser("non-existent", {
          type: "room-joined",
          participants: [],
        });
      }).not.toThrow();
    });
  });
});
