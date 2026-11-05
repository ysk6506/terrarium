import type { TelemetryAdapter, TelemetryPort } from "@terrarium/core/analysis";
import { NO_TELEMETRY } from "@terrarium/core/analysis";
import { attachmentFor } from "./attach";

/**
 * A plain trace-id reader as an adapter (ADR-0085), for the server's default when only a `TelemetryPort` is
 * at hand. It finds a run by the trace id the run reported and has no other key.
 */
export function adapterOfPort(port: TelemetryPort, name: string): TelemetryAdapter {
  return {
    kind: "clickstack",
    name,
    attach: (run) => attachmentFor(run.runId),
    fetch: async (_runId, hint) => (hint?.traceId ? port.trace(hint.traceId) : NO_TELEMETRY),
  };
}
