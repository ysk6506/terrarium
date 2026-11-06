/**
 * Who has power: whether a supplier delivers to what is connected to it, and which suppliers actually
 * carry a consumer's load. Answers are kept for the length of one resolver (one pass of one step), and
 * everything is looked up by position in the blueprint's entity list (see power-plan.ts).
 */
import { NotFoundError } from "@terrarium/core/kernel";
import type { EntityState, Fault, World } from "@terrarium/core/world";
import { type PowerPlan, powerPlanOf } from "./power-plan";

export function hasFault(list: readonly Fault[], type: string): boolean {
  for (const f of list) if (f.type === type) return true;
  return false;
}

/** A parameter of the first fault of a type, if there is one. */
export function faultParam(list: readonly Fault[], type: string, name: string): number | undefined {
  for (const f of list) if (f.type === type) return f.params[name];
  return undefined;
}

const UNKNOWN = 0;
const YES = 1;
const NO = 2;

function mark(live: Uint8Array, counts: Int32Array, i: number, p: number): void {
  live[p] = 1;
  counts[i] = (counts[i] as number) + 1;
}

/** The cables an operator cut by switching off the outlet they are plugged into; undefined when none is. */
function cutCables(plan: PowerPlan, states: readonly EntityState[]): Uint8Array | undefined {
  let cut: Uint8Array | undefined;
  for (const s of plan.pdus) {
    const state = states[s];
    if (state?.kind !== "pdu" || !state.outletsOff) continue;
    const count = (plan.inStart[s + 1] as number) - (plan.inStart[s] as number);
    for (const n of state.outletsOff) {
      if (n > count) continue;
      cut ??= new Uint8Array(plan.outTo.length);
      cut[plan.inCable[(plan.inStart[s] as number) + n - 1] as number] = 1;
    }
  }
  return cut;
}

/** Whether a supplier delivers power to what is connected to it. Memoised per resolver, cycle-safe. */
export class SupplyResolver {
  readonly plan: PowerPlan;
  readonly states: readonly EntityState[];
  readonly faults: ReadonlyArray<readonly Fault[]>;
  readonly moves: ReadonlyMap<number, number> | undefined;
  private readonly memo: Int8Array;
  private readonly visiting: Uint8Array;
  /** Per power cable: it carries its consumer's load now. Worked out for a consumer when first asked. */
  private live: Uint8Array | undefined;
  private liveDone: Uint8Array | undefined;
  private liveCounts: Int32Array | undefined;
  /** Per power cable: an operator switched off the outlet it is plugged into (undefined: none anywhere). */
  private readonly cut: Uint8Array | undefined;

  constructor(private readonly world: World) {
    this.plan = powerPlanOf(world.index, world.catalog);
    this.states = world.stateList();
    this.faults = world.faultList();
    this.moves = world.vmMoves();
    this.memo = new Int8Array(this.plan.ents.length);
    this.visiting = new Uint8Array(this.plan.ents.length);
    this.cut = cutCables(this.plan, this.states);
  }

  /** A consumer is fed when it has no power links (assumed utility) or any supplier delivers. */
  fed(id: string): boolean {
    return this.fedAt(this.at(id));
  }

  fedAt(i: number): boolean {
    const { outStart } = this.plan;
    const from = outStart[i] as number;
    const to = outStart[i + 1] as number;
    if (from === to) return !hasFault(this.faults[i] as readonly Fault[], "utility_outage");
    for (let p = from; p < to; p++) if (this.carries(p)) return true;
    return false;
  }

  /** Whether power can come over cable `p`: its outlet is not switched off and its supplier delivers. */
  private carries(p: number): boolean {
    return this.cut?.[p] !== 1 && this.deliversAt(this.plan.outTo[p] as number);
  }

  delivers(id: string): boolean {
    return this.deliversAt(this.at(id));
  }

  deliversAt(i: number): boolean {
    const known = this.memo[i];
    if (known !== UNKNOWN) return known === YES;
    if (this.visiting[i] === 1) return false;
    this.visiting[i] = 1;
    const result = this.compute(i);
    this.visiting[i] = 0;
    this.memo[i] = result ? YES : NO;
    return result;
  }

  /** Whether the utility side of a transfer switch (its non-generator source) is live. */
  utilityOk(id: string): boolean {
    return this.utilityOkAt(this.at(id));
  }

