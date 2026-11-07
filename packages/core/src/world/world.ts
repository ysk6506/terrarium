/**
 * A running world: blueprint + catalog + dynamic state + an append-only event log (ADR-0006).
 * Discrete changes happen only through `apply(command)`, which validates, records and reduces an
 * event; continuous values (temperatures, loads) are written by physics with `patch`. State is a
 * function of (blueprint, seed, events, time steps), so runs replay and snapshots restore exactly.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { InvalidValueError, NotFoundError } from "@terrarium/core/kernel";
import type { AppCommand } from "./app-act";
import type { Blueprint, EntityKind } from "./blueprint";
import { cloneState } from "./clone";
import { validateCommand } from "./command-check";
import type { DbCommand } from "./db-act";
import { type Fault, withParamDefaults } from "./faults";
import type { FirmwareCommand } from "./firmware";
import { reduceFirmware } from "./firmware-reduce";
import type { BlueprintIndex } from "./graph";
import type { HostAction } from "./host-os";
import { HostRegistry } from "./host-registry";
import type { K8sCommand } from "./k8s-act";
import { type NetChange, type NetPatch, patchWith } from "./net-config";
import { setLinkAdmin, setLoad, setOutlet } from "./operator";
import { type HostOs, OS_FAULT_TYPES } from "./os";
import { type PreparedWorld, prepareWorld } from "./prepared";
import { reduceHostAndService } from "./reduce-os";
import type { SdnCommand } from "./sdn-act";
import type { ServiceCommand } from "./service-act";
import type { SiteCommand } from "./site-act";
import {
  type Alarm,
  DEFAULT_OUTDOOR_C,
  type EntityState,
  initialState,
  type StateOf,
  type WorldState,
} from "./state";

export type WorldCommand =
  | { readonly type: "power.set"; readonly target: string; readonly on: boolean }
  | { readonly type: "fault.add"; readonly fault: Omit<Fault, "since"> }
  | { readonly type: "fault.remove"; readonly faultId: string }
  | { readonly type: "load.set"; readonly target: string; readonly value: number }
  | { readonly type: "setpoint.set"; readonly target: string; readonly celsius: number }
  | { readonly type: "breaker.reset"; readonly target: string }
  /** An operator shuts a switch port (`shutdown`) or brings it back (`no shutdown`); `target` is the network link. */
  | {
      readonly type: "link.admin";
      readonly target: string;
      /** Which end of the link the operator shut: the `from` device or the `to` device. */
      readonly end: "from" | "to";
      readonly down: boolean;
    }
  /** An operator switches one outlet of a PDU off or on; `outlet` counts from 1 in the order of its cables. */
  | {
      readonly type: "outlet.set";
      readonly target: string;
      readonly outlet: number;
      readonly on: boolean;
    }
  /** An operator changes the layer-2/3 configuration of a switch (VLAN, port mode, SVI, route); `target` is the switch. */
  | { readonly type: "net.set"; readonly target: string; readonly change: NetChange }
  | FirmwareCommand
  | ServiceCommand
  | DbCommand
  | SdnCommand
  | AppCommand
  | SiteCommand
  | K8sCommand
  /** An operator acts on the operating system of a server or VM: restart a process, free disk, remount, reboot (ADR-0091). */
  | {
      readonly type: "host.act";
      readonly target: string;
      readonly action: HostAction;
      /** The process to restart, or the path whose files are removed. */
      readonly arg?: string;
      /** What the action carries besides `arg`: the text written to a file, or the bytes a removal frees. */
      readonly data?: string;
    }
  /** Outdoor air changes (a heat wave, a cold snap); the plants' capacity follows it. Scenarios do this, operators cannot. */
  | { readonly type: "outdoor.set"; readonly celsius: number }
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
  /** Outdoor air, °C: 25 until a scenario changes it. */
  outdoorC(): number;
  stateOf(id: string): EntityState;
  stateAs<K extends EntityKind>(id: string, kind: K): StateOf<K>;
  linkUp(linkId: string): boolean;
  /** Whether an operator shut this link (a port `shutdown`), as opposed to a fault cutting it. */
  linkAdminDown(linkId: string, end?: "from" | "to"): boolean;
  /** What operators changed on a switch's layer-2/3 configuration, or undefined while it is as designed. */
  netconf(switchId: string): NetPatch | undefined;
  /** Whether any switch has been reconfigured since the world began (until then the network is as designed). */
  hasNetconf(): boolean;
  /** Counts changes that can alter who reaches whom: configuration commands and links going up or down. */
  netEpoch(): number;
  faults(): Fault[];
  /** The faults on one thing; shared with the world, so callers read it and do not change it. */
  faultsOn(target: string): readonly Fault[];
  alarms(): Alarm[];
  events(sinceSeq?: number): WorldEvent[];
  /** Sequence number of the latest event (0 before any), cheap to read before and after a call. */
  lastSeq(): number;
}

