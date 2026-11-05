/** What every telemetry adapter asks a harness to carry for a run: the trace context and the run's name (ADR-0085). */
import type { TelemetryAttachment } from "@terrarium/core/experiments";
import { randomToken } from "@terrarium/core/kernel";

/** A new W3C `traceparent`: a random trace id and span id, sampled. */
export const newTraceparent = (): string => `00-${randomToken(16)}-${randomToken(8)}-01`;

/**
 * The run's name goes three ways so a harness can pick up whichever it understands: the standard
 * `traceparent` header, a `baggage` entry, and `run_id` as a tag (also called `terrarium.run_id`).
 */
export function attachmentFor(
  runId: string,
  traceparent: string = newTraceparent(),
): TelemetryAttachment {
  return {
    traceparent,
    headers: { traceparent, "x-terrarium-run-id": runId, baggage: `run_id=${runId}` },
    tags: { run_id: runId, "terrarium.run_id": runId },
    sessionId: runId,
  };
}
