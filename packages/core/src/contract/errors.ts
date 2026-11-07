/**
 * Every failed request answers with the same body: a code a program can branch on, a Korean message
 * a person can act on, and, for invalid input, which field is wrong.
 */
import { TerrariumError } from "@terrarium/core/kernel";
import type { ApiIssue } from "./korean";

/** Input that is well-formed but wrong in meaning; the issues say where (shown next to the field). */
export class InvalidInputError extends TerrariumError {
  override readonly code = "invalid_input";
  override readonly status = 400;
  constructor(
    message: string,
    readonly issues: readonly ApiIssue[],
  ) {
    super(message);
  }
}

/** Nobody is signed in, and this server only answers people who are (an SSO method that refuses strangers). */
export class UnauthenticatedError extends TerrariumError {
  override readonly code = "unauthenticated";
  override readonly status = 401;
}

/** The viewer may not do this (e.g. cancel someone else's experiment). */
export class ForbiddenError extends TerrariumError {
  override readonly code = "forbidden";
  override readonly status = 403;
}

/** A connected system (harness, graph, ClickStack) did not answer. */
export class UnavailableError extends TerrariumError {
  override readonly code = "unavailable";
  override readonly status = 503;
}

/** 이끼는 기본 모델이 있어야만 쓸 수 있다 (REQ-103, ADR-0125): 없으면 409 `{ error: { reason: "no_model" } }`. */
export class NoModelError extends TerrariumError {
  override readonly code = "no_model";
  override readonly status = 409;
  readonly reason = "no_model";
}

export interface ApiError {
  readonly error: {
    readonly code: string;
    readonly message: string;
    /** 프로그램이 가를 수 있는 까닭 (예: `no_model`). 없을 수도 있어요. */
    readonly reason?: string;
    readonly issues?: readonly ApiIssue[];
  };
}

export interface ErrorReply {
  readonly status: number;
  readonly body: ApiError;
}

const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  400: "요청이 올바르지 않아요",
  401: "로그인이 필요해요",
  403: "이 작업은 할 수 없어요",
  404: "찾을 수 없어요",
  409: "그사이 다른 변경이 있었어요. 새로고침한 뒤 다시 시도해 주세요",
  413: "요청이 너무 커요",
  422: "지원하지 않는 작업이에요",
  429: "요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요",
  503: "연결된 서비스에 연결할 수 없어요",
};

export function invalidInput(
  issues: readonly ApiIssue[],
  message = "입력값을 확인해 주세요",
): ErrorReply {
  return { status: 400, body: { error: { code: "invalid_input", message, issues } } };
}

export function errorReply(status: number, code: string, message?: string): ErrorReply {
  return {
    status,
    body: {
      error: { code, message: message ?? STATUS_MESSAGES[status] ?? "서버에서 문제가 생겼어요" },
    },
  };
}

/** Errors the core raises carry their own status; anything else is a 500 that hides internals. */
export function toErrorReply(err: unknown): ErrorReply {
  if (err instanceof InvalidInputError)
    return {
      status: 400,
      body: { error: { code: err.code, message: err.message, issues: err.issues } },
    };
  if (err instanceof NoModelError)
    return {
      status: 409,
      body: { error: { code: err.code, message: err.message, reason: err.reason } },
    };
  if (err instanceof TerrariumError) return errorReply(err.status, err.code, err.message);
  return errorReply(
    500,
    "internal",
    "서버에서 문제가 생겼어요. 같은 일이 반복되면 관리자에게 알려 주세요",
  );
}

export function isApiError(value: unknown): value is ApiError {
  const e = (value as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  return typeof e?.code === "string" && typeof e.message === "string";
}
