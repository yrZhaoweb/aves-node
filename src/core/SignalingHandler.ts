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

  constructor(roomManager: RoomManager) {
    this.roomManager = roomManager;
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
      console.warn(`Invalid offer from ${fromId} to ${targetId}`);
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
      console.warn(`Invalid answer from ${fromId} to ${targetId}`);
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
      console.warn(`Invalid ICE candidate from ${fromId} to ${targetId}`);
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
   * Validate a signaling message has all required fields
   * Requirements: 9.6
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

  /**
   * Validate peer IDs are non-empty strings
   */
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
    description: any,
    expectedType: "offer" | "answer",
  ): boolean {
    return !!(
      description &&
      typeof description === "object" &&
      description.type === expectedType &&
      typeof description.sdp === "string" &&
      description.sdp.length > 0
    );
  }

  private validateOffer(offer: any): boolean {
    return this.validateSessionDescription(offer, "offer");
  }

  private validateAnswer(answer: any): boolean {
    return this.validateSessionDescription(answer, "answer");
  }

  /**
   * Validate an ICE candidate has required fields
   */
  private validateIceCandidate(candidate: any): boolean {
    return !!(
      candidate &&
      typeof candidate === "object" &&
      typeof candidate.candidate === "string" &&
      candidate.candidate.length > 0
    );
  }
}
