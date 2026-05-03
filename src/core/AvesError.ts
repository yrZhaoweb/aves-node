import type { SignalingErrorCode, SignalingErrorStage } from "../types/types";

export type AvesErrorCode = SignalingErrorCode | (string & {});

export class AvesError extends Error {
  readonly code: AvesErrorCode;
  readonly stage: SignalingErrorStage;
  readonly retryable: boolean;
  readonly peerId?: string;
  readonly roomId?: string;
  readonly requestId?: string;
  readonly cause?: unknown;

  constructor(opts: {
    message: string;
    code: AvesErrorCode;
    stage: SignalingErrorStage;
    retryable: boolean;
    peerId?: string;
    roomId?: string;
    requestId?: string;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = "AvesError";
    this.code = opts.code;
    this.stage = opts.stage;
    this.retryable = opts.retryable;
    this.peerId = opts.peerId;
    this.roomId = opts.roomId;
    this.requestId = opts.requestId;
    this.cause = opts.cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      stage: this.stage,
      retryable: this.retryable,
      peerId: this.peerId,
      roomId: this.roomId,
      requestId: this.requestId,
    };
  }
}
