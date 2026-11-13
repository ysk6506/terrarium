/**
 * The shell engine of the simulated machines, outside the core (ADR-0196, ADR-0200): a real shell and a real awk,
 * compiled to WebAssembly and run in worker threads. The side that opens a session plugs it into `SessionConfig`.
 */
import type { ShellEngine } from "@terrarium/core/world";
import { WasmShellEngine, type WasmShellOptions } from "./engine";

export { WasmShellEngine, type WasmShellOptions } from "./engine";

/** The engines a server can be configured with: the old shell is no engine (nothing is plugged in). */
export type ShellEngineKind = "legacy" | "wasm";

/** The engine for a configured kind; `legacy` is no engine at all, so the session keeps the old shell. */
export function shellEngineOf(
  kind: ShellEngineKind,
  options?: WasmShellOptions,
): ShellEngine | undefined {
  return kind === "wasm" ? new WasmShellEngine(options) : undefined;
}
