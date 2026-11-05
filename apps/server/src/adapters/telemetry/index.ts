/** Every telemetry kind the server knows, in the order the form offers them. A new tool is one more line. */
import { clickStackKind } from "./clickstack-kind";
import { langfuseKind } from "./langfuse";
import type { TelemetryKind } from "./types";

export const TELEMETRY_KINDS: readonly TelemetryKind[] = [clickStackKind, langfuseKind];

export function telemetryKindOf(kind: string): TelemetryKind | undefined {
  return TELEMETRY_KINDS.find((k) => k.spec.kind === kind);
}

export { attachmentFor } from "./attach";
export { ClickStackAdapter, ClickStackTelemetry } from "./clickstack";
export { adapterOfPort } from "./port-adapter";
export type { TelemetryKind } from "./types";
