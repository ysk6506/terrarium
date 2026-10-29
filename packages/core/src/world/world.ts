/**
 * A running world: blueprint + catalog + dynamic state + an append-only event log (ADR-0006).
 * Discrete changes happen only through `apply(command)`, which validates, records and reduces an
 * event; continuous values (temperatures, loads) are written by physics with `patch`. State is a
 * function of (blueprint, seed, events, time steps), so runs replay and snapshots restore exactly.
 */
import type { Catalog } from "@terrarium/core/catalog";
import {
  ConflictError,
  InvalidValueError,
  NotFoundError,
  ReadOnlyViolationError,
} from "@terrarium/core/kernel";
import type { Blueprint, EntityKind } from "./blueprint";
import { type Fault, faultSpec } from "./faults";
import { BlueprintIndex } from "./graph";
import { type Alarm, type EntityState, initialState, type StateOf, type WorldState } from "./state";
import { hasErrors, validateBlueprint } from "./validate";

export type WorldCommand =
  | { readonly type: "power.set"; readonly target: string; readonly on: boolean }
  | { readonly type: "fault.add"; readonly fault: Omit<Fault, "since"> }
  | { readonly type: "fault.remove"; readonly faultId: string }
  | { readonly type: "load.set"; readonly target: string; readonly value: number }
  | { readonly type: "setpoint.set"; readonly target: string; readonly celsius: number }
  | { readonly type: "breaker.reset"; readonly target: string }
  | { readonly type: "thermal.shutdown"; readonly target: string }
  | { readonly type: "alarm.raise"; readonly alarm: Alarm }
  | { readonly type: "alarm.clear"; readonly alarmId: string }
  | { readonly type: "note"; readonly text: string };

export type WorldEvent = WorldCommand & {
  readonly seq: number;
  readonly t: number;
  readonly cause: string;
};

export interface WorldSnapshot {
  readonly seq: number;
  readonly state: WorldState;
}

/**
 * A snapshot plus the event log up to it: enough to start a fresh world of the same blueprint exactly
 * where this one stands (warm start, REQ-032). Events are never changed once written, so checkpoints
 * and the worlds adopting them share them.
 */
export interface WorldCheckpoint extends WorldSnapshot {
  readonly log: readonly WorldEvent[];
}

/** What facades, tools and the oracle may read. */
export interface WorldReader {
  readonly index: BlueprintIndex;
  readonly catalog: Catalog;
  time(): number;
  stateOf(id: string): EntityState;
  stateAs<K extends EntityKind>(id: string, kind: K): StateOf<K>;
  linkUp(linkId: string): boolean;
  faults(): Fault[];
  faultsOn(target: string): Fault[];
  alarms(): Alarm[];
  events(sinceSeq?: number): WorldEvent[];
  /** Sequence number of the latest event (0 before any), cheap to read before and after a call. */
  lastSeq(): number;
}

/** A reader that also accepts commands. Facades depend only on this port (REQ-008). */
export interface WorldPort extends WorldReader {
  apply(command: WorldCommand, cause: string): WorldEvent;
}

const POWERABLE: ReadonlySet<EntityKind> = new Set([
  "server",
  "switch",
  "storage",
  "cooling_unit",
  "vm",
]);

export class World implements WorldPort {
  readonly index: BlueprintIndex;
  private state: WorldState;
  private sortedAlarms: Alarm[] | undefined;
  private log: WorldEvent[] = [];
  private seq = 0;

  private constructor(
    blueprint: Blueprint,
    readonly catalog: Catalog,
  ) {
    this.index = new BlueprintIndex(blueprint);
    this.state = initialState(this.index, catalog);
  }

  /** Build a world; a blueprint with validation errors is refused with every error listed. */
  static fromBlueprint(blueprint: Blueprint, catalog: Catalog): World {
    const issues = validateBlueprint(blueprint, catalog);
    if (hasErrors(issues)) {
      const errors = issues
        .filter((i) => i.severity === "error")
        .map((i) => `${i.code} ${i.message}`);
      throw new InvalidValueError(`blueprint ${blueprint.id} is invalid: ${errors.join("; ")}`);
    }
    return new World(blueprint, catalog);
  }

  time(): number {
    return this.state.t;
  }

  /** Move simulated time forward (physics calls this once per step). */
  advance(seconds: number): void {
    if (!(seconds >= 0)) throw new InvalidValueError("time cannot move backwards");
    this.state.t += seconds;
  }

