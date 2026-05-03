import { EventEmitter } from "events";
import { WebSocket } from "ws";
import { RoomManager } from "../../core/RoomManager";
import { RedisStorage } from "../../storage/RedisStorage";
import { Room } from "../../types/types";

class MockWebSocket {
  readyState = WebSocket.OPEN;
  sentMessages: string[] = [];

  send(data: string): void {
    this.sentMessages.push(data);
  }
}

type RedisValue = string | Map<string, string> | Set<string>;

class FakeRedisBackend {
  store = new Map<string, RedisValue>();
  emitter = new EventEmitter();
}

class FakeRedis extends EventEmitter {
  private backend: FakeRedisBackend;
  private subscriptions = new Set<string>();

  constructor(backend: FakeRedisBackend) {
    super();
    this.backend = backend;
  }

  duplicate(): FakeRedis {
    return new FakeRedis(this.backend);
  }

  async hset(key: string, values: Record<string, string>): Promise<number> {
    const existing = this.backend.store.get(key);
    const hash = existing instanceof Map ? existing : new Map<string, string>();
    Object.entries(values).forEach(([field, value]) => hash.set(field, value));
    this.backend.store.set(key, hash);
    return Object.keys(values).length;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const existing = this.backend.store.get(key);
    if (!(existing instanceof Map)) {
      return {};
    }
    return Object.fromEntries(existing.entries());
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    const existing = this.backend.store.get(key);
    const set = existing instanceof Set ? existing : new Set<string>();
    members.forEach((member) => set.add(member));
    this.backend.store.set(key, set);
    return set.size;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const existing = this.backend.store.get(key);
    if (!(existing instanceof Set)) {
      return 0;
    }
    members.forEach((member) => existing.delete(member));
    if (existing.size === 0) {
      this.backend.store.delete(key);
    }
    return existing.size;
  }

  async smembers(key: string): Promise<string[]> {
    const existing = this.backend.store.get(key);
    return existing instanceof Set ? Array.from(existing.values()) : [];
  }

  async sismember(key: string, member: string): Promise<number> {
    const existing = this.backend.store.get(key);
    return existing instanceof Set && existing.has(member) ? 1 : 0;
  }

  async set(key: string, value: string, mode?: "NX"): Promise<"OK" | null> {
    if (mode === "NX" && this.backend.store.has(key)) {
      return null;
    }
    this.backend.store.set(key, value);
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    const existing = this.backend.store.get(key);
    return typeof existing === "string" ? existing : null;
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    keys.forEach((key) => {
      if (this.backend.store.delete(key)) {
        deleted += 1;
      }
    });
    return deleted;
  }

  pipeline() {
    const commands: string[] = [];
    return {
      hgetall: (key: string) => {
        commands.push(key);
      },
      exec: async () =>
        Promise.all(
          commands.map(async (key) => [null, await this.hgetall(key)] as const),
        ),
    };
  }

  async publish(channel: string, payload: string): Promise<number> {
    this.backend.emitter.emit(channel, payload);
    return 1;
  }

  async subscribe(channel: string): Promise<number> {
    if (this.subscriptions.has(channel)) {
      return this.subscriptions.size;
    }
    this.subscriptions.add(channel);
    this.backend.emitter.on(channel, (payload: string) => {
      this.emit("message", channel, payload);
    });
    return this.subscriptions.size;
  }

  async unsubscribe(channel: string): Promise<number> {
    this.subscriptions.delete(channel);
    return this.subscriptions.size;
  }

  async quit(): Promise<"OK"> {
    this.removeAllListeners();
    return "OK";
  }
}

