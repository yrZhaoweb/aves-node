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
  handleOffer(
    fromId: string,
    targetId: string,
    offer: RTCSessionDescriptionInit
  ): void {
    // Validate the offer message
    if (!this.validateOffer(offer)) {
      console.warn(`Invalid offer from ${fromId} to ${targetId}`);
      return;
    }

    // Check if target exists
    const targetRoomId = this.roomManager.getRoomIdByUserId(targetId);
    if (!targetRoomId) {
      console.warn(`Target user ${targetId} not found in any room`);
      return;
    }

    // Forward the offer to the target
    const message: SignalingMessage = {
      type: "offer",
      fromId,
      targetId,
      offer,
    };

    this.roomManager.sendToUser(targetId, message);
  }

  /**
   * Handle and forward an answer message to the target peer
   * Requirements: 9.2, 9.4
   */
  handleAnswer(
    fromId: string,
    targetId: string,
    answer: RTCSessionDescriptionInit
  ): void {
    // Validate the answer message
    if (!this.validateAnswer(answer)) {
      console.warn(`Invalid answer from ${fromId} to ${targetId}`);
      return;
    }

    // Check if target exists
    const targetRoomId = this.roomManager.getRoomIdByUserId(targetId);
    if (!targetRoomId) {
      console.warn(`Target user ${targetId} not found in any room`);
      return;
    }

    // Forward the answer to the target
    const message: SignalingMessage = {
      type: "answer",
      fromId,
      targetId,
      answer,
    };

    this.roomManager.sendToUser(targetId, message);
  }

  /**
   * Handle and forward an ICE candidate to the target peer
   * Requirements: 9.3, 9.4
   */
  handleIceCandidate(
    fromId: string,
    targetId: string,
    candidate: RTCIceCandidateInit
  ): void {
    // Validate the ICE candidate
    if (!this.validateIceCandidate(candidate)) {
      console.warn(`Invalid ICE candidate from ${fromId} to ${targetId}`);
      return;
    }

    // Check if target exists
    const targetRoomId = this.roomManager.getRoomIdByUserId(targetId);
    if (!targetRoomId) {
      console.warn(`Target user ${targetId} not found in any room`);
      return;
    }

    // Forward the ICE candidate to the target
    const message: SignalingMessage = {
      type: "ice-candidate",
      fromId,
      targetId,
      candidate,
    };

    this.roomManager.sendToUser(targetId, message);
  }

  /**
   * Validate a signaling message has all required fields
   * Requirements: 9.6
   */
  validateSignalingMessage(message: any): boolean {
    if (!message || typeof message !== "object") {
      return false;
    }

    const type = message.type;

    switch (type) {
      case "offer":
        return !!(
          typeof message.fromId === "string" &&
          message.fromId.trim().length > 0 &&
          typeof message.targetId === "string" &&
          message.targetId.trim().length > 0 &&
          this.validateOffer(message.offer)
        );

      case "answer":
        return !!(
          typeof message.fromId === "string" &&
          message.fromId.trim().length > 0 &&
          typeof message.targetId === "string" &&
          message.targetId.trim().length > 0 &&
          this.validateAnswer(message.answer)
        );

      case "ice-candidate":
        return !!(
          typeof message.fromId === "string" &&
          message.fromId.trim().length > 0 &&
          typeof message.targetId === "string" &&
          message.targetId.trim().length > 0 &&
          this.validateIceCandidate(message.candidate)
        );

      default:
        return false;
    }
  }

  /**
   * Validate an offer has required fields
   */
  private validateOffer(offer: any): boolean {
    return !!(
      offer &&
      typeof offer === "object" &&
      offer.type === "offer" &&
      typeof offer.sdp === "string" &&
      offer.sdp.length > 0
    );
  }

  /**
   * Validate an answer has required fields
   */
  private validateAnswer(answer: any): boolean {
    return !!(
      answer &&
      typeof answer === "object" &&
      answer.type === "answer" &&
      typeof answer.sdp === "string" &&
      answer.sdp.length > 0
    );
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
