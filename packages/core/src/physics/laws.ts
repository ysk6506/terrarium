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
  /** The fault kind the exception belongs to (the law checks on a day with that fault); left out, it is a fault-free case. */
  readonly fault?: string;
  readonly law: LawId;
  /** Matches the entity id of the violation when it contains this text; empty matches any. */
  readonly where: string;
  /** What was measured, with its numbers (kept so a finding can be reproduced and a fix can be judged against it). */
  readonly measured?: string;
  readonly reason: string;
}

/** What v1 is known to break. Each entry is a finding of REQ-113 (see docs/design-docs/physics-laws.md), to be fixed in the v2 physics. */
export const KNOWN_V1_EXCEPTIONS: readonly KnownException[] = [
  {
    fault: "cooling_unit_failure",
    law: "power.chain",
    where: "panel-1",
    measured:
      "sample room, after the cooling units are repaired: panel-1 carries 17219 W while its consumers draw 17069 W (+0.9 %) at t=11400 s; step by step right after the restart 14906 W against 81573 W",
    reason:
      "A cooling unit's draw follows the heat it removed, which is computed after the electrical pass, so while the compressors ramp the panel's load is one step (10 s) behind its consumers",
  },
  {
    fault: "cooling_unit_failure",
    law: "power.chain",
    where: "-sw-",
    measured:
      "campus with plant, after repair: four switchboards carry 163483/147606/253775/236836 W against 158436/143021/251490/234782 W (+3.2 %, +3.2 %, +0.9 %, +0.9 %) at t=11400 s",
    reason:
      "Same cause: the cooling units' draw changes in the thermal part of the step, after the load of every supplier above them was added up",
  },
  {
    fault: "grid_outage",
    law: "power.chain",
    where: "mats1",
    measured:
      "campus with plant, every UPS on battery: the main switchboard carries 99409 W against 98837 W (+0.6 %) at t=2700 s while the chillers' draw drifts from 29705 to 29418 W",
    reason:
      "The chillers' draw is updated by the plant after the supplier loads were summed, so a supplier is one step behind a draw that moves",
  },
  {
    fault: "ups_battery_degraded",
    law: "power.chain",
    where: "panel-1",
    measured:
      "sample room, battery at 5 % capacity, after the grid is back: panel-1 carries 18540 W against 18344 W (+1.1 %) at t=18600 s while the cooling units' draw falls from 7817 to 7719 W",
    reason:
      "Same cause: cooling draw changes after the electrical pass, so the panel lags by one step while the units settle",
  },
  {
    fault: "chiller_failure",
    law: "power.chain",
    where: "mats1",
    measured:
      "campus with plant, after the chillers are repaired: the main switchboard carries 176043 W against 174532 W (+0.9 %) at t=11700 s while the chillers' draw falls from 55130 to 54375 W",
    reason: "Same cause: the plant's draw changes after the supplier loads were summed",
  },
  {
    fault: "coolant_leak",
    law: "power.chain",
    where: "pnl-a1",
    measured:
      "liquid hall, shut-off after 900 s: at t=1200 s the CDU stops (12000 W to 0 W) and its panel still carries 88507 W against 76507 W (+15.7 %)",
    reason:
      "The shut-off of the leak stops the CDU after the electrical pass and raises no event, so the panel is not summed again until the next step",
  },
];

export interface LawReport {
  readonly steps: number;
  readonly violations: readonly Violation[];
  /** Violations v1 is known to have (see `KNOWN_V1_EXCEPTIONS`); the rest are failures. */
  readonly known: readonly Violation[];
  readonly failures: readonly Violation[];
}

const isKnown = (v: Violation, fault: string | undefined): boolean =>
  KNOWN_V1_EXCEPTIONS.some(
    (k) => k.fault === fault && k.law === v.law && v.where.includes(k.where),
  );

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

  /** `fault`: the kind of fault the world is run with; only exceptions listed for it (or none) are known cases. */
  constructor(
    private readonly world: World,
    private readonly fault?: string,
  ) {
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
    const known = this.found.filter((v) => isKnown(v, this.fault));
    return {
      steps: this.count,
      violations: this.found,
      known,
      failures: this.found.filter((v) => !isKnown(v, this.fault)),
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
