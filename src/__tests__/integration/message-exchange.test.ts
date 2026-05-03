/**
 * Integration test: Message exchange over DataChannel after WebRTC connection.
 */

import { installMocks, uninstallMocks, startTestServer, stopTestServer, createClient, waitForEvent, flushMany, TestServer } from "./setup";

describe("Message exchange over WebRTC DataChannel", () => {
  let server: TestServer;

  beforeAll(async () => {
    installMocks();
    server = await startTestServer();
  });

  afterAll(async () => {
    uninstallMocks();
    await stopTestServer(server);
  });

  it("should deliver a broadcast message to all connected peers", async () => {
    const alice = createClient(server);
    const bob = createClient(server);

    const roomId = await alice.createRoom();
    await alice.joinRoom(roomId, "Alice");
    await bob.joinRoom(roomId, "Bob");

    // Wait for full WebRTC handshake (offer/answer/ICE/channel-open)
    await flushMany(12);

    const aliceId = alice.getCurrentUserId();

    // Bob listens for messages
    const msgPromise = waitForEvent(bob, "message");
    alice.sendMessage({ text: "hello from alice", timestamp: Date.now() });

    const [peerId, message] = await msgPromise;
    expect(peerId).toBe(aliceId);
    expect(message.text).toBe("hello from alice");

    alice.destroy();
    bob.destroy();
  });

  it("should deliver a direct message to a specific peer", async () => {
    const alice = createClient(server);
    const bob = createClient(server);

    const roomId = await alice.createRoom();
    await alice.joinRoom(roomId, "Alice");
    await bob.joinRoom(roomId, "Bob");
    await flushMany(12);

    const aliceId = alice.getCurrentUserId();
    const bobId = bob.getCurrentUserId();

    const msgPromise = waitForEvent(bob, "message");
    alice.sendMessageToPeer(bobId!, { direct: true, text: "private" });

    const [peerId, message] = await msgPromise;
    expect(peerId).toBe(aliceId);
    expect(message.direct).toBe(true);
    expect(message.text).toBe("private");

    alice.destroy();
    bob.destroy();
  });

  it("should propagate multiple messages in sequence", async () => {
    const alice = createClient(server);
    const bob = createClient(server);

    const roomId = await alice.createRoom();
    await alice.joinRoom(roomId, "Alice");
    await bob.joinRoom(roomId, "Bob");
    await flushMany(12);

    const received: any[] = [];
    bob.on("message", (_peerId, msg) => {
      received.push(msg);
    });

    alice.sendMessage({ seq: 1 });
    alice.sendMessage({ seq: 2 });
    alice.sendMessage({ seq: 3 });

    await flushMany(4);

    expect(received.length).toBe(3);
    expect(received.map((m: any) => m.seq)).toEqual([1, 2, 3]);

    alice.destroy();
    bob.destroy();
  });

  it("should deliver messages between three peers in a full mesh", async () => {
    const alice = createClient(server);
    const bob = createClient(server);
    const carol = createClient(server);

    const roomId = await alice.createRoom();
    await alice.joinRoom(roomId, "Alice");
    await bob.joinRoom(roomId, "Bob");
    await carol.joinRoom(roomId, "Carol");
    await flushMany(16);

    const bobMessages: any[] = [];
    const carolMessages: any[] = [];
    bob.on("message", (_peerId, msg) => bobMessages.push(msg));
    carol.on("message", (_peerId, msg) => carolMessages.push(msg));

    alice.sendMessage({ mesh: true });
    await flushMany(4);

    expect(bobMessages.length).toBe(1);
    expect(bobMessages[0].mesh).toBe(true);
    expect(carolMessages.length).toBe(1);
    expect(carolMessages[0].mesh).toBe(true);

    alice.destroy();
    bob.destroy();
    carol.destroy();
  }, 20000);
});
