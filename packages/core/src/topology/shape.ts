/**
 * The shape of a layer: which equipment stands in which stage and who leans on whom. It depends on the blueprint
 * only (not on how things are doing), so it is made once for a blueprint and kept; reading a new moment of the
 * world never builds it again.
 */
import { type BlueprintIndex, bulkOf, type Entity } from "@terrarium/core/world";
import type { Stage, TopoKind } from "./types";

export interface LayerShape {
  /** The stages that have something in them, in reading order. */
  readonly stages: readonly Stage[];
  /** Equipment ids of each stage. */
  readonly members: ReadonlyArray<readonly string[]>;
  readonly stageOf: ReadonlyMap<string, number>;
  readonly kindOf: ReadonlyMap<string, TopoKind>;
  /** Toward the source (the stage before). */
  readonly suppliers: ReadonlyMap<string, readonly string[]>;
  /** Toward the servers (the stage after). */
  readonly consumers: ReadonlyMap<string, readonly string[]>;
}

/** Collects members and the links between stages, then drops the stages that stayed empty. */
export class ShapeBuilder {
  private readonly stage = new Map<string, number>();
  private readonly kind = new Map<string, TopoKind>();
  private readonly down = new Map<string, Set<string>>();

  constructor(private readonly defs: readonly Stage[]) {}

  /** Put one piece of equipment in a stage (the first call for an id wins). */
  add(id: string, stage: number, kind: TopoKind): void {
    if (this.stage.has(id)) return;
    this.stage.set(id, stage);
    this.kind.set(id, kind);
  }

  has(id: string): boolean {
    return this.stage.has(id);
  }

  /** `supplier` feeds `consumer`; only links that go forward from one stage to a later one are kept. */
  link(supplier: string, consumer: string): void {
    const a = this.stage.get(supplier);
    const b = this.stage.get(consumer);
    if (a === undefined || b === undefined || a >= b) return;
    const set = this.down.get(supplier);
    if (set) set.add(consumer);
    else this.down.set(supplier, new Set([consumer]));
  }

  build(): LayerShape {
    const used = [...new Set(this.stage.values())].sort((x, y) => x - y);
    const renumber = new Map(used.map((old, i) => [old, i]));
    const members: string[][] = used.map(() => []);
    const stageOf = new Map<string, number>();
    for (const [id, old] of this.stage) {
      const n = renumber.get(old) as number;
      stageOf.set(id, n);
      (members[n] as string[]).push(id);
    }
    const consumers = new Map<string, readonly string[]>();
    const suppliers = new Map<string, string[]>();
    for (const [from, set] of this.down) {
      consumers.set(from, [...set]);
      for (const to of set) {
        const list = suppliers.get(to);
        if (list) list.push(from);
        else suppliers.set(to, [from]);
      }
    }
    return {
      stages: used.map((old) => this.defs[old] as Stage),
      members,
      stageOf,
      kindOf: this.kind,
      suppliers,
      consumers,
    };
  }
}

/** How many servers a rack holds: the count a light rack keeps, or the servers standing in it. */
export function rackServers(index: BlueprintIndex, rack: Entity): number {
  const bulk = bulkOf(rack);
  return bulk ? bulk.servers : index.childrenOf(rack.id, "server").length;
}
