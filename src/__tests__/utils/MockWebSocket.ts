import { WebSocket } from "ws";
import { EventEmitter } from "events";

/**
 * Mock WebSocket for testing purposes
 * Extends EventEmitter to support event-based testing
 */
export class MockWebSocket extends EventEmitter {
  readyState: number = 1; // WebSocket.OPEN = 1
  sentMessages: string[] = [];

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = 3; // WebSocket.CLOSED = 3
    this.emit("close");
  }

  /**
   * Clear all sent messages
   */
  clearMessages(): void {
    this.sentMessages = [];
  }

  /**
   * Get the last sent message as parsed JSON
   */
  getLastMessage<T = any>(): T | null {
    if (this.sentMessages.length === 0) return null;
    return JSON.parse(this.sentMessages[this.sentMessages.length - 1]);
  }

  /**
   * Get all sent messages as parsed JSON
   */
  getAllMessages<T = any>(): T[] {
    return this.sentMessages.map((msg) => JSON.parse(msg));
  }
}

/**
 * Create a MockWebSocket cast to WebSocket type for use in tests
 */
export function createMockWebSocket(): WebSocket & MockWebSocket {
  return new MockWebSocket() as unknown as WebSocket & MockWebSocket;
}
