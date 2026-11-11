/**
 * The physics engine: one fixed-size step advances time and updates power, batteries, heat,
 * protections (breaker trips, thermal shutdowns), alarms and health, in that order. Every
 * discrete consequence is a world event with cause "physics" (REQ-005, ADR-0006).
 */
import type { ServerModel } from "@terrarium/core/catalog";
import { InvalidValueError } from "@terrarium/core/kernel";
import type {
  Entity,
  EntityState,
  Health,
  StateOf,
  World,
  WorldEvent,
} from "@terrarium/core/world";
import { updateAccel } from "./accel";
import { desiredAlarms } from "./alarms";
import { updateApp } from "./app";
import { updateDb } from "./db";
import { updateDbx } from "./dbx";
import { updateDrs } from "./drs";
import { updateFacility, updateSubstations } from "./facility-ext";
import { advanceFirmware } from "./firmware";
import { updateK8s } from "./k8s";
import { breakerStep, tripSeconds } from "./models";
import { updateHostOs } from "./os-physics";
import { updateGenerators, updatePlant } from "./plant";
import {
  aggregateLoads,
  type Pass,
  passOf,
  SupplyResolver,
  updateBatteries,
  updateDevices,
} from "./power";
import { updateSdn } from "./sdn";
import { updateServices } from "./services";
import { updateSite } from "./site";
import { updateThermal } from "./thermal";

export interface PhysicsOptions {
  /** Size of one simulation step in seconds. */
  readonly stepSeconds: number;
  /** A breaker trips when its load exceeds capacity by this factor; left out, the world's physics profile says (default 1.05). */
  readonly tripFactor?: number;
}

export const DEFAULT_PHYSICS: PhysicsOptions = { stepSeconds: 10 };

const CAUSE = "physics";
const RANK: Record<Health, number> = { ok: 0, warning: 1, critical: 2 };
const HEALTHS: readonly Health[] = ["ok", "warning", "critical"];

export class Physics {
  constructor(
    private readonly world: World,
    private readonly options: PhysicsOptions = DEFAULT_PHYSICS,
  ) {
    if (!(options.stepSeconds > 0)) throw new InvalidValueError("stepSeconds must be > 0");
  }

  /** Settle the electrical state at the current time without moving the clock (used at start). */
  settle(): WorldEvent[] {
    return this.compute(0);
  }

  step(dt: number = this.options.stepSeconds): WorldEvent[] {
    this.world.advance(dt);
    return this.compute(dt);
  }

  /** Advance `seconds` in whole steps plus one partial step for the remainder. */
  run(seconds: number): WorldEvent[] {
    const events: WorldEvent[] = [];
    let left = seconds;
    while (left > 1e-9) {
      const dt = Math.min(this.options.stepSeconds, left);
      events.push(...this.step(dt));
      left -= dt;
    }
    return events;
  }

  private compute(dt: number): WorldEvent[] {
    const events: WorldEvent[] = advanceFirmware(this.world);
    events.push(...updateSubstations(this.world, dt));
    updateGenerators(this.world, new SupplyResolver(this.world), dt);
    this.updateElectrical();
    updateBatteries(this.world, dt);
    updateThermal(this.world, dt);
    updatePlant(this.world, dt);
    events.push(...updateFacility(this.world, dt));
    events.push(...this.protect(dt));
    if (events.length > 0) this.updateElectrical();
    events.push(...updateHostOs(this.world, dt));
    events.push(...updateDb(this.world, dt));
    events.push(...updateDrs(this.world));
    events.push(...updateK8s(this.world));
    events.push(...updateSdn(this.world));
    events.push(...updateApp(this.world));
    events.push(...updateSite(this.world, dt));
    events.push(...updateDbx(this.world));
    events.push(...updateAccel(this.world, dt));
    updateServices(this.world, dt);
    events.push(...this.syncAlarms());
    this.updateHealth();
    return events;
  }

  private updateElectrical(): void {
    const supply = new SupplyResolver(this.world);
    updateDevices(this.world, supply);
    aggregateLoads(this.world, supply);
  }

