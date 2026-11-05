/**
 * "말 걸어 보기" (REQ-051, REQ-079, ADR-0085): one question to one agent of a connection, with no tools, no
 * world and nothing scored, then a look at whether the turn's traces reached the tool the connection names.
 * A failure is told as it came (the status and what the other side said), not as "연결 실패".
 */

import type { TelemetryAdapter } from "@terrarium/core/analysis";
import { traceIdOf } from "@terrarium/core/analysis";
import type { TryConnectionRequest, TryResult } from "@terrarium/core/contract";
import type { HarnessPort, TelemetryAttachment } from "@terrarium/core/experiments";
import { messageOf } from "./connection-form";

export interface TryOptions {
  /** The longest a turn may take, ms (60 seconds). */
  readonly limitMs?: number;
  /** How many times to look for the traces, and how long to wait between looks, ms. Tools take a few seconds to show them. */
  readonly looks?: number;
  readonly lookGapMs?: number;
}

const LIMIT_MS = 60_000;
const LOOKS = 4;
const LOOK_GAP_MS = 1500;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What a status means to a person who typed a token and an address. */
const STATUS_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(401|403)$/, "토큰이 거절됐어요"],
  [/^404$/, "주소나 에이전트 이름이 맞는지 봐 주세요"],
  [/^429$/, "요청이 너무 많다고 해요"],
  [/^5\d\d$/, "상대 서버가 오류로 답했어요"],
];

/** "401 — 토큰이 거절됐어요" for a failure that has a status, with what the other side said; the words as they came otherwise. */
export function explainFailure(err: unknown, limitMs: number): string {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"))
    return `${Math.round(limitMs / 1000)}초 안에 답이 없어요`;
  const message = messageOf(err);
  const code = /(\d{3})로 답했어요/.exec(message)?.[1];
  const words = code ? STATUS_WORDS.find(([re]) => re.test(code))?.[1] : undefined;
  return code && words ? `${code} — ${words}. 받은 말: ${message}` : message;
}

async function lookForTraces(
  adapter: TelemetryAdapter | undefined,
  runId: string,
  attachment: TelemetryAttachment | undefined,
  options: TryOptions,
): Promise<TryResult["trace"]> {
  if (!adapter) return { spans: 0 };
  const hint = { traceId: traceIdOf(attachment?.traceparent) };
  for (let look = 0; look < (options.looks ?? LOOKS); look++) {
    if (look > 0) await pause(options.lookGapMs ?? LOOK_GAP_MS);
    try {
      const found = await adapter.fetch(runId, hint.traceId ? hint : undefined);
      if (found.spans.length > 0)
        return { name: adapter.name, linked: true, spans: found.spans.length };
    } catch (err) {
      return {
        name: adapter.name,
        spans: 0,
        note: `${adapter.name}에서 읽지 못했어요: ${messageOf(err)}`,
      };
    }
  }
  return {
    name: adapter.name,
    linked: false,
    spans: 0,
    note: "run_id 태그가 안 보여요. 하네스가 traceparent나 run_id를 스팬에 남기는지 봐 주세요. 몇 초 늦게 쌓이는 곳이면 잠시 뒤 다시 말을 걸어 보세요.",
  };
}

export async function tryTalk(
  port: HarnessPort,
  adapter: TelemetryAdapter | undefined,
  input: TryConnectionRequest,
  runId: string,
  options: TryOptions = {},
): Promise<TryResult> {
  const limitMs = options.limitMs ?? LIMIT_MS;
  const none = { ...(adapter ? { name: adapter.name } : {}), spans: 0 };
  if (!port.talk)
    return {
      ok: false,
      error: "이 연결 방식은 아직 말 걸어 보기를 못 해요",
      ms: 0,
      toolCalls: 0,
      trace: none,
    };
  const attachment = adapter?.attach({ runId });
  const started = Date.now();
  try {
    const reply = await port.talk({
      runId,
      agentId: input.agentId,
      text: input.text,
      signal: AbortSignal.timeout(limitMs),
      ...(attachment ? { telemetry: attachment } : {}),
    });
    const ms = Date.now() - started;
    return {
      ok: true,
      text: reply.text,
      ms,
      ...(reply.model ? { model: reply.model } : {}),
      ...(reply.inputTokens === undefined && reply.outputTokens === undefined
        ? {}
        : { tokens: { input: reply.inputTokens ?? 0, output: reply.outputTokens ?? 0 } }),
      toolCalls: reply.toolCalls,
      trace: await lookForTraces(adapter, runId, attachment, options),
    };
  } catch (err) {
    return {
      ok: false,
      error: explainFailure(err, limitMs),
      ms: Date.now() - started,
      toolCalls: 0,
      trace: adapter ? { ...none, note: "답을 받지 못해서 트레이스는 보지 않았어요" } : none,
    };
  }
}