/** A reader that also accepts commands. Facades depend only on this port (REQ-008). */
export interface WorldPort extends WorldReader {
  apply(command: WorldCommand, cause: string): WorldEvent;
}

const NO_FAULTS: readonly Fault[] = Object.freeze([]);

export class World implements WorldPort {
  readonly index: BlueprintIndex;
  private state: WorldState;
  private sortedAlarms: Alarm[] | undefined;
  /** Faults grouped by target, kept until a fault starts or ends: physics asks for them per device per step. */
  private faultsByTarget: Map<string, Fault[]> | undefined;
  /** The same, as arrays in the order of `index.all()`; see `stateList` and `faultList`. */
  private stateArray: readonly EntityState[] | undefined;
  private faultArray: ReadonlyArray<readonly Fault[]> | undefined;
  private anyDown: boolean | undefined;
  private updating: Set<string> | undefined;
  private readonly hosts: HostRegistry;
  private log: WorldEvent[] = [];
  private seq = 0;
  private netChanges = 0;

  private constructor(
    index: BlueprintIndex,
    readonly catalog: Catalog,
  ) {
    this.index = index;
    this.state = initialState(this.index, catalog);
    this.hosts = new HostRegistry(index, (id) => this.rawState(id));
  }

  /** Build a world; a blueprint with validation errors is refused with every error listed. */
  static fromBlueprint(blueprint: Blueprint, catalog: Catalog): World {
    return World.fromPrepared(prepareWorld(blueprint, catalog), catalog);
  }

  /** Build a world on a blueprint that was checked and indexed already (shared with other worlds). */
  static fromPrepared(prepared: PreparedWorld, catalog: Catalog): World {
    return new World(prepared.index, catalog);
  }

  time(): number {
    return this.state.t;
  }

  outdoorC(): number {
    return this.state.outdoorC ?? DEFAULT_OUTDOOR_C;
  }

  /** Move simulated time forward (physics calls this once per step). */
  advance(seconds: number): void {
    if (!(seconds >= 0)) throw new InvalidValueError("time cannot move backwards");
    this.state.t += seconds;
  }

  stateOf(id: string): EntityState {
    const state = this.state.entities[id];
    if (!state) throw new NotFoundError(`no entity '${id}' in this world`);
    // The outdoor air is one value for the whole world; a site reports it without it being stored in every snapshot.
    return state.kind === "site" ? { ...state, outdoorC: this.outdoorC() } : state;
  }

