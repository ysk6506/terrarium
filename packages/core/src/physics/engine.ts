/**
 * The physics engine: one fixed-size step advances time and updates power, batteries, heat,
 * protections (breaker trips, thermal shutdowns), alarms and health, in that order. Every
 * discrete consequence is a world event with cause "physics" (REQ-005, ADR-0006).
 */
import { InvalidValueError } from "@terrarium/core/kernel";
import type { Health, World, WorldEvent } from "@terrarium/core/world";
import { desiredAlarms } from "./alarms";
import { aggregateLoads, capacityW, SupplyResolver, updateBatteries, updateDevices } from "./power";
import { updateRack, updateRoom } from "./thermal";

export interface PhysicsOptions {
  /** Size of one simulation step in seconds. */
  readonly stepSeconds: number;
  /** A breaker trips when its load exceeds capacity by this factor. */
  readonly tripFactor: number;
}

export const DEFAULT_PHYSICS: PhysicsOptions = { stepSeconds: 10, tripFactor: 1.05 };

const CAUSE = "physics";
const RANK: Record<Health, number> = { ok: 0, warning: 1, critical: 2 };

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
    const events: WorldEvent[] = [];
    this.updateElectrical();
    updateBatteries(this.world, dt);
    for (const room of this.world.index.ofKind("room")) updateRoom(this.world, room, dt);
    for (const rack of this.world.index.ofKind("rack")) updateRack(this.world, rack, dt);
    events.push(...this.protect());
    if (events.length > 0) this.updateElectrical();
    events.push(...this.syncAlarms());
    this.updateHealth();
    return events;
  }

  private updateElectrical(): void {
    const supply = new SupplyResolver(this.world);
    updateDevices(this.world, supply);
    aggregateLoads(this.world, supply);
    // Cooling unit draw depends on its load, which depends on loads above; one more pass settles it.
    aggregateLoads(this.world, new SupplyResolver(this.world));
  }

  private protect(): WorldEvent[] {
    const events: WorldEvent[] = [];
    const now = this.world.time();
    for (const entity of [
      ...this.world.index.ofKind("pdu"),
      ...this.world.index.ofKind("power_panel"),
    ]) {
      const state = this.world.stateOf(entity.id);
      if (
        (state.kind === "pdu" || state.kind === "power_panel") &&
        !state.tripped &&
        state.loadW > capacityW(this.world, entity.id) * this.options.tripFactor
      ) {
        const fault = {
          id: `trip-${entity.id}-${Math.round(now)}`,
          type: "breaker_trip" as const,
          target: entity.id,
          params: {},
        };
        events.push(this.world.apply({ type: "fault.add", fault }, CAUSE));
      }
    }
    for (const server of this.world.index.ofKind("server")) {
      const state = this.world.stateAs(server.id, "server");
      const model = this.world.catalog.getOf(server.modelId ?? "", "server");
      if (state.adminOn && state.powered && state.cpuC > model.cpuShutdownC) {
        events.push(this.world.apply({ type: "thermal.shutdown", target: server.id }, CAUSE));
      }
    }
    return events;
  }

  private syncAlarms(): WorldEvent[] {
    const events: WorldEvent[] = [];
    const desired = new Map(desiredAlarms(this.world).map((d) => [`${d.code}:${d.entityId}`, d]));
    // An alarm keeps the message it was raised with; it ends when the condition ends or changes severity.
    for (const alarm of this.world.alarms()) {
      const next = desired.get(alarm.id);
      if (!next || next.severity !== alarm.severity) {
        events.push(this.world.apply({ type: "alarm.clear", alarmId: alarm.id }, CAUSE));
      }
    }
    const active = new Map(this.world.alarms().map((a) => [a.id, a]));
    for (const [id, draft] of desired) {
      if (!active.has(id))
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
    const worst = new Map<string, Health>();
    for (const alarm of this.world.alarms()) {
      const current = worst.get(alarm.entityId) ?? "ok";
      if (RANK[alarm.severity] > RANK[current]) worst.set(alarm.entityId, alarm.severity);
    }
    for (const entity of this.world.index.all()) {
      const state = this.world.stateOf(entity.id);
      const health = worst.get(entity.id) ?? "ok";
      if (state.health !== health) this.world.patch(entity.id, entity.kind, { health } as never);
    }
  }
}