describe("RedisStorage", () => {
  const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

  function createStorage(prefix = "aves"): {
    backend: FakeRedisBackend;
    redis: FakeRedis;
    storage: RedisStorage;
  } {
    const backend = new FakeRedisBackend();
    const redis = new FakeRedis(backend);
    const storage = new RedisStorage(redis as unknown as any, prefix);
    return { backend, redis, storage };
  }

  it("forwards signaling messages across storage instances", async () => {
    const backend = new FakeRedisBackend();
    const redisA = new FakeRedis(backend);
    const redisB = new FakeRedis(backend);
    const storageA = new RedisStorage(redisA as unknown as any);
    const storageB = new RedisStorage(redisB as unknown as any);
    const roomManagerA = new RoomManager(storageA);
    const roomManagerB = new RoomManager(storageB);

    const roomId = await roomManagerA.createRoom();
    const socketA = new MockWebSocket() as unknown as WebSocket;
    const socketB = new MockWebSocket() as unknown as WebSocket;

    await roomManagerA.joinRoom(roomId, "user-a", "Alice", socketA);
    await roomManagerB.joinRoom(roomId, "user-b", "Bob", socketB);

    await roomManagerA.sendToUser("user-b", {
      type: "offer",
      fromId: "user-a",
      targetId: "user-b",
      offer: { type: "offer", sdp: "test-sdp" },
    });

    await flushAsync();

    expect((socketB as unknown as MockWebSocket).sentMessages).toHaveLength(1);
    expect(
      JSON.parse((socketB as unknown as MockWebSocket).sentMessages[0]),
    ).toEqual({
      type: "offer",
      fromId: "user-a",
      targetId: "user-b",
      offer: { type: "offer", sdp: "test-sdp" },
    });

    storageA.close();
    storageB.close();
  });

  it("persists room metadata, user bindings, and participant lifecycle", async () => {
    const { storage } = createStorage();
    const socket = new MockWebSocket() as unknown as WebSocket;
    const room: Room = {
      id: "room-1",
      name: "Launch Room",
      maxCapacity: 4,
      password: "secret",
      participants: new Map(),
      createdAt: 123,
    };

    await storage.setRoom("room-1", room);
    await storage.setRoom("room-1", { ...room, name: "Updated Room" });

    await expect(storage.roomExists("room-1")).resolves.toBe(true);
    await expect(storage.getRoom("room-1")).resolves.toEqual(
      expect.objectContaining({
        id: "room-1",
        name: "Updated Room",
        maxCapacity: 4,
        password: "secret",
        createdAt: 123,
      }),
    );
    await expect(storage.getAllRooms()).resolves.toHaveLength(1);

    await expect(storage.setUserRoom("user-1", "room-1")).resolves.toBe(true);
    await expect(storage.setUserRoom("user-1", "room-2")).resolves.toBe(false);
    await expect(storage.getUserRoom("user-1")).resolves.toBe("room-1");

    await expect(
      storage.setParticipant("room-1", "user-1", {
        userId: "user-1",
        userName: "Alice",
        socket,
      }),
    ).resolves.toBe(true);
    await expect(storage.getParticipant("room-1", "user-1")).resolves.toEqual(
      expect.objectContaining({
        userId: "user-1",
        userName: "Alice",
        socket,
      }),
    );
    await expect(storage.getAllParticipants("room-1")).resolves.toEqual(
      new Map([
        [
          "user-1",
          expect.objectContaining({
            userId: "user-1",
            userName: "Alice",
            socket,
          }),
        ],
      ]),
    );

    await storage.deleteParticipant("room-1", "missing-user");
    await storage.deleteParticipant("room-1", "user-1");
    await expect(storage.getParticipant("room-1", "user-1")).resolves.toBeNull();
    await expect(storage.getAllParticipants("room-1")).resolves.toEqual(new Map());

    await storage.deleteUserRoom("missing-user");
    await storage.deleteUserRoom("user-1");
    await expect(storage.getUserRoom("user-1")).resolves.toBeNull();

    await storage.deleteRoom("missing-room");
    await storage.deleteRoom("room-1");
    await expect(storage.roomExists("room-1")).resolves.toBe(false);
    await expect(storage.getRoom("room-1")).resolves.toBeNull();

    storage.close();
    storage.close();
  });

  it("honors before-change cancellation for Redis mutations", async () => {
    const { storage } = createStorage();
    const socket = new MockWebSocket() as unknown as WebSocket;
    const room: Room = {
      id: "room-cancel",
      participants: new Map(),
      createdAt: 1,
    };

    storage.addListener({
      onBeforeChange: jest.fn().mockResolvedValue(false),
    });

    await storage.setRoom("room-cancel", room);
    await expect(storage.getRoom("room-cancel")).resolves.toBeNull();
    await expect(storage.setUserRoom("user-cancel", "room-cancel")).resolves.toBe(
      false,
    );
    await expect(
      storage.setParticipant("room-cancel", "user-cancel", {
        userId: "user-cancel",
        userName: "Cancelled",
        socket,
      }),
    ).resolves.toBe(false);

    storage.clearListeners();
    await storage.setRoom("room-cancel", room);
    await storage.setUserRoom("user-cancel", "room-cancel");
    await storage.setParticipant("room-cancel", "user-cancel", {
      userId: "user-cancel",
      userName: "Cancelled",
      socket,
    });

    storage.clearListeners();
    storage.addListener({
      onBeforeChange: jest.fn().mockResolvedValue(false),
    });

    await storage.deleteRoom("room-cancel");
    await expect(storage.roomExists("room-cancel")).resolves.toBe(true);
    await storage.deleteUserRoom("user-cancel");
    await expect(storage.getUserRoom("user-cancel")).resolves.toBe("room-cancel");
    await storage.deleteParticipant("room-cancel", "user-cancel");
    await expect(storage.getParticipant("room-cancel", "user-cancel")).resolves.toEqual(
      expect.objectContaining({ userId: "user-cancel" }),
    );

    storage.close();
  });

  it("filters unavailable Redis participants and malformed pipeline results", async () => {
    const { redis, storage } = createStorage();
    const instanceId = (storage as any).instanceId;

    await redis.hset("aves:room:room-remote", {
      id: "room-remote",
      createdAt: "1",
    });
    await redis.sadd("aves:rooms", "room-remote");
    await redis.sadd(
      "aves:room:room-remote:participants",
      "same-instance",
      "missing-user-id",
    );
    await redis.hset("aves:room:room-remote:participant:same-instance", {
      userId: "same-instance",
      userName: "Same Instance",
      instanceId,
    });
    await redis.hset("aves:room:room-remote:participant:missing-user-id", {
      userName: "Broken",
      instanceId: "other-instance",
    } as Record<string, string>);

    await expect(
      storage.getParticipant("room-remote", "same-instance"),
    ).resolves.toBeNull();
    await expect(storage.getAllParticipants("room-remote")).resolves.toEqual(
      new Map(),
    );

    storage.close();
  });
});
