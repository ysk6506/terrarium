/** The alarms and the whole state of a world (split from state.ts for size). */
import type { Fault } from "./faults";
import type { NetPatch } from "./net-config";
import type { EntityState } from "./state";

export interface Alarm {
  readonly id: string;
  readonly entityId: string;
  readonly code: string;
  /** Which part of the world raised it when that is not the equipment itself: a service, or a host's operating system. */
  readonly kind?: "service" | "os";
  readonly severity: "warning" | "critical";
  readonly message: string;
  readonly since: number;
}

export interface WorldState {
  t: number;
  entities: Record<string, EntityState>;
  /** `up` follows faults; `adminDown` names the ends an operator has shut (absent while none is). */
  links: Record<string, { up: boolean; adminDown?: { from?: true; to?: true } }>;
  faults: Record<string, Fault>;
  alarms: Record<string, Alarm>;
  /** What operators changed in the layer-2/3 configuration of a switch (REQ-064); absent while nobody has. */
  netconf?: Record<string, NetPatch>;
  /** Outdoor air, °C; absent means the default, so worlds that never change it keep their old snapshots and digests. */
  outdoorC?: number;
}
