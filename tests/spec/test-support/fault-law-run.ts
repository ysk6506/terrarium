/** Runs a fault plan (`fault-law-plans.ts`) on a world with the law monitor watching every step (REQ-113, ADR-0142). */
import { Catalog } from "@terrarium/core/catalog";
import { LawMonitor, type LawReport, Physics } from "@terrarium/core/physics";
import { type EntityKind, FAULT_SPECS, type FaultType, World } from "@terrarium/core/world";
import { type Hit, LABS, type LabName, type Plan } from "./fault-law-plans";

const catalog = new Catalog();
const STEP_S = 10;
const WARM_S = 300;

export interface PlanRun {
  readonly report: LawReport;
  /** The faults injected, by id, with the entity each hit. */
  readonly hit: ReadonlyArray<{ readonly type: FaultType; readonly target: string }>;
  /** What the fault did to the world while it was held: the hottest room-side temperature seen is not kept, the consequences are. */
  readonly effects: Effects;
  /** The world at the end of the hold, to compare with the same world run without the fault (`baselineFingerprint`). */
  readonly fingerprint: string;
}

export interface Effects {
  readonly alarms: number;
  readonly serversOff: number;
  readonly breakersTripped: number;
  readonly minBatteryPct: number;
  readonly hottestCpuC: number;
}

/** The entities a hit is for. */
const targets = (world: World, hit: Hit): string[] => {
  const all = hit.via
    ? world.index
        .ofKind(hit.via)
        .map(
          (e) =>
            world.index
              .outgoing(e.id, "member_of")
              .find((l) => world.index.find(l.to)?.kind === hit.kind)?.to,
        )
        .filter((id): id is string => id !== undefined)
    : world.index.ofKind(hit.kind as EntityKind).map((e) => e.id);
  const chosen = hit.all ? all : all.slice(hit.nth ?? 0, (hit.nth ?? 0) + 1);
  if (chosen.length === 0) throw new Error(`no ${hit.kind} in the world for ${hit.type}`);
  return chosen;
};

/** The state of the world at one moment, as far as the consequences of a fault go. */
function effectsOf(world: World): Effects {
  let serversOff = 0;
  let breakersTripped = 0;
  let minBatteryPct = 100;
  let hottestCpuC = 0;
  for (const e of world.index.ofKind("server")) {
    const s = world.stateAs(e.id, "server");
    if (!s.powered) serversOff++;
    hottestCpuC = Math.max(hottestCpuC, s.cpuC);
  }
  for (const k of ["pdu", "power_panel"] as const)
    for (const e of world.index.ofKind(k)) if (world.stateAs(e.id, k).tripped) breakersTripped++;
  for (const e of world.index.ofKind("ups"))
    minBatteryPct = Math.min(minBatteryPct, world.stateAs(e.id, "ups").batteryPct);
  for (const e of world.index.ofKind("bbu"))
    minBatteryPct = Math.min(minBatteryPct, world.stateAs(e.id, "bbu").chargePct);
  return { alarms: world.alarms().length, serversOff, breakersTripped, minBatteryPct, hottestCpuC };
}

const fingerprintOf = (world: World): string =>
  JSON.stringify(world.stateList(), (_k, value) =>
    typeof value === "number" ? Math.round(value * 100) / 100 : value,
  );

const worse = (a: Effects, b: Effects): Effects => ({
  alarms: Math.max(a.alarms, b.alarms),
  serversOff: Math.max(a.serversOff, b.serversOff),
  breakersTripped: Math.max(a.breakersTripped, b.breakersTripped),
  minBatteryPct: Math.min(a.minBatteryPct, b.minBatteryPct),
  hottestCpuC: Math.max(a.hottestCpuC, b.hottestCpuC),
});

/** A busy day: every server is asked for this share of its capacity, so heat and draw are high when the fault comes. */
const BUSY = 0.9;

/** The same world and day with no fault: what the end of the hold looks like when nothing is wrong. */
export function baselineFingerprint(plan: Plan, lab: LabName, severity: Severity): string {
  return runPlan(undefined, { ...plan, recoverS: 0 }, lab, severity).fingerprint;
}

/** How hard the fault is: its own parameters at the default, at the lowest or at the highest the registry allows. */
export type Severity = "default" | "min" | "max";
const HEAT_WAVE_C = 38;

/** The runs of a plan: each world, each severity (a fault with no parameter has just the default). */
export function runsOf(type: FaultType, plan: Plan): Array<{ lab: LabName; severity: Severity }> {
  const withParams = (FAULT_SPECS.find((s) => s.type === type)?.params.length ?? 0) > 0;
  const severities: Severity[] = withParams ? ["default", "min", "max"] : ["default"];
  return plan.labs.flatMap((lab) => severities.map((severity) => ({ lab, severity })));
}

const paramsOf = (
  type: FaultType,
  severity: Severity,
  given?: Readonly<Record<string, number>>,
) => {
  const spec = FAULT_SPECS.find((s) => s.type === type);
  const out: Record<string, number> = { ...given };
  if (severity !== "default")
    for (const q of spec?.params ?? []) out[q.name] = severity === "min" ? q.min : q.max;
  return out;
};

/** Warm the world, inject the fault (and what comes with it), hold, remove everything, let it recover; every step is checked. */
export function runPlan(
  type: FaultType | undefined,
  plan: Plan,
  lab: LabName,
  severity: Severity,
): PlanRun {
  const world = World.fromBlueprint(LABS[lab](), catalog);
  const physics = new Physics(world);
  physics.settle();
  for (const e of world.index.ofKind("server"))
    world.apply({ type: "load.set", target: e.id, value: BUSY }, "scenario");
  if (severity !== "default")
    world.apply({ type: "outdoor.set", celsius: HEAT_WAVE_C }, "scenario");
  physics.run(WARM_S);
  const monitor = new LawMonitor(world, type);
  const hits = type ? plan.hits : [];
  const ids: string[] = [];
  const hit: Array<{ type: FaultType; target: string }> = [];
  for (const h of hits)
    for (const at of targets(world, h)) {
      const id = `law-${h.type}-${ids.length}`;
      world.apply(
        {
          type: "fault.add",
          fault: {
            id,
            type: h.type,
            target: at,
            params: paramsOf(h.type, h === plan.hits[0] ? severity : "default", h.params),
          },
        },
        "scenario",
      );
      ids.push(id);
      hit.push({ type: h.type, target: at });
    }
  let effects = effectsOf(world);
  const run = (seconds: number, watch: boolean) => {
    for (let t = 0; t < seconds; t += STEP_S) {
      physics.step(STEP_S);
      monitor.observe(STEP_S);
      if (watch && (t / STEP_S) % 6 === 0) effects = worse(effects, effectsOf(world));
    }
  };
  run(plan.holdS, true);
  const fingerprint = fingerprintOf(world);
  for (const id of ids) world.apply({ type: "fault.remove", faultId: id }, "scenario");
  run(plan.recoverS, false);
  monitor.detach();
  return { report: monitor.report(), hit, effects, fingerprint };
}
