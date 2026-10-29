/** What every service of the platform shares, and small rules they all apply. */
import type { TelemetryPort } from "@terrarium/core/analysis";
import type { Catalog } from "@terrarium/core/catalog";
import { ForbiddenError } from "@terrarium/core/contract";
import type { ExperimentStore, HarnessPort } from "@terrarium/core/experiments";
import { NotFoundError, withJosa } from "@terrarium/core/kernel";
import type { SourceEntry } from "../adapters";
import type { EventBus } from "./events";
import type { SessionHost } from "./hosts";
import type { Stamps } from "./ids";

/** Who is asking (REQ-033): from the SSO proxy header, a name the person typed, or nobody. */
export interface Viewer {
  readonly name: string;
  readonly source: "proxy" | "self" | "anonymous";
}

export const ANONYMOUS: Viewer = { name: "anonymous", source: "anonymous" };

export interface PlatformContext {
  readonly store: ExperimentStore;
  readonly catalog: Catalog;
  readonly harnesses: ReadonlyMap<string, HarnessPort>;
  readonly sources: ReadonlyMap<string, SourceEntry>;
  readonly telemetry?: { readonly port: TelemetryPort; readonly name: string };
  readonly host: SessionHost;
  readonly stamps: Stamps;
  readonly events: EventBus;
}

export function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new NotFoundError(`${withJosa(what, "을")} 찾을 수 없다`);
  return value;
}

/** Changing or removing something is for whoever made it; looking and forking are for everyone. */
export function ownerOnly(viewer: Viewer, owner: string, action: string): void {
  if (viewer.name !== owner)
    throw new ForbiddenError(`${withJosa(action, "은")} 만든 사람(${owner})만 할 수 있다`);
}
