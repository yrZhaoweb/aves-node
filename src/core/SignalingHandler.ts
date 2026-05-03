import { AvesError } from "./AvesError";
import { RoomManager } from "./RoomManager";
import {
  SignalingMessage,
  RTCSessionDescriptionInit,
  RTCIceCandidateInit,
} from "../types/types";

/**
 * SignalingHandler processes and forwards WebRTC signaling messages
 * between participants in a room
 */
export class SignalingHandler {
  private roomManager: RoomManager;
  private errorCallbacks = new Set<(error: AvesError) => void>();

  constructor(roomManager: RoomManager) {
    this.roomManager = roomManager;
  }

  /**
   * Register a callback for SignalingHandler-level errors
   * (e.g. invalid offer/answer/ICE candidate received).
   */
  onError(callback: (error: AvesError) => void): void {
    this.errorCallbacks.add(callback);
  }

  private emitError(error: AvesError): void {
    this.errorCallbacks.forEach((cb) => cb(error));
  }

  /**
   * Handle and forward an offer message to the target peer
   * Requirements: 9.1, 9.4
   */
  async handleOffer(
    fromId: string,
    targetId: string,
    offer: RTCSessionDescriptionInit,
  ): Promise<void> {
    if (!this.validateOffer(offer)) {
      this.emitError(
        new AvesError({ message: `Invalid offer from ${fromId} to ${targetId}`, code: "INVALID_MESSAGE", stage: "signaling", retryable: false }),
      );
      return;
    }
    await this.forwardMessage(targetId, {
      type: "offer",
      fromId,
      targetId,
      offer,
    });
  }

  /**
   * Handle and forward an answer message to the target peer
   * Requirements: 9.2, 9.4
   */
  async handleAnswer(
    fromId: string,
    targetId: string,
    answer: RTCSessionDescriptionInit,
  ): Promise<void> {
    if (!this.validateAnswer(answer)) {
      this.emitError(
        new AvesError({ message: `Invalid answer from ${fromId} to ${targetId}`, code: "INVALID_MESSAGE", stage: "signaling", retryable: false }),
      );
      return;
    }
    await this.forwardMessage(targetId, {
      type: "answer",
      fromId,
      targetId,
      answer,
    });
  }

  /**
   * Handle and forward an ICE candidate to the target peer
   * Requirements: 9.3, 9.4
   */
  async handleIceCandidate(
    fromId: string,
    targetId: string,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    if (!this.validateIceCandidate(candidate)) {
      this.emitError(
        new AvesError({ message: `Invalid ICE candidate from ${fromId} to ${targetId}`, code: "INVALID_MESSAGE", stage: "signaling", retryable: false }),
      );
      return;
    }
    await this.forwardMessage(targetId, {
      type: "ice-candidate",
      fromId,
      targetId,
      candidate,
    });
  }

  /**
   * Common logic to forward a signaling message to target user
   */
  private async forwardMessage(
    targetId: string,
    message: SignalingMessage,
  ): Promise<void> {
    await this.roomManager.sendToUser(targetId, message);
  }

  /**
   * Validate a signaling message has all required fields.
   */
  validateSignalingMessage(message: unknown): boolean {
    if (!message || typeof message !== "object") {
      return false;
    }

    const msg = message as Record<string, unknown>;
    if (!this.validatePeerIds(msg.fromId, msg.targetId)) {
      return false;
    }

    switch (msg.type) {
      case "offer":
        return this.validateOffer(msg.offer);
      case "answer":
        return this.validateAnswer(msg.answer);
      case "ice-candidate":
        return this.validateIceCandidate(msg.candidate);
      default:
        return false;
    }
  }

  private validatePeerIds(fromId: unknown, targetId: unknown): boolean {
    return (
      typeof fromId === "string" &&
      fromId.trim().length > 0 &&
      typeof targetId === "string" &&
      targetId.trim().length > 0
    );
  }

  /**
   * Validate a session description (offer or answer) has required fields
   */
  private validateSessionDescription(
    description: unknown,
    expectedType: "offer" | "answer",
  ): boolean {
    if (!description || typeof description !== "object") {
      return false;
    }

    const record = description as Record<string, unknown>;
    return !!(
      record.type === expectedType &&
      typeof record.sdp === "string" &&
      record.sdp.length > 0
    );
  }

  private validateOffer(offer: unknown): boolean {
    return this.validateSessionDescription(offer, "offer");
  }

  private validateAnswer(answer: unknown): boolean {
    return this.validateSessionDescription(answer, "answer");
  }

  /**
   * Validate an ICE candidate has required fields
   */
  private validateIceCandidate(candidate: unknown): boolean {
    if (!candidate || typeof candidate !== "object") {
      return false;
    }

    const record = candidate as Record<string, unknown>;
    const sdpMid = record.sdpMid;
    const sdpMLineIndex = record.sdpMLineIndex;

    return !!(
      typeof record.candidate === "string" &&
      record.candidate.length > 0 &&
      (sdpMid === undefined || sdpMid === null || typeof sdpMid === "string") &&
      (sdpMLineIndex === undefined ||
        sdpMLineIndex === null ||
        (typeof sdpMLineIndex === "number" &&
          Number.isInteger(sdpMLineIndex) &&
          sdpMLineIndex >= 0))
    );
  }
}
