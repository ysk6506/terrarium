/** What every service of the platform shares, and small rules they all apply. */
import type { TelemetryAdapter, TelemetryPort } from "@terrarium/core/analysis";
import type { Catalog } from "@terrarium/core/catalog";
import { ForbiddenError } from "@terrarium/core/contract";
import type { ExperimentStore, HarnessPort } from "@terrarium/core/experiments";
import { NotFoundError, withJosa } from "@terrarium/core/kernel";
import type { SourceEntry } from "../adapters";
import type { EventBus, RunLogs } from "./events";
import type { SessionHost } from "./hosts";
import type { Stamps } from "./ids";

/**
 * Who is asking (REQ-033, ADR-0044): from the SSO proxy header, a sign-in the server checked itself
 * (`sso`), a name the person typed, or nobody. `name` is what ownership is compared by, so a method that
 * knows a stable login (an employee id, an email) puts that here, not a display name that can change.
 */
export interface Viewer {
  readonly name: string;
  readonly source: "proxy" | "sso" | "self" | "anonymous";
}

export const ANONYMOUS: Viewer = { name: "anonymous", source: "anonymous" };

/** The harnesses and agents experiments can run on, now. A plain `Map` of ports fits; so does the registry people add to. */
export interface HarnessDirectory {
  get(id: string): HarnessPort | undefined;
  values(): Iterable<HarnessPort>;
  /** What the person who connected it attached (REQ-052). A plain map of ports has none. */
  metadata?(id: string): Readonly<Record<string, string>> | undefined;
  /** An experiment was made on it (a connection nobody uses for a month is removed). A plain map has no clock. */
  touch?(id: string): Promise<void>;
  /** Where the traces of its runs are read from (ADR-0085); a plain map has none. */
  telemetryOf?(id: string): TelemetryAdapter | undefined;
  /** Who made it, when it was made on the screen; a connection of the config file has no owner (REQ-053). */
  ownerOf?(id: string): string | undefined;
}

export interface PlatformContext {
  readonly store: ExperimentStore;
  readonly catalog: Catalog;
  readonly harnesses: HarnessDirectory;
  readonly sources: ReadonlyMap<string, SourceEntry>;
  readonly telemetry?: { readonly port: TelemetryPort; readonly name: string };
  readonly host: SessionHost;
  readonly stamps: Stamps;
  readonly events: EventBus;
  readonly logs: RunLogs;
}

export function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new NotFoundError(`${withJosa(what, "을")} 찾을 수 없어요`);
  return value;
}

/** Changing or removing something is for whoever made it; looking and forking are for everyone. */
export function ownerOnly(viewer: Viewer, owner: string, action: string): void {
  if (viewer.name !== owner)
    throw new ForbiddenError(`${withJosa(action, "은")} 만든 사람(${owner})만 할 수 있어요`);
}
