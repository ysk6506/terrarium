/**
 * The law monitor (REQ-113, ADR-0137, docs/design-docs/physics-laws.md): watches a world step by step and collects every
 * violation of the physics laws (`laws-checks.ts`). The default physics (v1) is held to the same laws as any profile; a
 * violation v1 has is a finding, listed in `KNOWN_V1_EXCEPTIONS` with the reason, to be fixed in v2 (not silently, since that
 * would move the recorded numbers of `tests/spec/physics-golden.test.ts`).
 *
 * Use:  const monitor = new LawMonitor(world);  physics.step(dt); monitor.observe(dt);  ...  monitor.report().
 */
import type { World } from "@terrarium/core/world";
import {
  type BatteryWas,
  bbuViolations,
  chainViolations,
  conversionViolations,
  deviceViolations,
  directionViolations,
  formatViolations,
  type LawId,
  rangeViolations,
  roomViolations,
  upsViolations,
  type Violation,
} from "./laws-checks";
import { collectRoomSteps, type RoomStep } from "./thermal";

export type { LawId, Violation };

/** A violation the default physics (v1) is known to have: the law, which part of the world, and why it is allowed until v2. */
export interface KnownException {
  readonly law: LawId;
  /** Matches the entity id of the violation when it contains this text; empty matches any. */
  readonly where: string;
  readonly reason: string;
}

/** What v1 is known to break. Each entry is a finding of REQ-113 (see docs/design-docs/physics-laws.md), to be fixed in the v2 physics. */
export const KNOWN_V1_EXCEPTIONS: readonly KnownException[] = [];

export interface LawReport {
  readonly steps: number;
  readonly violations: readonly Violation[];
  /** Violations v1 is known to have (see `KNOWN_V1_EXCEPTIONS`); the rest are failures. */
  readonly known: readonly Violation[];
  readonly failures: readonly Violation[];
}

const isKnown = (v: Violation): boolean =>
  KNOWN_V1_EXCEPTIONS.some((k) => k.law === v.law && v.where.includes(k.where));

/** How often (in steps) the checks that read the whole world run; the room balance runs on every step. */
const WIDE_EVERY = 30;
/** The power chain is a sum over a lagged state (the cooling units' work is read one step before it is updated). */
const CHAIN_TOLERANCE = 5e-3;
const MAX_KEPT = 200;

export class LawMonitor {
  private readonly rooms: RoomStep[] = [];
  private readonly found: Violation[] = [];
  private readonly ups = new Map<string, BatteryWas>();
  private readonly bbu = new Map<string, BatteryWas>();
  private count = 0;

  constructor(private readonly world: World) {
    collectRoomSteps(world, this.rooms);
    this.remember();
    this.keep(directionViolations(world));
    this.keep(conversionViolations(world));
  }

  /** Check the step that was just taken (`dt` seconds). */
  observe(dt: number): void {
    const { world } = this;
    this.count++;
    this.keep(roomViolations(this.rooms, world.time()));
    this.rooms.length = 0;
    for (const [id, was] of this.ups) this.keep(upsViolations(world, id, was, dt));
    for (const [id, was] of this.bbu) this.keep(bbuViolations(world, id, was, dt));
    if (this.count % WIDE_EVERY === 0) {
      this.keep(formatViolations(world));
      this.keep(rangeViolations(world));
      this.keep(deviceViolations(world));
      this.keep(chainViolations(world, CHAIN_TOLERANCE));
    }
    this.remember();
  }

  /** Stop collecting; the report stays readable. */
  detach(): void {
    collectRoomSteps(this.world, undefined);
  }

  report(): LawReport {
    const known = this.found.filter(isKnown);
    return {
      steps: this.count,
      violations: this.found,
      known,
      failures: this.found.filter((v) => !isKnown(v)),
    };
  }

  private keep(list: readonly Violation[]): void {
    for (const v of list) if (this.found.length < MAX_KEPT) this.found.push(v);
  }

  private remember(): void {
    const { world } = this;
    for (const e of world.index.ofKind("ups")) {
      const s = world.stateAs(e.id, "ups");
      this.ups.set(e.id, { pct: s.batteryPct, loadW: s.loadW });
    }
    for (const e of world.index.ofKind("bbu")) {
      const s = world.stateAs(e.id, "bbu");
      const rack = world.index.outgoing(e.id, "member_of")[0]?.to;
      this.bbu.set(e.id, {
        pct: s.chargePct,
        loadW: rack ? world.stateAs(rack, "rack").powerW : 0,
      });
    }
  }
}