  private protect(dt: number): WorldEvent[] {
    const events: WorldEvent[] = [];
    const pass = passOf(this.world);
    this.tripBreakers(pass, dt, events);
    for (const i of pass.plan.servers) {
      const state = pass.states[i] as StateOf<"server">;
      const model = pass.plan.models[i] as ServerModel;
      if (state.adminOn && state.powered && state.cpuC > model.cpuShutdownC) {
        const target = (pass.plan.ents[i] as Entity).id;
        events.push(this.world.apply({ type: "thermal.shutdown", target }, CAUSE));
      }
    }
    return events;
  }

  /**
   * A breaker trips when its load is past what it can carry (by the trip factor, on that very step). With a trip curve in
   * the world's physics profile it holds on for the seconds the curve gives for the overload, then trips (REQ-113).
   */
  private tripBreakers(pass: Pass, dt: number, events: WorldEvent[]): void {
    const now = this.world.time();
    const { physics } = this.world;
    const factor = this.options.tripFactor ?? physics.base("power.protection").tripFactor;
    const plain =
      physics.curve("power.protection.tripTimeCurve") === undefined &&
      !physics.isScoped("power.protection");
    for (const group of [pass.plan.pdus, pass.plan.panels]) {
      for (const i of group) {
        const state = pass.states[i] as StateOf<"pdu"> | StateOf<"power_panel">;
        const capacity = pass.plan.capacity[i] as number;
        if (state.tripped) continue;
        const target = (pass.plan.ents[i] as Entity).id;
        const trips = plain
          ? state.loadW > capacity * factor
          : this.overloaded(state, { capacity, target, dt });
        if (!trips) continue;
        const fault = {
          id: `trip-${target}-${Math.round(now)}`,
          type: "breaker_trip" as const,
          target,
          params: {},
        };
        events.push(this.world.apply({ type: "fault.add", fault }, CAUSE));
      }
    }
  }

  /** Whether a breaker trips now: past its factor, or, with a trip curve, out of the time the curve allows. */
  private overloaded(
    state: StateOf<"pdu"> | StateOf<"power_panel">,
    at: { capacity: number; target: string; dt: number },
  ): boolean {
    const P = this.world.physicsAt("power.protection", at.target);
    const ratio = at.capacity > 0 ? state.loadW / at.capacity : state.loadW > 0 ? Infinity : 0;
    const seconds = tripSeconds(this.world, ratio);
    if (seconds === undefined)
      return state.loadW > at.capacity * (this.options.tripFactor ?? P.tripFactor);
    const step = breakerStep(state.overload ?? 0, {
      ratio,
      dt: at.dt,
      seconds,
      coolS: P.breakerCoolS,
    });
    if (step.trips || step.heat <= 0) delete state.overload;
    else state.overload = step.heat;
    return step.trips;
  }

  private syncAlarms(): WorldEvent[] {
    const events: WorldEvent[] = [];
    const desired = new Map(desiredAlarms(this.world).map((d) => [`${d.code}:${d.entityId}`, d]));
    // An alarm keeps the message it was raised with; it ends when the condition ends or changes severity.
    const raised = this.world.alarms();
    const kept = new Set<string>();
    for (const alarm of raised) {
      const next = desired.get(alarm.id);
      if (!next || next.severity !== alarm.severity) {
        events.push(this.world.apply({ type: "alarm.clear", alarmId: alarm.id }, CAUSE));
      } else kept.add(alarm.id);
    }
    for (const [id, draft] of desired) {
      if (!kept.has(id))
        events.push(
          this.world.apply(
            { type: "alarm.raise", alarm: { ...draft, id, since: this.world.time() } },
            CAUSE,
          ),
        );
    }
    return events;
  }

  private updateHealth(): void {
    const { plan, states } = passOf(this.world);
    const worst = new Uint8Array(plan.ents.length);
    for (const alarm of this.world.alarms()) {
      const at = this.world.index.positionOf(alarm.entityId);
      if (at !== undefined && RANK[alarm.severity] > (worst[at] as number))
        worst[at] = RANK[alarm.severity];
    }
    for (let i = 0; i < states.length; i++) {
      const state = states[i] as EntityState;
      const health = HEALTHS[worst[i] as number] as Health;
      if (state.health !== health) state.health = health;
    }
  }
}
