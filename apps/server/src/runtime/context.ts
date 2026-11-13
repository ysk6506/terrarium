/** What every service of the platform shares, and small rules they all apply. */
import type { TelemetryAdapter, TelemetryPort } from "@terrarium/core/analysis";
import type { Catalog } from "@terrarium/core/catalog";
import type { ExperimentStore, HarnessPort, Scope } from "@terrarium/core/experiments";
import { NotFoundError, withJosa } from "@terrarium/core/kernel";
import type { EventBus, RunLogs } from "./events";
import type { SessionHost } from "./hosts";
import type { Stamps } from "./ids";

export type Role = "user" | "admin";

/**
 * Who is asking (REQ-033, ADR-0044, ADR-0174). `id` is the stable login that ownership is compared by (a
 * method that knows one puts it here, never a display name that can change); `name` is for showing, and is
 * the id when nobody gave another. `groups` are what the SSO says. Every signed-in person has the role
 * `user`; `admin` is added from the settings.
 */
export interface Viewer {
  readonly id: string;
  readonly name: string;
  readonly groups: readonly string[];
  readonly roles: readonly Role[];
  readonly source: "proxy" | "sso" | "self" | "anonymous";
}

/**
 * Nobody named themselves, in the self-declared mode that is for one person developing locally: such a
 * request is let through as one shared "anonymous" user, as it always was. Only that mode makes it; behind
 * the proxy a request with no login never gets this far.
 */
export const ANONYMOUS: Viewer = {
  id: "anonymous",
  name: "anonymous",
  groups: [],
  roles: ["user"],
  source: "anonymous",
};

/** The viewer of a route that is open to everyone with its address (share links): no one, no roles. */
export const NOBODY: Viewer = { ...ANONYMOUS, roles: [] };

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
  /** Who made it and who can see it (ADR-0174); a connection of the config file has no owner and is for everyone signed in. A plain map has none. */
  standingOf?(
    id: string,
  ): { readonly owner?: string; readonly scope?: Scope; readonly group?: string } | undefined;
}

export interface PlatformContext {
  readonly store: ExperimentStore;
  readonly catalog: Catalog;
  readonly harnesses: HarnessDirectory;
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
