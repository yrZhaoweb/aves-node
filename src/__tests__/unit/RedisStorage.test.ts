import { EventEmitter } from "events";
import { WebSocket } from "ws";
import { RoomManager } from "../../core/RoomManager";
import { RedisStorage } from "../../storage/RedisStorage";

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

  async set(key: string, value: string): Promise<"OK"> {
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
});
