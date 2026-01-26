import { MemoryStorage } from "../../storage/MemoryStorage";
import { Room, ParticipantInfo } from "../../types/types";
import { WebSocket } from "ws";
import { MockWebSocket, createMockWebSocket } from "../utils/MockWebSocket";
import {
  IStorageEventListener,
  StorageEvent,
} from "../../storage/StorageEvents";

describe("MemoryStorage", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe("Room Operations", () => {
    it("should set and get a room", async () => {
      const room: Room = {
        id: "room-1",
        name: "Test Room",
        participants: new Map(),
        createdAt: Date.now(),
      };

      await storage.setRoom("room-1", room);
      const retrieved = await storage.getRoom("room-1");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe("room-1");
      expect(retrieved?.name).toBe("Test Room");
    });

    it("should return null for non-existent room", async () => {
      const room = await storage.getRoom("non-existent");
      expect(room).toBeNull();
    });

    it("should delete a room", async () => {
      const room: Room = {
        id: "room-1",
        participants: new Map(),
        createdAt: Date.now(),
      };

      await storage.setRoom("room-1", room);
      await storage.deleteRoom("room-1");

      const retrieved = await storage.getRoom("room-1");
      expect(retrieved).toBeNull();
    });

    it("should check if room exists", async () => {
      const room: Room = {
        id: "room-1",
        participants: new Map(),
        createdAt: Date.now(),
      };

      expect(await storage.roomExists("room-1")).toBe(false);
      await storage.setRoom("room-1", room);
      expect(await storage.roomExists("room-1")).toBe(true);
    });

    it("should get all rooms", async () => {
      const room1: Room = {
        id: "room-1",
        participants: new Map(),
        createdAt: Date.now(),
      };
      const room2: Room = {
        id: "room-2",
        participants: new Map(),
        createdAt: Date.now(),
      };

      await storage.setRoom("room-1", room1);
      await storage.setRoom("room-2", room2);

      const allRooms = await storage.getAllRooms();
      expect(allRooms).toHaveLength(2);
    });
  });

  describe("User-Room Binding", () => {
    it("should set and get user room binding", async () => {
      await storage.setUserRoom("user-1", "room-1");
      const roomId = await storage.getUserRoom("user-1");
      expect(roomId).toBe("room-1");
    });

    it("should return null for unbound user", async () => {
      const roomId = await storage.getUserRoom("non-existent");
      expect(roomId).toBeNull();
    });

    it("should delete user room binding", async () => {
      await storage.setUserRoom("user-1", "room-1");
      await storage.deleteUserRoom("user-1");
      const roomId = await storage.getUserRoom("user-1");
      expect(roomId).toBeNull();
    });
  });

  describe("Participant Operations", () => {
    it("should set and get participant", async () => {
      const room: Room = {
        id: "room-1",
        participants: new Map(),
        createdAt: Date.now(),
      };
      await storage.setRoom("room-1", room);

      const socket = new MockWebSocket() as unknown as WebSocket;
      const participant: ParticipantInfo = {
        userId: "user-1",
        userName: "Alice",
        socket,
      };

      await storage.setParticipant("room-1", "user-1", participant);
      const retrieved = await storage.getParticipant("room-1", "user-1");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.userId).toBe("user-1");
      expect(retrieved?.userName).toBe("Alice");
    });

    it("should return null for non-existent participant", async () => {
      const room: Room = {
        id: "room-1",
        participants: new Map(),
        createdAt: Date.now(),
      };
      await storage.setRoom("room-1", room);

      const participant = await storage.getParticipant(
        "room-1",
        "non-existent",
      );
      expect(participant).toBeNull();
    });

    it("should delete participant", async () => {
      const room: Room = {
        id: "room-1",
        participants: new Map(),
        createdAt: Date.now(),
      };
      await storage.setRoom("room-1", room);

      const socket = new MockWebSocket() as unknown as WebSocket;
      const participant: ParticipantInfo = {
        userId: "user-1",
        userName: "Alice",
        socket,
      };

      await storage.setParticipant("room-1", "user-1", participant);
      await storage.deleteParticipant("room-1", "user-1");

      const retrieved = await storage.getParticipant("room-1", "user-1");
      expect(retrieved).toBeNull();
    });

    it("should get all participants", async () => {
      const room: Room = {
        id: "room-1",
        participants: new Map(),
        createdAt: Date.now(),
      };
      await storage.setRoom("room-1", room);

      const socket1 = new MockWebSocket() as unknown as WebSocket;
      const socket2 = new MockWebSocket() as unknown as WebSocket;

      await storage.setParticipant("room-1", "user-1", {
        userId: "user-1",
        userName: "Alice",
        socket: socket1,
      });
      await storage.setParticipant("room-1", "user-2", {
        userId: "user-2",
        userName: "Bob",
        socket: socket2,
      });

      const participants = await storage.getAllParticipants("room-1");
      expect(participants.size).toBe(2);
    });
  });

  describe("Event Listeners", () => {
    it("should emit room:create event", async () => {
      const events: StorageEvent[] = [];
      const listener: IStorageEventListener = {
        onAfterChange: (event) => {
          events.push(event);
        },
      };

      storage.addListener(listener);

      const room: Room = {
        id: "room-1",
        participants: new Map(),
        createdAt: Date.now(),
      };
      await storage.setRoom("room-1", room);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("room:create");
    });

    it("should emit room:update event on update", async () => {
      const room: Room = {
        id: "room-1",
        name: "Original",
        participants: new Map(),
        createdAt: Date.now(),
      };
      await storage.setRoom("room-1", room);

      const events: StorageEvent[] = [];
      const listener: IStorageEventListener = {
        onAfterChange: (event) => {
          events.push(event);
        },
      };
      storage.addListener(listener);

      const updatedRoom: Room = {
        ...room,
        name: "Updated",
      };
      await storage.setRoom("room-1", updatedRoom);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("room:update");
    });

    it("should emit room:delete event", async () => {
      const room: Room = {
        id: "room-1",
        participants: new Map(),
        createdAt: Date.now(),
      };
      await storage.setRoom("room-1", room);

      const events: StorageEvent[] = [];
      const listener: IStorageEventListener = {
        onAfterChange: (event) => {
          events.push(event);
        },
      };
      storage.addListener(listener);

      await storage.deleteRoom("room-1");

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("room:delete");
    });

    it("should allow canceling operations via onBeforeChange", async () => {
      const listener: IStorageEventListener = {
        onBeforeChange: () => false,
      };
      storage.addListener(listener);

      const room: Room = {
        id: "room-1",
        participants: new Map(),
        createdAt: Date.now(),
      };
      await storage.setRoom("room-1", room);

      const retrieved = await storage.getRoom("room-1");
      expect(retrieved).toBeNull();
    });

    it("should remove listener", async () => {
      const events: StorageEvent[] = [];
      const listener: IStorageEventListener = {
        onAfterChange: (event) => {
          events.push(event);
        },
      };

      storage.addListener(listener);
      storage.removeListener(listener);

      const room: Room = {
        id: "room-1",
        participants: new Map(),
        createdAt: Date.now(),
      };
      await storage.setRoom("room-1", room);

      expect(events).toHaveLength(0);
    });

    it("should clear all listeners", async () => {
      const events: StorageEvent[] = [];
      const listener: IStorageEventListener = {
        onAfterChange: (event) => {
          events.push(event);
        },
      };

      storage.addListener(listener);
      storage.clearListeners();

      const room: Room = {
        id: "room-1",
        participants: new Map(),
        createdAt: Date.now(),
      };
      await storage.setRoom("room-1", room);

      expect(events).toHaveLength(0);
    });

    it("should emit participant:join event", async () => {
      const room: Room = {
        id: "room-1",
        participants: new Map(),
        createdAt: Date.now(),
      };
      await storage.setRoom("room-1", room);

      const events: StorageEvent[] = [];
      const listener: IStorageEventListener = {
        onAfterChange: (event) => {
          events.push(event);
        },
      };
      storage.addListener(listener);

      const socket = new MockWebSocket() as unknown as WebSocket;
      await storage.setParticipant("room-1", "user-1", {
        userId: "user-1",
        userName: "Alice",
        socket,
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("participant:join");
    });

    it("should emit participant:leave event", async () => {
      const room: Room = {
        id: "room-1",
        participants: new Map(),
        createdAt: Date.now(),
      };
      await storage.setRoom("room-1", room);

      const socket = new MockWebSocket() as unknown as WebSocket;
      await storage.setParticipant("room-1", "user-1", {
        userId: "user-1",
        userName: "Alice",
        socket,
      });

      const events: StorageEvent[] = [];
      const listener: IStorageEventListener = {
        onAfterChange: (event) => {
          events.push(event);
        },
      };
      storage.addListener(listener);

      await storage.deleteParticipant("room-1", "user-1");

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("participant:leave");
    });

    it("should emit user:bindRoom event", async () => {
      const events: StorageEvent[] = [];
      const listener: IStorageEventListener = {
        onAfterChange: (event) => {
          events.push(event);
        },
      };
      storage.addListener(listener);

      await storage.setUserRoom("user-1", "room-1");

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("user:bindRoom");
    });

    it("should emit user:unbindRoom event", async () => {
      await storage.setUserRoom("user-1", "room-1");

      const events: StorageEvent[] = [];
      const listener: IStorageEventListener = {
        onAfterChange: (event) => {
          events.push(event);
        },
      };
      storage.addListener(listener);

      await storage.deleteUserRoom("user-1");

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("user:unbindRoom");
    });
  });

  describe("Edge Cases", () => {
    it("should handle deleting non-existent room gracefully", async () => {
      await expect(storage.deleteRoom("non-existent")).resolves.not.toThrow();
    });

    it("should handle deleting non-existent user room gracefully", async () => {
      await expect(
        storage.deleteUserRoom("non-existent"),
      ).resolves.not.toThrow();
    });

    it("should handle setting participant in non-existent room", async () => {
      const socket = new MockWebSocket() as unknown as WebSocket;
      await expect(
        storage.setParticipant("non-existent", "user-1", {
          userId: "user-1",
          userName: "Alice",
          socket,
        }),
      ).resolves.not.toThrow();
    });

    it("should handle deleting participant from non-existent room", async () => {
      await expect(
        storage.deleteParticipant("non-existent", "user-1"),
      ).resolves.not.toThrow();
    });

    it("should return empty map for participants in non-existent room", async () => {
      const participants = await storage.getAllParticipants("non-existent");
      expect(participants.size).toBe(0);
    });
  });
});