  private rawState(id: string): EntityState {
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

  /** Whether the link carries traffic: not cut by a fault and not shut by an operator. */
  linkUp(linkId: string): boolean {
    const link = this.state.links[linkId];
    return link ? link.up && !link.adminDown : true;
  }

  /** Whether an operator shut this end of the link (`shutdown` on the switch port); without an end: either end. */
  linkAdminDown(linkId: string, end?: "from" | "to"): boolean {
    const shut = this.state.links[linkId]?.adminDown;
    if (!shut) return false;
    return end ? shut[end] === true : true;
  }

  setLinkUp(linkId: string, up: boolean): void {
    const link = this.state.links[linkId];
    if (link) link.up = up;
    this.anyDown = undefined;
    this.netChanges++;
  }

  netconf(switchId: string): NetPatch | undefined {
    return this.state.netconf?.[switchId];
  }

  hasNetconf(): boolean {
    return this.state.netconf !== undefined && Object.keys(this.state.netconf).length > 0;
  }

  netEpoch(): number {
    return this.netChanges;
  }

  /** Whether any network link is down (kept until a link changes), so monitoring can skip a scan of every link. */
  anyLinkDown(): boolean {
    this.anyDown ??= Object.values(this.state.links).some(
      (l) => !l.up || l.adminDown !== undefined,
    );
    return this.anyDown;
  }

  faults(): Fault[] {
    return Object.values(this.state.faults).sort((a, b) => a.id.localeCompare(b.id));
  }

  faultsOn(target: string): readonly Fault[] {
    if (!this.faultsByTarget) {
      this.faultsByTarget = new Map();
      for (const fault of this.faults()) {
        const list = this.faultsByTarget.get(fault.target);
        if (list) list.push(fault);
        else this.faultsByTarget.set(fault.target, [fault]);
      }
    }
    return this.faultsByTarget.get(target) ?? NO_FAULTS;
  }

  /**
   * Every entity's state, in the order of `index.all()`. These are the live objects (patching one changes the
   * world); the list is kept until the whole state is replaced (adopt, restore). Physics walks thousands of
   * entities every step and does it by position, not by id.
   */
  stateList(): readonly EntityState[] {
    this.stateArray ??= this.index.all().map((e) => this.rawState(e.id));
    return this.stateArray;
  }

  /** The faults on each entity, in the order of `index.all()` (an empty list where there are none). */
  faultList(): ReadonlyArray<readonly Fault[]> {
    if (!this.faultArray) {
      const out: Array<readonly Fault[]> = new Array(this.index.all().length).fill(NO_FAULTS);
      for (const fault of this.faults()) {
        const at = this.index.positionOf(fault.target);
        if (at === undefined) continue; // a fault on a cable
        out[at] = [...(out[at] as readonly Fault[]), fault];
      }
      this.faultArray = out;
    }
    return this.faultArray;
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
    return { seq: this.seq, state: cloneState(this.state) };
  }

  /** Everything needed to continue from here in another world built from the same blueprint. */
  checkpoint(): WorldCheckpoint {
    return { ...this.snapshot(), log: [...this.log] };
  }

  /** Continue from a checkpoint taken on a world of the same blueprint and catalog. */
  adopt(checkpoint: WorldCheckpoint): void {
    this.state = cloneState(checkpoint.state);
    this.stateArray = undefined;
    this.updating = undefined;
    this.hosts.reset();
    this.anyDown = undefined;
    this.sortedAlarms = undefined;
    this.faultsChanged();
    this.netChanges++;
    this.seq = checkpoint.seq;
    this.log = [...checkpoint.log];
  }

  restore(snapshot: WorldSnapshot): void {
    this.state = cloneState(snapshot.state);
    this.stateArray = undefined;
    this.updating = undefined;
    this.hosts.reset();
    this.anyDown = undefined;
    this.sortedAlarms = undefined;
    this.faultsChanged();
    this.netChanges++;
    this.seq = snapshot.seq;
    this.log = this.log.filter((e) => e.seq <= snapshot.seq);
  }

  private validate(command: WorldCommand): void {
    validateCommand(
      this,
      {
        hasFault: (id) => this.state.faults[id] !== undefined,
        hasLink: (id) => this.state.links[id] !== undefined,
      },
      command,
    );
  }

  private reduce(command: WorldCommand): void {
    const s = this.state;
    if (changesFaults(command)) this.faultsChanged();
    switch (command.type) {
      case "power.set":
        Object.assign(s.entities[command.target] as object, { adminOn: command.on });
        return;
      case "fault.add":
        s.faults[command.fault.id] = {
          ...command.fault,
          params: withParamDefaults(command.fault),
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
        setLoad(this.stateOf(command.target), command.value);
        return;
      case "setpoint.set":
        this.patch(command.target, "cooling_unit", { setpointC: command.celsius });
        return;
      case "breaker.reset":
        this.resetBreaker(command.target);
        return;
      default:
        this.reduceOther(command);
    }
  }

  /** The commands that change one device's setting or the alarm list (and `note`, which only goes into the log). */
  private reduceOther(command: WorldCommand): void {
    const s = this.state;
    switch (command.type) {
      case "link.admin":
        setLinkAdmin(s, command.target, command.end, command.down);
        this.anyDown = undefined;
        this.netChanges++;
        return;
      case "net.set": {
        const patches = s.netconf ?? {};
        s.netconf = patches;
        patches[command.target] = patchWith(patches[command.target], command.change);
        this.netChanges++;
        return;
      }
      case "outlet.set":
        setOutlet(this.stateAs(command.target, "pdu"), command.outlet, command.on);
        return;
      case "outdoor.set":
        s.outdoorC = command.celsius;
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
      default:
        this.reduceFirmware(command);
    }
  }

  /** The firmware commands change one server's state (`note` ends up here and does nothing). */
  private reduceFirmware(command: WorldCommand): void {
    if (!command.type.startsWith("firmware.")) {
      reduceHostAndService(this, command);
      return;
    }
    const target = (command as FirmwareCommand).target;
    const server = this.stateAs(target, "server");
    reduceFirmware(server, command as FirmwareCommand, this.state.t);
    if (server.fw) this.updatingServers().add(target);
    else this.updatingServers().delete(target);
  }

  /** The servers with a firmware update running (physics walks only these). */
  updatingServers(): Set<string> {
    this.updating ??= new Set(
      this.index.ofKind("server").flatMap((e) => (this.stateAs(e.id, "server").fw ? [e.id] : [])),
    );
    return this.updating;
  }

  /** The hosts whose operating system has a stored state (physics moves only these). */
  osHosts = (): Set<string> => this.hosts.osHosts();
  /** The operating system of a host, stored on first need (a healthy one, made from the host's id). */
  ensureHostOs = (id: string): HostOs => this.hosts.ensureOs(this, id);
  /** VMs moved to another server, as positions (VM, new host); undefined while none was moved. */
  vmMoves = (): ReadonlyMap<number, number> | undefined => this.hosts.vmMoves();
  moveVm = (id: string, host: string): void => this.hosts.moveVm(id, host);

  /** End a fault without an event of its own (the command that cleared it is the event). */
  dropFault(faultId: string): void {
    delete this.state.faults[faultId];
    this.faultsChanged();
  }

  private faultsChanged(): void {
    this.faultsByTarget = undefined;
    this.faultArray = undefined;
  }

  private resetBreaker(target: string): void {
    for (const fault of this.faultsOn(target).filter((f) => f.type === "breaker_trip"))
      delete this.state.faults[fault.id];
    this.faultsChanged();
    Object.assign(this.state.entities[target] as object, { tripped: false });
  }

  /** Effects that happen the moment a fault starts or ends; gradual effects belong to physics. */
  private applyImmediate(type: Fault["type"], target: string, active: boolean): void {
    if (type === "breaker_trip")
      Object.assign(this.state.entities[target] as object, { tripped: active });
    if (type === "grid_outage" && this.stateOf(target).kind === "ups")
      this.patch(target, "ups", { inputOk: !active });
    if (type === "link_down") this.setLinkUp(target, !active);
    if (active && (OS_FAULT_TYPES as readonly string[]).includes(type)) this.ensureHostOs(target);
  }
}

/** Whether a command adds, removes or clears faults, so the per-target fault lookup must be rebuilt. */
const changesFaults = (command: WorldCommand): boolean =>
  command.type === "fault.add" ||
  command.type === "fault.remove" ||
  command.type === "breaker.reset";
