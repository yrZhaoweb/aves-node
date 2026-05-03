describe("AvesServer optional storage dependencies", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("ioredis");
    jest.dontMock("mongodb");
  });

  it("should not load ioredis when using memory storage", () => {
    jest.isolateModules(() => {
      jest.doMock("ioredis", () => {
        throw new Error("ioredis should not be required for memory storage");
      });

      const { AvesServer } = require("../../core/AvesServer") as typeof import("../../core/AvesServer");
      const server = new AvesServer({ debug: false });
      server.close();
    });
  });

  it("should not load mongodb when using memory storage", () => {
    jest.isolateModules(() => {
      jest.doMock("mongodb", () => {
        throw new Error("mongodb should not be required for memory storage");
      });

      const { AvesServer } = require("../../core/AvesServer") as typeof import("../../core/AvesServer");
      const server = new AvesServer({ debug: false });
      server.close();
    });
  });

  it("should initialize MongoDB storage from a URI without requiring users to pass a Db", async () => {
    const collection = {
      createIndex: jest.fn().mockResolvedValue("index"),
      find: jest.fn(() => ({
        toArray: jest.fn().mockResolvedValue([]),
      })),
    };
    const db = {
      collection: jest.fn(() => collection),
    };
    const connect = jest.fn().mockResolvedValue(undefined);
    const close = jest.fn().mockResolvedValue(undefined);
    const MongoClient = jest.fn().mockImplementation((uri: string) => ({
      uri,
      connect,
      close,
      db: jest.fn(() => db),
    }));

    await jest.isolateModulesAsync(async () => {
      jest.doMock("mongodb", () => ({ MongoClient }));

      const { AvesServer } = require("../../core/AvesServer") as typeof import("../../core/AvesServer");
      const server = new AvesServer({
        mongo: {
          uri: "mongodb://localhost:27017",
          dbName: "aves-test",
          collectionPrefix: "custom",
        },
      });

      await expect(server.getHealth()).resolves.toEqual(
        expect.objectContaining({ storage: "mongodb" }),
      );
      expect(MongoClient).toHaveBeenCalledWith("mongodb://localhost:27017");
      expect(connect).toHaveBeenCalledTimes(1);
      expect(db.collection).toHaveBeenCalledWith("custom_rooms");
      expect(db.collection).toHaveBeenCalledWith("custom_user_rooms");
      expect(db.collection).toHaveBeenCalledWith("custom_participants");

      server.close();
      await new Promise((resolve) => setImmediate(resolve));
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  it("should reject incomplete MongoDB storage configuration", () => {
    jest.isolateModules(() => {
      const { AvesServer } = require("../../core/AvesServer") as typeof import("../../core/AvesServer");

      expect(() => new AvesServer({ mongo: {} })).toThrow(
        "MongoDB storage requires mongo.uri, mongo.client, or mongo.db",
      );
    });
  });

  it("should reject configuring Redis and MongoDB storage together", () => {
    jest.isolateModules(() => {
      const { AvesServer } = require("../../core/AvesServer") as typeof import("../../core/AvesServer");

      expect(
        () =>
          new AvesServer({
            redis: {} as any,
            mongo: {} as any,
          }),
      ).toThrow("Configure either redis or mongo storage, not both");
    });
  });
});
