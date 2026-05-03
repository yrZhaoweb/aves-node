import { WebSocket } from "ws";
import { MongoStorage } from "../../storage/MongoStorage";
import { Room } from "../../types/types";

class MockWebSocket {
  readyState = WebSocket.OPEN;
  sentMessages: string[] = [];

  send(data: string): void {
    this.sentMessages.push(data);
  }
}

type MongoDocument = Record<string, unknown> & { _id?: string };

function matchesFilter(document: MongoDocument, filter: Record<string, unknown>) {
  return Object.entries(filter).every(([key, value]) => document[key] === value);
}

class FakeMongoCursor<T extends MongoDocument> {
  constructor(private readonly documents: T[]) {}

  async toArray(): Promise<T[]> {
    return this.documents.map((document) => ({ ...document }));
  }
}

class FakeMongoCollection<T extends MongoDocument> {
  readonly documents = new Map<string, T>();
  readonly indexes: Record<string, unknown>[] = [];

  async createIndex(index: Record<string, unknown>): Promise<string> {
    this.indexes.push(index);
    return Object.keys(index).join("_");
  }

  async replaceOne(
    filter: Record<string, unknown>,
    replacement: T,
    options?: { upsert?: boolean },
  ): Promise<{ matchedCount: number; upsertedCount: number }> {
    const existing = Array.from(this.documents.values()).find((document) =>
      matchesFilter(document, filter),
    );
    const id = String(replacement._id ?? filter._id);

    if (existing || options?.upsert) {
      this.documents.set(id, { ...replacement, _id: id });
    }

    return {
      matchedCount: existing ? 1 : 0,
      upsertedCount: existing ? 0 : options?.upsert ? 1 : 0,
    };
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: { $setOnInsert?: T },
    options?: { upsert?: boolean },
  ): Promise<{ matchedCount: number; upsertedCount: number }> {
    const existing = Array.from(this.documents.values()).find((document) =>
      matchesFilter(document, filter),
    );

    if (existing) {
      return { matchedCount: 1, upsertedCount: 0 };
    }

    if (!options?.upsert || !update.$setOnInsert) {
      return { matchedCount: 0, upsertedCount: 0 };
    }

    const id = String(update.$setOnInsert._id ?? filter._id);
    this.documents.set(id, { ...update.$setOnInsert, _id: id });
    return { matchedCount: 0, upsertedCount: 1 };
  }

  async findOne(filter: Record<string, unknown>): Promise<T | null> {
    const document = Array.from(this.documents.values()).find((candidate) =>
      matchesFilter(candidate, filter),
    );
    return document ? { ...document } : null;
  }

  find(filter: Record<string, unknown> = {}): FakeMongoCursor<T> {
    return new FakeMongoCursor(
      Array.from(this.documents.values()).filter((document) =>
        matchesFilter(document, filter),
      ),
    );
  }

  async deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }> {
    const document = Array.from(this.documents.values()).find((candidate) =>
      matchesFilter(candidate, filter),
    );
    if (!document?._id) {
      return { deletedCount: 0 };
    }

    this.documents.delete(document._id);
    return { deletedCount: 1 };
  }

  async deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount: number }> {
    let deletedCount = 0;
    for (const document of Array.from(this.documents.values())) {
      if (document._id && matchesFilter(document, filter)) {
        this.documents.delete(document._id);
        deletedCount += 1;
      }
    }
    return { deletedCount };
  }
}

class FakeMongoDb {
  private readonly collections = new Map<string, FakeMongoCollection<MongoDocument>>();

  collection<T extends MongoDocument>(name: string): FakeMongoCollection<T> {
    if (!this.collections.has(name)) {
      this.collections.set(name, new FakeMongoCollection());
    }

    return this.collections.get(name)! as FakeMongoCollection<T>;
  }
}

describe("MongoStorage", () => {
  function createStorage(prefix = "aves") {
    const db = new FakeMongoDb();
    const closeClient = jest.fn().mockResolvedValue(undefined);
    const storage = new MongoStorage(db as unknown as any, {
      collectionPrefix: prefix,
      client: { close: closeClient } as any,
      closeClientOnClose: true,
    });

    return { db, storage, closeClient };
  }

  it("persists room metadata, user bindings, and local participant lifecycle", async () => {
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
  });

  it("filters participants that do not belong to this process", async () => {
    const { db, storage } = createStorage();
    const participants = db.collection("aves_participants");

    await participants.replaceOne(
      { _id: "room-remote:user-remote" },
      {
        _id: "room-remote:user-remote",
        roomId: "room-remote",
        userId: "user-remote",
        userName: "Remote",
        instanceId: "other-instance",
      },
      { upsert: true },
    );

    await expect(
      storage.getParticipant("room-remote", "user-remote"),
    ).resolves.toBeNull();
    await expect(storage.getAllParticipants("room-remote")).resolves.toEqual(
      new Map(),
    );
  });

  it("honors before-change cancellation for MongoDB mutations", async () => {
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
  });

  it("closes an owned MongoDB client only once", async () => {
    const { storage, closeClient } = createStorage();

    storage.close();
    storage.close();
    await new Promise((resolve) => setImmediate(resolve));

    expect(closeClient).toHaveBeenCalledTimes(1);
  });
});
