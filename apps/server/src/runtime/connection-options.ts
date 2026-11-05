/** What the connections are made of: the harnesses the config file names, and the options the server gives them. */
import type { TelemetryAdapter } from "@terrarium/core/analysis";
import type { ExperimentStore, HarnessPort } from "@terrarium/core/experiments";
import type { ConnectContext, HarnessConfig, SecretBox } from "../adapters";
import type { TryOptions } from "./connection-try";
import type { Stamps } from "./ids";

/** A harness the config file names: built at start, read-only from the screen. */
export interface FixedConnection {
  readonly port: HarnessPort;
  /** What the file says (settings only name environment variables, never hold secrets). */
  readonly config?: HarnessConfig;
}

export interface ConnectionsOptions {
  readonly store: ExperimentStore;
  readonly stamps: Stamps;
  readonly fixed: readonly FixedConnection[];
  readonly connect: ConnectContext;
  /** Seals the tokens, passwords and secret headers people type (ADR-0043). */
  readonly box: SecretBox;
  /**
   * A connection made on the screen that no experiment has used for `days` days is removed, and its owner is
   * told `warnDays` days before (REQ-051). `days: 0` keeps everything. Defaults: 30 and 7.
   */
  readonly retention?: { readonly days?: number; readonly warnDays?: number };
  /** Hosts people may connect to from the screen. Without it, every host but a cloud's metadata address. */
  readonly allowedHosts?: readonly string[];
  /** How long to wait for a harness to list its agents, ms. */
  readonly agentsTimeoutMs?: number;
  /** How long a harness's agent list is kept before asking again, ms. */
  readonly agentsTtlMs?: number;
  readonly slotUrl?: (slot: string) => string; // the fixed tool address of a harness with a slot
  /** How "말 걸어 보기" waits (tests shorten it). */
  readonly tryOptions?: TryOptions;
  /** The server's own telemetry (its config file's `telemetry`): what a connection that says "default" reads from. */
  readonly defaultTelemetry?: TelemetryAdapter;
}
