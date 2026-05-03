/**
 * Integration test infrastructure for aves (full-stack: aves-node + aves-core).
 *
 * Starts a real ws.Server wired to AvesServer, creates AvesClient instances,
 * and mocks browser WebRTC APIs since tests run in Node.js.
 */

import { WebSocket, WebSocketServer } from "ws";
import { AvesClient } from "@yrzhao/aves-core";
import type { AvesClientEvents } from "@yrzhao/aves-core";
import { AvesServer } from "../../core/AvesServer";

// ---------------------------------------------------------------------------
// Mock RTCDataChannel
// ---------------------------------------------------------------------------

class MockRTCDataChannel {
  label: string;
  readyState: RTCDataChannelState = "connecting";
  binaryType: BinaryType = "arraybuffer";
  bufferedAmount = 0;
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  peer: MockRTCDataChannel | null = null;

  constructor(label: string) {
    this.label = label;
  }

  send(data: string | Blob | ArrayBuffer): void {
    if (!this.peer || this.peer.readyState !== "open") return;
    setImmediate(() => {
      if (this.peer && this.peer.onmessage) {
        this.peer.onmessage({ data } as MessageEvent);
      }
    });
  }

  close(): void {
    this.readyState = "closed";
    if (this.onclose) this.onclose(new Event("close"));
  }

  _setOpen(): void {
    this.readyState = "open";
    if (this.onopen) this.onopen(new Event("open"));
  }
}

// ---------------------------------------------------------------------------
// Mock RTCPeerConnection
// ---------------------------------------------------------------------------

// Global offer registry: SDP → MockRTCPeerConnection that created the offer.
// Used to auto-pair connections when setRemoteDescription receives an offer.
const _offerRegistry = new Map<string, MockRTCPeerConnection>();

class MockRTCPeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  onicecandidate: ((e: RTCPeerConnectionIceEvent) => void) | null = null;
  onconnectionstatechange: ((e: Event) => void) | null = null;
  ondatachannel: ((e: RTCDataChannelEvent) => void) | null = null;
  ontrack: ((e: RTCTrackEvent) => void) | null = null;

  /** Remote peer connection — paired via SDP exchange. */
  remote: MockRTCPeerConnection | null = null;

  private _channels = new Map<string, MockRTCDataChannel>();
  private _pendingRemoteChannels: MockRTCDataChannel[] = [];
  private _offerSdp: string | null = null;

  constructor(_config?: RTCConfiguration) {}

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const sdp = `mock-offer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this._offerSdp = sdp;
    _offerRegistry.set(sdp, this);
    return { type: "offer", sdp };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: "answer", sdp: `mock-answer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc as unknown as RTCSessionDescription;
    setImmediate(() => {
      if (this.onicecandidate) {
        const candidate: RTCIceCandidateInit = {
          candidate: `mock-ice-${Date.now()}`,
          sdpMid: "0",
          sdpMLineIndex: 0,
        };
        this.onicecandidate({
          candidate: {
            ...candidate,
            toJSON: () => candidate,
          },
        } as RTCPeerConnectionIceEvent);
      }
    });
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc as unknown as RTCSessionDescription;

    // Auto-pair: when receiving an offer, look up the offerer in the registry
    if (desc.type === "offer" && desc.sdp) {
      const offerer = _offerRegistry.get(desc.sdp);
      if (offerer && offerer !== this) {
        this.remote = offerer;
        offerer.remote = this;
        _offerRegistry.delete(desc.sdp);

        // Create matching channels for each channel the offerer created
        for (const remoteCh of offerer._channels.values()) {
          const localCh = new MockRTCDataChannel(remoteCh.label);
          localCh.peer = remoteCh;
          remoteCh.peer = localCh;
          this._channels.set(remoteCh.label, localCh);
          this._pendingRemoteChannels.push(localCh);
        }
        setImmediate(() => {
          for (const ch of this._pendingRemoteChannels) {
            if (this.ondatachannel) {
              this.ondatachannel({ channel: ch } as unknown as RTCDataChannelEvent);
            }
            setImmediate(() => ch._setOpen());
          }
          this._pendingRemoteChannels = [];
        });
      }
    }

    // Transition connection state
    setImmediate(() => this._setState("connecting"));
    setImmediate(() => {
      setImmediate(() => this._setState("connected"));
    });
  }

  async addIceCandidate(_candidate: RTCIceCandidateInit): Promise<void> {}

  createDataChannel(label: string): RTCDataChannel {
    const ch = new MockRTCDataChannel(label);
    this._channels.set(label, ch);
    setImmediate(() => ch._setOpen());
    return ch as unknown as RTCDataChannel;
  }

  addTransceiver(kind: string): RTCRtpTransceiver {
    return {
      sender: { replaceTrack: async () => {} } as unknown as RTCRtpSender,
      receiver: {} as RTCRtpReceiver,
    } as RTCRtpTransceiver;
  }

  addTrack(): RTCRtpSender {
    return { replaceTrack: async () => {} } as unknown as RTCRtpSender;
  }

  close(): void {
    if (this._offerSdp) {
      _offerRegistry.delete(this._offerSdp);
    }
    this._setState("closed");
    for (const ch of this._channels.values()) ch.close();
    this._channels.clear();
  }

  private _setState(s: RTCPeerConnectionState): void {
    if (this.connectionState === s) return; // avoid infinite recursion
    this.connectionState = s;
    if (this.onconnectionstatechange) {
      this.onconnectionstatechange(new Event("statechange"));
    }
  }
}