  utilityOkAt(i: number): boolean {
    if (hasFault(this.faults[i] as readonly Fault[], "utility_outage")) return false;
    const { outStart, outTo, toGenerator } = this.plan;
    const to = outStart[i + 1] as number;
    let any = false;
    for (let p = outStart[i] as number; p < to; p++) {
      if (toGenerator[p] === 1) continue;
      any = true;
      if (this.deliversAt(outTo[p] as number)) return true;
    }
    return !any;
  }

  /** The suppliers that actually carry a consumer's load right now: a transfer switch uses one source. */
  activeFeeds(id: string): readonly string[] {
    const i = this.at(id);
    this.work(i);
    const { outStart, outTo, ents } = this.plan;
    const live = this.live as Uint8Array;
    const out: string[] = [];
    for (let p = outStart[i] as number; p < (outStart[i + 1] as number); p++)
      if (live[p] === 1) out.push((ents[outTo[p] as number] as { id: string }).id);
    return out;
  }

  /** How many cables carry consumer `i`'s load. */
  feedCount(i: number): number {
    this.work(i);
    return (this.liveCounts as Int32Array)[i] as number;
  }

  /** Whether consumer `i` draws its load from supplier `s`. */
  feeds(i: number, s: number): boolean {
    this.work(i);
    const { outStart, outTo } = this.plan;
    const live = this.live as Uint8Array;
    for (let p = outStart[i] as number; p < (outStart[i + 1] as number); p++)
      if (live[p] === 1 && outTo[p] === s) return true;
    return false;
  }

  private at(id: string): number {
    const i = this.world.index.positionOf(id);
    if (i === undefined) throw new NotFoundError(`no entity '${id}' in this world`);
    return i;
  }

  private work(i: number): void {
    this.live ??= new Uint8Array(this.plan.outTo.length);
    this.liveDone ??= new Uint8Array(this.plan.ents.length);
    this.liveCounts ??= new Int32Array(this.plan.ents.length);
    if (this.liveDone[i] === 1) return;
    this.liveDone[i] = 1;
    this.markLive(i, this.live, this.liveCounts);
  }

  private markLive(i: number, live: Uint8Array, counts: Int32Array): void {
    const { outStart, outTo, toGenerator, ats } = this.plan;
    const from = outStart[i] as number;
    const to = outStart[i + 1] as number;
    if (ats[i] !== 1) {
      for (let p = from; p < to; p++) if (this.carries(p)) mark(live, counts, i, p);
    } else if (this.utilityOkAt(i)) {
      for (let p = from; p < to; p++)
        if (toGenerator[p] !== 1 && this.deliversAt(outTo[p] as number)) mark(live, counts, i, p);
    } else if (!hasFault(this.faults[i] as readonly Fault[], "ats_stuck")) {
      for (let p = from; p < to; p++) {
        if (toGenerator[p] === 1 && this.deliversAt(outTo[p] as number)) {
          mark(live, counts, i, p);
          break;
        }
      }
    }
  }

  private compute(i: number): boolean {
    const state = this.states[i] as EntityState;
    if (state.kind === "ups")
      return (
        (this.fedAt(i) && !hasFault(this.faults[i] as readonly Fault[], "grid_outage")) ||
        state.batteryPct > 0
      );
    if (state.kind === "generator") return state.phase === "running";
    if (state.kind === "pdu") return !state.tripped && this.fedAt(i);
    if (state.kind === "power_panel") return !state.tripped && this.panelFed(i);
    return false;
  }

  private panelFed(i: number): boolean {
    if (this.plan.ats[i] !== 1) return this.fedAt(i);
    if (this.utilityOkAt(i)) return true;
    if (hasFault(this.faults[i] as readonly Fault[], "ats_stuck")) return false;
    const { outStart, outTo, toGenerator } = this.plan;
    for (let p = outStart[i] as number; p < (outStart[i + 1] as number); p++)
      if (toGenerator[p] === 1 && this.deliversAt(outTo[p] as number)) return true;
    return false;
  }
}

/** A power panel of style "ats": it picks the utility side, else a generator. */
export function isTransferSwitch(world: World, id: string): boolean {
  const at = world.index.positionOf(id);
  if (at === undefined) return false;
  return powerPlanOf(world.index, world.catalog).ats[at] === 1;
}
