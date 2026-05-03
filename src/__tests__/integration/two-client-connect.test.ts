/**
 * Integration test: Two AvesClient instances complete signaling + WebRTC connection.
 */

import { installMocks, uninstallMocks, startTestServer, stopTestServer, createClient, waitForEvent, flush, TestServer } from "./setup";

describe("Two-client WebRTC connection", () => {
  let server: TestServer;

  async function waitForPeerState(
    states: Array<[string, string]>,
    peerId: string,
    expectedState: string,
    attempts = 40,
  ): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      if (states.some(([id, state]) => id === peerId && state === expectedState)) {
        return;
      }
      await flush();
    }
  }

  beforeAll(async () => {
    installMocks();
    server = await startTestServer();
  });

  afterAll(async () => {
    uninstallMocks();
    await stopTestServer(server);
  });

  it("should complete full connection lifecycle (create room → join → WebRTC connect → leave)", async () => {
    const alice = createClient(server);
    const bob = createClient(server);

    // Alice creates and joins a room
    const roomId = await alice.createRoom();
    expect(roomId).toBeTruthy();
    await alice.joinRoom(roomId, "Alice");

    // Bob joins — Alice gets userJoined for Bob
    const aliceSeesBob = waitForEvent(alice, "userJoined");
    const participants = await bob.joinRoom(roomId, "Bob");
    expect(bob.getCurrentUserId()).toBeTruthy();

    const [bobUser] = await aliceSeesBob;
    expect(bobUser.name).toBe("Bob");

    // Wait for WebRTC connection (offer/answer/ICE) to fully settle
    await flush();
    await flush();
    await flush();
    await flush();

    // Both should have each other as participants
    expect(alice.getParticipants().length).toBeGreaterThanOrEqual(1);
    expect(bob.getParticipants().length).toBeGreaterThanOrEqual(1);

    // Leave — wait for ICE candidates to settle first
    const aliceId = alice.getCurrentUserId();
    const aliceLeftPromise = waitForEvent(bob, "userLeft");
    await alice.leaveRoom();
    const [leftUserId] = await aliceLeftPromise;
    expect(leftUserId).toBe(aliceId);

    await bob.leaveRoom();
    alice.destroy();
    bob.destroy();
  }, 15000);

  it("should exchange connection state events during WebRTC setup", async () => {
    const alice = createClient(server);
    const bob = createClient(server);

    const roomId = await alice.createRoom();
    await alice.joinRoom(roomId, "Alice");

    const states: Array<[string, string]> = [];
    alice.on("connectionStateChange", (peerId, state) => {
      states.push([peerId, state]);
    });

    await bob.joinRoom(roomId, "Bob");

    // Should have gone through connecting → connected for Bob
    const bobId = bob.getCurrentUserId()!;
    await waitForPeerState(states, bobId, "connected");
    const bobStates = states.filter(([id]) => id === bobId).map(([, s]) => s);
    expect(bobStates.length).toBeGreaterThan(0);
    expect(bobStates).toContain("connected");

    alice.destroy();
    bob.destroy();
  }, 15000);

  it("should handle third peer joining existing mesh", async () => {
    const alice = createClient(server);
    const bob = createClient(server);
    const carol = createClient(server);

    const roomId = await alice.createRoom();
    await alice.joinRoom(roomId, "Alice");
    await bob.joinRoom(roomId, "Bob");
    await flush();
    await flush();

    // Carol joins — both Alice and Bob should get userJoined
    const aliceSeesCarol = waitForEvent(alice, "userJoined");
    const bobSeesCarol = waitForEvent(bob, "userJoined");
    await carol.joinRoom(roomId, "Carol");

    const [carolAsSeenByAlice] = await aliceSeesCarol;
    expect(carolAsSeenByAlice.name).toBe("Carol");
    const [carolAsSeenByBob] = await bobSeesCarol;
    expect(carolAsSeenByBob.name).toBe("Carol");

    for (let i = 0; i < 5; i++) {
      await flush();
    }

    expect(alice.getParticipants().length).toBeGreaterThanOrEqual(2);
    expect(bob.getParticipants().length).toBeGreaterThanOrEqual(2);
    expect(carol.getParticipants().length).toBeGreaterThanOrEqual(2);

    alice.destroy();
    bob.destroy();
    carol.destroy();
  }, 15000);
});