// ---------------------------------------------------------------------------
// Browser API stubs
// ---------------------------------------------------------------------------

class MockRTCSessionDescription {
  type: RTCSdpType;
  sdp: string;
  constructor(init: RTCSessionDescriptionInit) {
    this.type = init.type!;
    this.sdp = init.sdp!;
  }
  toJSON() {
    return { type: this.type, sdp: this.sdp };
  }
}

class MockRTCIceCandidate {
  candidate: string;
  constructor(init: RTCIceCandidateInit) {
    this.candidate = init.candidate ?? "";
  }
  toJSON() {
    return { candidate: this.candidate };
  }
}

class MockMediaStream {
  private _tracks: MediaStreamTrack[] = [];
  constructor(tracks?: MediaStreamTrack[]) {
    if (tracks) this._tracks = tracks;
  }
  getTracks() {
    return this._tracks;
  }
  getAudioTracks() {
    return this._tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this._tracks.filter((t) => t.kind === "video");
  }
  addTrack(t: MediaStreamTrack) {
    this._tracks.push(t);
  }
}

class MockBlob {
  size: number;
  type: string;
  constructor(parts: any[] = [], opts?: BlobPropertyBag) {
    this.size = parts.reduce((s: number, p: any) => {
      if (typeof p === "string") return s + p.length;
      return s + (p?.size ?? 0);
    }, 0);
    this.type = opts?.type ?? "";
  }
  slice() {
    return new MockBlob([]);
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    return new ArrayBuffer(10);
  }
}

// ---------------------------------------------------------------------------
// Mock installation helpers
// ---------------------------------------------------------------------------

const ORIGINALS: Record<string, any> = {};

export function installMocks(): void {
  ORIGINALS["RTCPeerConnection"] = (globalThis as any).RTCPeerConnection;
  ORIGINALS["RTCSessionDescription"] = (globalThis as any).RTCSessionDescription;
  ORIGINALS["RTCIceCandidate"] = (globalThis as any).RTCIceCandidate;
  ORIGINALS["MediaStream"] = (globalThis as any).MediaStream;
  ORIGINALS["Blob"] = (globalThis as any).Blob;

  (globalThis as any).RTCPeerConnection = MockRTCPeerConnection;
  (globalThis as any).RTCSessionDescription = MockRTCSessionDescription;
  (globalThis as any).RTCIceCandidate = MockRTCIceCandidate;
  (globalThis as any).MediaStream = MockMediaStream;
  (globalThis as any).Blob = MockBlob;

  // Polyfill WebSocket for the client side
  if (!(globalThis as any).WebSocket) {
    (globalThis as any).WebSocket = WebSocket;
  }
}

export function uninstallMocks(): void {
  for (const [key, val] of Object.entries(ORIGINALS)) {
    if (val !== undefined) {
      (globalThis as any)[key] = val;
    } else {
      delete (globalThis as any)[key];
    }
  }
}

// ---------------------------------------------------------------------------
// Test server harness
// ---------------------------------------------------------------------------

export interface TestServer {
  avesServer: AvesServer;
  wsServer: WebSocketServer;
  port: number;
  url: string;
}

/**
 * Start a test signaling server on a random port.
 */
export async function startTestServer(
  opts?: { debug?: boolean; roomTimeout?: number }
): Promise<TestServer> {
  const avesServer = new AvesServer({
    debug: opts?.debug ?? false,
    roomTimeout: opts?.roomTimeout ?? 0,
  });

  const wsServer = new WebSocketServer({ port: 0 });

  wsServer.on("connection", (ws, req) => {
    avesServer.handleConnection(ws, req);
  });

  const port = await new Promise<number>((resolve) => {
    if (wsServer.listening) {
      resolve((wsServer.address() as any).port);
    } else {
      wsServer.once("listening", () => {
        resolve((wsServer.address() as any).port);
      });
    }
  });

  return { avesServer, wsServer, port, url: `ws://localhost:${port}` };
}

/**
 * Close the test server and all resources.
 */
export async function stopTestServer(server: TestServer): Promise<void> {
  server.avesServer.close();
  await new Promise<void>((resolve, reject) => {
    server.wsServer.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Wait for pending microtasks to flush. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Call flush() n times to let nested setImmediate callbacks settle. */
export async function flushMany(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await flush();
  }
}

/** Create an AvesClient connected to the test server. */
export function createClient(server: TestServer, opts?: {
  debug?: boolean;
}): AvesClient {
  return new AvesClient({
    signalingUrl: server.url,
    debug: opts?.debug ?? false,
    reconnect: { maxAttempts: 1, delay: 100 },
  });
}

/** Wait for a typed event from an AvesClient. */
export function waitForEvent<
  T extends keyof AvesClientEvents,
>(
  client: AvesClient,
  event: T,
  timeoutMs = 8000,
): Promise<AvesClientEvents[T]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      (client as any).off(event, handler);
      reject(new Error(`Timed out waiting for "${String(event)}" (${timeoutMs}ms)`));
    }, timeoutMs);

    function handler(...args: any[]) {
      clearTimeout(timer);
      resolve(args as any);
    }

    (client as any).on(event, handler);
  });
}
