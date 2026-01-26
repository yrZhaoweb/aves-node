import {
  toRoomData,
  toParticipantData,
  RoomData,
  ParticipantData,
} from "../../storage/StorageEvents";
import { Room, ParticipantInfo } from "../../types/types";
import { WebSocket } from "ws";
import { MockWebSocket } from "../utils/MockWebSocket";

describe("StorageEvents", () => {
  describe("toRoomData", () => {
    it("should convert Room to RoomData", () => {
      const room: Room = {
        id: "room-1",
        name: "Test Room",
        maxCapacity: 10,
        password: "secret",
        participants: new Map(),
        createdAt: 1234567890,
      };

      const roomData = toRoomData(room);

      expect(roomData.id).toBe("room-1");
      expect(roomData.name).toBe("Test Room");
      expect(roomData.maxCapacity).toBe(10);
      expect(roomData.password).toBe("secret");
      expect(roomData.participantCount).toBe(0);
      expect(roomData.createdAt).toBe(1234567890);
    });

    it("should count participants correctly", () => {
      const socket = new MockWebSocket() as unknown as WebSocket;
      const participants = new Map<string, ParticipantInfo>();
      participants.set("user-1", {
        userId: "user-1",
        userName: "Alice",
        socket,
      });
      participants.set("user-2", { userId: "user-2", userName: "Bob", socket });

      const room: Room = {
        id: "room-1",
        participants,
        createdAt: Date.now(),
      };

      const roomData = toRoomData(room);
      expect(roomData.participantCount).toBe(2);
    });

    it("should handle optional fields", () => {
      const room: Room = {
        id: "room-1",
        participants: new Map(),
        createdAt: Date.now(),
      };

      const roomData = toRoomData(room);

      expect(roomData.name).toBeUndefined();
      expect(roomData.maxCapacity).toBeUndefined();
      expect(roomData.password).toBeUndefined();
    });
  });

  describe("toParticipantData", () => {
    it("should convert ParticipantInfo to ParticipantData", () => {
      const socket = new MockWebSocket() as unknown as WebSocket;
      const participant: ParticipantInfo = {
        userId: "user-1",
        userName: "Alice",
        socket,
      };

      const participantData = toParticipantData(participant);

      expect(participantData.userId).toBe("user-1");
      expect(participantData.userName).toBe("Alice");
      expect((participantData as any).socket).toBeUndefined();
    });

    it("should not include socket in output", () => {
      const socket = new MockWebSocket() as unknown as WebSocket;
      const participant: ParticipantInfo = {
        userId: "user-1",
        userName: "Alice",
        socket,
      };

      const participantData = toParticipantData(participant);
      const keys = Object.keys(participantData);

      expect(keys).toContain("userId");
      expect(keys).toContain("userName");
      expect(keys).not.toContain("socket");
    });
  });
});
