/**
 * Integration test: Room lifecycle — create, join, leave, and room cleanup.
 */

import { installMocks, uninstallMocks, startTestServer, stopTestServer, createClient, waitForEvent, flushMany, TestServer } from "./setup";

describe("Room lifecycle", () => {
  let server: TestServer;

  beforeAll(async () => {
    installMocks();
    server = await startTestServer();
  });

  afterAll(async () => {
    uninstallMocks();
    await stopTestServer(server);
  });

  // Let any stale ICE candidates / async ops from previous tests settle
  beforeEach(async () => {
    await flushMany(4);
  });

  it("should auto-assign a userId when none provided", async () => {
    const client = createClient(server);
    const roomId = await client.createRoom();
    await client.joinRoom(roomId, "Alice");

    const userId = client.getCurrentUserId();
    expect(userId).toBeTruthy();
    expect(typeof userId).toBe("string");
    expect(userId!.length).toBeGreaterThan(0);

    await client.leaveRoom();
    client.destroy();
  });

  it("should accept a custom userId on join", async () => {
    const alice = createClient(server);
    const bob = createClient(server);

    const roomId = await alice.createRoom();
    await alice.joinRoom(roomId, "custom-alice-id", "Alice");
    await bob.joinRoom(roomId, "custom-bob-id", "Bob");

    expect(alice.getCurrentUserId()).toBe("custom-alice-id");
    expect(bob.getCurrentUserId()).toBe("custom-bob-id");

    // Wait for any pending WebRTC signaling to complete
    await flushMany(8);

    await alice.leaveRoom();
    await bob.leaveRoom();
    alice.destroy();
    bob.destroy();
  });

  it("should reject duplicate userId joining", async () => {
    const alice = createClient(server);
    const bob = createClient(server);

    const roomId = await alice.createRoom();
    await alice.joinRoom(roomId, "duplicate-id", "Alice");

    await expect(
      bob.joinRoom(roomId, "duplicate-id", "Bob")
    ).rejects.toThrow();

    alice.destroy();
    bob.destroy();
  });

  it("should broadcast user-left when a peer leaves", async () => {
    const alice = createClient(server);
    const bob = createClient(server);

    const roomId = await alice.createRoom();
    await alice.joinRoom(roomId, "Alice");
    await bob.joinRoom(roomId, "Bob");

    const bobId = bob.getCurrentUserId();

    // Let any in-flight ICE candidates settle before Bob leaves
    await flushMany(4);

    const leftPromise = waitForEvent(alice, "userLeft");
    await bob.leaveRoom();

    const [leftUserId] = await leftPromise;
    expect(leftUserId).toBe(bobId);

    await alice.leaveRoom();
    alice.destroy();
    bob.destroy();
  });

  it("should clean up empty rooms when last participant leaves", async () => {
    const alice = createClient(server);
    const bob = createClient(server);

    const roomId = await alice.createRoom();
    await alice.joinRoom(roomId, "Alice");
    await bob.joinRoom(roomId, "Bob");

    await flushMany(8); // Let WebRTC settle

    await alice.leaveRoom();
    await bob.leaveRoom();

    await flushMany(4);

    const roomInfo = await server.avesServer.getRoomInfo(roomId);
    expect(roomInfo).toBeNull();

    alice.destroy();
    bob.destroy();
  });

  it("should reject joining a non-existent room", async () => {
    const client = createClient(server);
    await expect(
      client.joinRoom("non-existent-room-id", "Alice")
    ).rejects.toThrow();
    client.destroy();
  });

  it("should allow creating multiple rooms independently", async () => {
    const alice = createClient(server);
    const bob = createClient(server);

    const roomA = await alice.createRoom();
    const roomB = await bob.createRoom();

    expect(roomA).not.toBe(roomB);

    await alice.joinRoom(roomA, "Alice");
    await bob.joinRoom(roomB, "Bob");

    const rooms = await server.avesServer.getAllRooms();
    const roomAInfo = rooms.find((r) => r.id === roomA);
    const roomBInfo = rooms.find((r) => r.id === roomB);
    expect(roomAInfo?.participantCount).toBe(1);
    expect(roomBInfo?.participantCount).toBe(1);

    await alice.leaveRoom();
    await bob.leaveRoom();
    alice.destroy();
    bob.destroy();
  });
});
