/**
 * A telemetry kind knows one tool that harness traces pile up in (REQ-079, ADR-0085). Like a connector, it
 * describes itself (`spec`, which the connection form draws from), checks what was typed (`schema`) and
 * builds the adapter (`create`). A new tool is one more kind.
 */

import type { TelemetryAdapter } from "@terrarium/core/analysis";
import type { TelemetryAdapterSpec } from "@terrarium/core/contract";
import type { z } from "zod";
import type { ConnectContext } from "../connectors/types";

export interface TelemetryKind<S extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly spec: TelemetryAdapterSpec;
  /** The settings in one flat object: `kind`, then the tool's own. */
  readonly schema: S;
  create(config: z.output<S>, ctx: ConnectContext): TelemetryAdapter;
}

/** Erases the settings type so kinds of different tools fit in one list. */
export function defineTelemetry<S extends z.ZodTypeAny>(kind: TelemetryKind<S>): TelemetryKind {
  return kind as unknown as TelemetryKind;
}