  stateOf(id: string): EntityState {
    const state = this.state.entities[id];
    if (!state) throw new NotFoundError(`no entity '${id}' in this world`);
    return state;
  }

  stateAs<K extends EntityKind>(id: string, kind: K): StateOf<K> {
    const state = this.stateOf(id);
    if (state.kind !== kind)
      throw new InvalidValueError(`'${id}' is a ${state.kind}, not a ${kind}`);
    return state as StateOf<K>;
  }

  /** Continuous update from physics; not an event (it is reproduced by replaying the steps). */
  patch<K extends EntityKind>(id: string, kind: K, values: Partial<StateOf<K>>): void {
    Object.assign(this.stateAs(id, kind), values);
  }

  linkUp(linkId: string): boolean {
    return this.state.links[linkId]?.up ?? true;
  }

  setLinkUp(linkId: string, up: boolean): void {
    if (this.state.links[linkId]) this.state.links[linkId] = { up };
  }

  faults(): Fault[] {
    return Object.values(this.state.faults).sort((a, b) => a.id.localeCompare(b.id));
  }

  faultsOn(target: string): Fault[] {
    return Object.values(this.state.faults)
      .filter((f) => f.target === target)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  alarms(): Alarm[] {
    // Physics asks for the alarm list several times a step; sorting thousands of ids each time dominated big worlds.
    this.sortedAlarms ??= Object.values(this.state.alarms).sort((a, b) => a.id.localeCompare(b.id));
    return [...this.sortedAlarms];
  }

  lastSeq(): number {
    return this.seq;
  }

  events(sinceSeq = 0): WorldEvent[] {
    return this.log.filter((e) => e.seq > sinceSeq);
  }

  apply(command: WorldCommand, cause: string): WorldEvent {
    this.validate(command);
    const event: WorldEvent = { ...command, seq: ++this.seq, t: this.state.t, cause };
    this.reduce(command);
    this.log.push(event);
    return event;
  }

  snapshot(): WorldSnapshot {
    return { seq: this.seq, state: structuredClone(this.state) };
  }

  /** Everything needed to continue from here in another world built from the same blueprint. */
  checkpoint(): WorldCheckpoint {
    return { ...this.snapshot(), log: [...this.log] };
  }

  /** Continue from a checkpoint taken on a world of the same blueprint and catalog. */
  adopt(checkpoint: WorldCheckpoint): void {
    this.state = structuredClone(checkpoint.state);
    this.sortedAlarms = undefined;
    this.seq = checkpoint.seq;
    this.log = [...checkpoint.log];
  }

  restore(snapshot: WorldSnapshot): void {
    this.state = structuredClone(snapshot.state);
    this.sortedAlarms = undefined;
    this.seq = snapshot.seq;
    this.log = this.log.filter((e) => e.seq <= snapshot.seq);
  }

  private validate(command: WorldCommand): void {
    switch (command.type) {
      case "power.set":
        if (!POWERABLE.has(this.stateOf(command.target).kind))
          throw new InvalidValueError(`'${command.target}' cannot be powered on or off`);
        return;
      case "fault.add":
        this.validateFault(command.fault);
        return;
      case "fault.remove":
        if (!this.state.faults[command.faultId])
          throw new NotFoundError(`no active fault '${command.faultId}'`);
        return;
      case "load.set":
        this.validateLoad(command.target, command.value);
        return;
      case "setpoint.set":
        this.validateSetpoint(command.target, command.celsius);
        return;
      case "breaker.reset": {
        const kind = this.stateOf(command.target).kind;
        if (kind !== "pdu" && kind !== "power_panel")
          throw new InvalidValueError(`'${command.target}' has no breaker`);
        return;
      }
      case "thermal.shutdown":
        this.stateAs(command.target, "server");
        return;
      default:
        return;
    }
  }

  private validateFault(fault: Omit<Fault, "since">): void {
    if (this.state.faults[fault.id])
      throw new ConflictError(`fault '${fault.id}' is already active`);
    const spec = faultSpec(fault.type);
    if (!spec) throw new InvalidValueError(`unknown fault type '${fault.type}'`);
    const isLink = this.state.links[fault.target] !== undefined;
    const kind = isLink ? "link" : this.stateOf(fault.target).kind;
    if (!spec.targets.includes(kind))
      throw new InvalidValueError(`fault '${fault.type}' cannot target a ${kind}`);
    for (const param of spec.params) {
      const value = fault.params[param.name];
      if (value !== undefined && (value < param.min || value > param.max)) {
        throw new InvalidValueError(`${param.name} must be between ${param.min} and ${param.max}`);
      }
    }
  }

  private validateLoad(target: string, value: number): void {
    const kind = this.stateOf(target).kind;
    if (kind !== "server" && kind !== "vm")
      throw new InvalidValueError(`load can only be set on servers and VMs`);
    if (!(value >= 0 && value <= 1)) throw new InvalidValueError("load must be between 0 and 1");
  }

  private validateSetpoint(target: string, celsius: number): void {
    const entity = this.index.entity(target);
    const model = this.catalog.getOf(entity.modelId ?? "", "cooling_unit");
    if (!(celsius >= model.minSetpointC && celsius <= model.maxSetpointC)) {
      throw new InvalidValueError(
        `setpoint must be between ${model.minSetpointC} and ${model.maxSetpointC} °C`,
      );
    }
  }

  private reduce(command: WorldCommand): void {
    const s = this.state;
    switch (command.type) {
      case "power.set":
        Object.assign(s.entities[command.target] as object, { adminOn: command.on });
        return;
      case "fault.add":
        s.faults[command.fault.id] = {
          ...command.fault,
          params: this.withDefaults(command.fault),
          since: s.t,
        };
        this.applyImmediate(command.fault.type, command.fault.target, true);
        return;
      case "fault.remove": {
        const fault = s.faults[command.faultId] as Fault;
        delete s.faults[command.faultId];
        this.applyImmediate(fault.type, fault.target, false);
        return;
      }
      case "load.set":
        this.reduceLoad(command.target, command.value);
        return;
      case "setpoint.set":
        this.patch(command.target, "cooling_unit", { setpointC: command.celsius });
        return;
      case "breaker.reset":
        for (const fault of this.faultsOn(command.target).filter((f) => f.type === "breaker_trip"))
          delete s.faults[fault.id];
        Object.assign(s.entities[command.target] as object, { tripped: false });
        return;
      case "thermal.shutdown":
        this.patch(command.target, "server", { adminOn: false, health: "critical" });
        return;
      case "alarm.raise":
        s.alarms[command.alarm.id] = command.alarm;
        this.sortedAlarms = undefined;
        return;
      case "alarm.clear":
        delete s.alarms[command.alarmId];
        this.sortedAlarms = undefined;
        return;
      case "note":
        return;
    }
  }

  private reduceLoad(target: string, value: number): void {
    const state = this.stateOf(target);
    if (state.kind === "server") state.cpuUtil = value;
    else if (state.kind === "vm") state.cpuDemand = value;
  }

  private withDefaults(fault: Omit<Fault, "since">): Record<string, number> {
    const params: Record<string, number> = {};
    for (const spec of faultSpec(fault.type).params)
      params[spec.name] = fault.params[spec.name] ?? spec.default;
    return params;
  }

  /** Effects that happen the moment a fault starts or ends; gradual effects belong to physics. */
  private applyImmediate(type: Fault["type"], target: string, active: boolean): void {
    if (type === "breaker_trip")
      Object.assign(this.state.entities[target] as object, { tripped: active });
    if (type === "grid_outage") this.patch(target, "ups", { inputOk: !active });
    if (type === "link_down") this.setLinkUp(target, !active);
  }
}

/** Wraps a reader so that every command is refused: the shape of a connection to reality (REQ-011). */
export class ReadOnlyWorldPort implements WorldPort {
  constructor(private readonly reader: WorldReader) {}

  get index(): BlueprintIndex {
    return this.reader.index;
  }

  get catalog(): Catalog {
    return this.reader.catalog;
  }

  time = (): number => this.reader.time();
  stateOf = (id: string): EntityState => this.reader.stateOf(id);
  stateAs = <K extends EntityKind>(id: string, kind: K): StateOf<K> =>
    this.reader.stateAs(id, kind);
  linkUp = (linkId: string): boolean => this.reader.linkUp(linkId);
  faults = (): Fault[] => this.reader.faults();
  faultsOn = (target: string): Fault[] => this.reader.faultsOn(target);
  alarms = (): Alarm[] => this.reader.alarms();
  events = (sinceSeq?: number): WorldEvent[] => this.reader.events(sinceSeq);
  lastSeq = (): number => this.reader.lastSeq();

  apply(command: WorldCommand): WorldEvent {
    throw new ReadOnlyViolationError(
      `this world mirrors a real system and is read-only (refused ${command.type})`,
    );
  }
}
