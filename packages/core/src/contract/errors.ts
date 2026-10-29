/**
 * Every failed request answers with the same body: a code a program can branch on, a Korean message
 * a person can act on, and, for invalid input, which field is wrong.
 */
import { TerrariumError } from "@terrarium/core/kernel";
import type { ApiIssue } from "./korean";

export interface ApiError {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly issues?: readonly ApiIssue[];
  };
}

export interface ErrorReply {
  readonly status: number;
  readonly body: ApiError;
}

const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  400: "요청이 올바르지 않다",
  403: "이 작업은 할 수 없다",
  404: "찾을 수 없다",
  409: "그사이 다른 변경이 있었다. 새로고침한 뒤 다시 시도한다",
  413: "요청이 너무 크다",
  422: "지원하지 않는 작업이다",
  429: "요청이 너무 많다. 잠시 뒤 다시 시도한다",
  503: "연결된 서비스에 닿을 수 없다",
};

export function invalidInput(
  issues: readonly ApiIssue[],
  message = "입력값을 확인한다",
): ErrorReply {
  return { status: 400, body: { error: { code: "invalid_input", message, issues } } };
}

export function errorReply(status: number, code: string, message?: string): ErrorReply {
  return {
    status,
    body: {
      error: { code, message: message ?? STATUS_MESSAGES[status] ?? "서버에서 문제가 생겼다" },
    },
  };
}

/** Errors the core raises carry their own status; anything else is a 500 that hides internals. */
export function toErrorReply(err: unknown): ErrorReply {
  if (err instanceof TerrariumError) return errorReply(err.status, err.code, err.message);
  return errorReply(
    500,
    "internal",
    "서버에서 문제가 생겼다. 같은 일이 반복되면 관리자에게 알린다",
  );
}

export function isApiError(value: unknown): value is ApiError {
  const e = (value as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  return typeof e?.code === "string" && typeof e.message === "string";
}
