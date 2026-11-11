/**
 * A physics profile made ready for the engine (REQ-113): every slot's numbers filled in (the profile's value, else the v1
 * default), the tables and the weather kept, and the numbers that apply to one place only found by id. Everything here is a
 * pure function of the profile: the same profile gives the same answers on any machine, in any order.
 */

import { InvalidValueError } from "@terrarium/core/kernel";
import { interpolate } from "./curve";
import {
  canonicalProfile,
  DEFAULT_FINGERPRINT,
  fingerprintOf,
  type PhysicsProfile,
  profileProblems,
  type ScopedParam,
} from "./profile";
import { defaultsOf, SLOTS, type SlotValues, splitName } from "./registry";
import { type Point, SCOPE_RANK, type SlotId } from "./types";

type Values = Record<string, number>;

export class ResolvedPhysics {
  readonly fingerprint: string;
  private readonly bases = new Map<SlotId, Values>();
  private readonly tables = new Map<string, readonly Point[]>();
  private readonly scoped = new Map<SlotId, ScopedParam[]>();
  private readonly cache = new Map<string, Values>();
  private readonly weather: readonly Point[] | undefined;
  private readonly humidity: readonly Point[] | undefined;
  private readonly period: number | undefined;
  private readonly origin: number;

  constructor(profile: PhysicsProfile) {
    const canon = canonicalProfile(profile);
    this.fingerprint = fingerprintOf(canon);
    for (const slot of Object.keys(SLOTS) as SlotId[])
      this.bases.set(slot, { ...(defaultsOf(slot) as Values) });
    for (const [full, value] of Object.entries(canon.params ?? {})) {
      const at = splitName(full) as { slot: SlotId; name: string };
      (this.bases.get(at.slot) as Values)[at.name] = value;
    }
    for (const s of canon.scoped ?? []) {
      const at = splitName(s.param) as { slot: SlotId; name: string };
      this.scoped.set(at.slot, [...(this.scoped.get(at.slot) ?? []), s]);
    }
    for (const [name, points] of Object.entries(canon.curves ?? {})) this.tables.set(name, points);
    const rows = canon.weather?.rows ?? [];
    this.period = canon.weather?.repeatS;
    this.origin = rows[0]?.timeS ?? 0;
    this.weather = tableOf(
      rows.map((r) => [r.timeS, r.outdoorC] as const),
      this.period,
      this.origin,
    );
    this.humidity = humidityTable(rows, this.period, this.origin);
  }

  /** The numbers of a slot as the profile leaves them for the whole world. */
  base<S extends SlotId>(slot: S): SlotValues[S] {
    return this.bases.get(slot) as unknown as SlotValues[S];
  }

  /** Whether some number of the slot is changed for one place only (the engine then asks with the place's ids). */
  isScoped(slot: SlotId): boolean {
    return this.scoped.has(slot);
  }

  /** The numbers of a slot for a place: `ids` are the place's own id, its model and the buildings and rooms around it. */
  at<S extends SlotId>(slot: S, ids: readonly string[]): SlotValues[S] {
    const list = this.scoped.get(slot);
    if (!list) return this.base(slot);
    const key = `${slot}|${ids.join("\u0001")}`;
    let found = this.cache.get(key);
    if (!found) {
      found = { ...(this.bases.get(slot) as Values) };
      const hits = list
        .filter((s) => ids.includes(s.scope.id))
        .sort((a, b) => SCOPE_RANK[a.scope.kind] - SCOPE_RANK[b.scope.kind]);
      for (const s of hits) found[(splitName(s.param) as { name: string }).name] = s.value;
      this.cache.set(key, found);
    }
    return found as unknown as SlotValues[S];
  }

  /** The table `slot.curve` the profile gave, or undefined while the slot uses its formula. */
  curve(full: string): readonly Point[] | undefined {
    return this.tables.get(full);
  }

  /** The outdoor air at a world time from the weather table, or undefined without one. */
  outdoorAt(t: number): number | undefined {
    return this.weather && interpolate(this.weather, this.wrap(t));
  }

  /** The outdoor air when nothing else says: the weather table at `t`, else the default of the weather slot. */
  outdoorOrDefault(t: number): number {
    return this.outdoorAt(t) ?? this.base("env.weather").defaultOutdoorC;
  }

  humidityAt(t: number): number | undefined {
    return this.humidity && interpolate(this.humidity, this.wrap(t));
  }

  private wrap(t: number): number {
    const p = this.period;
    return p === undefined ? t : this.origin + ((((t - this.origin) % p) + p) % p);
  }
}

function tableOf(
  points: ReadonlyArray<readonly [number, number]>,
  period: number | undefined,
  origin: number,
): readonly Point[] | undefined {
  if (points.length === 0) return undefined;
  const first = points[0] as Point;
  return period === undefined ? points : [...points, [origin + period, first[1]]];
}

function humidityTable(
  rows: ReadonlyArray<{ timeS: number; humidityPct?: number }>,
  period: number | undefined,
  origin: number,
): readonly Point[] | undefined {
  const wet = rows.filter((r) => r.humidityPct !== undefined);
  if (rows.length === 0 || wet.length !== rows.length) return undefined;
  return tableOf(
    wet.map((r) => [r.timeS, r.humidityPct as number] as const),
    period,
    origin,
  );
}

const DEFAULT_RESOLVED = new ResolvedPhysics({ base: "v1" });
const known = new Map<string, ResolvedPhysics>();

/** The ready physics of a profile; a profile that is not valid is refused with every problem listed. The default physics is shared. */
export function resolveProfile(profile: PhysicsProfile | undefined): ResolvedPhysics {
  if (!profile) return DEFAULT_RESOLVED;
  const problems = profileProblems(profile);
  if (problems.length > 0)
    throw new InvalidValueError(`물리 프로필을 쓸 수 없어요: ${problems.join("; ")}`);
  const print = fingerprintOf(profile);
  if (print === DEFAULT_FINGERPRINT) return DEFAULT_RESOLVED;
  let found = known.get(print);
  if (!found) {
    found = new ResolvedPhysics(profile);
    known.set(print, found);
  }
  return found;
}

export const DEFAULT_PHYSICS_PROFILE_RESOLVED = DEFAULT_RESOLVED;
