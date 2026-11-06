/**
 * "연결 확인" (ADR-0119 item 3): read the model list; if that fails, one very short completion (`max_tokens: 1`) to
 * be sure. What comes back is a fact the screen can print: how long it took, how many models, or why not.
 * The clock is handed in (core reads no wall clock).
 */

import { failureText } from "./http";
import { type LlmClient, LlmError, type LlmFailReason } from "./types";

export interface LlmCheck {
  readonly ok: boolean;
  /** Milliseconds the whole check took. */
  readonly ms: number;
  /** What answered: the model list, or the one-token completion. */
  readonly via?: "models" | "completion";
  /** Models the list offered (at most `MAX_LISTED`); empty when it was the completion that answered. */
  readonly models: readonly string[];
  readonly modelCount?: number;
  readonly reason?: LlmFailReason;
  readonly error?: string;
}

export const MAX_LISTED = 200;

/** Failures a second, different request cannot get past: the address is not reachable at all. */
const FINAL: readonly LlmFailReason[] = ["network", "timeout"];

const asFailure = (err: unknown): LlmError =>
  err instanceof LlmError ? err : new LlmError("other", failureText("other"));

export async function checkLlm(
  client: LlmClient,
  options: { readonly model?: string; readonly now: () => number },
): Promise<LlmCheck> {
  const start = options.now();
  const took = () => Math.max(0, options.now() - start);
  let first: LlmError;
  try {
    const names = await client.listModels();
    return {
      ok: true,
      ms: took(),
      via: "models",
      models: names.slice(0, MAX_LISTED),
      modelCount: names.length,
    };
  } catch (err) {
    first = asFailure(err);
  }
  const fail = (e: LlmError): LlmCheck => ({
    ok: false,
    ms: took(),
    models: [],
    reason: e.reason,
    error: e.message,
  });
  // an address that does not resolve is not helped by a second request either
  if (
    !options.model ||
    FINAL.includes(first.reason) ||
    (first.reason === "address" && first.status === undefined)
  )
    return fail(first);
  try {
    await client.complete({
      model: options.model,
      messages: [{ role: "user", content: "." }],
      maxTokens: 1,
    });
    return { ok: true, ms: took(), via: "completion", models: [] };
  } catch (err) {
    return fail(asFailure(err));
  }
}
