import { NotFoundError } from "@terrarium/core/kernel";
import type { Blueprint, Entity, EntityKind, Link, LinkKind } from "./blueprint";

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const NO_ENTITIES: readonly Entity[] = [];
const NO_LINKS: readonly Link[] = [];

/** Items grouped by owner and then by kind, so a lookup by both is one step and allocates nothing. */
class Grouped<T, K> {
  private readonly all = new Map<string, T[]>();
  private readonly byKind = new Map<string, Map<K, T[]>>();

  add(owner: string, kind: K, item: T): void {
    const list = this.all.get(owner);
    if (list) list.push(item);
    else this.all.set(owner, [item]);
    let kinds = this.byKind.get(owner);
    if (!kinds) {
      kinds = new Map();
      this.byKind.set(owner, kinds);
    }
    const group = kinds.get(kind);
    if (group) group.push(item);
    else kinds.set(kind, [item]);
  }

  get(owner: string, none: readonly T[], kind?: K): readonly T[] {
    if (kind === undefined) return this.all.get(owner) ?? none;
    return this.byKind.get(owner)?.get(kind) ?? none;
  }
}

/**
 * Read-only indexes over a blueprint: lookups, the containment tree and link adjacency. The blueprint
 * never changes under an index, so every answer is kept and handed out as it is (callers must not
 * change the arrays they get; the types say so).
 */
export class BlueprintIndex {
  private readonly entities = new Map<string, Entity>();
  private readonly links = new Map<string, Link>();
  private readonly children = new Grouped<Entity, EntityKind>();
  private readonly outgoingLinks = new Grouped<Link, LinkKind>();
  private readonly incomingLinks = new Grouped<Link, LinkKind>();
  private readonly descendantsOf = new Map<string, readonly Entity[]>();
  private readonly ofKinds = new Map<EntityKind, readonly Entity[]>();
  private readonly enclosingOf = new Map<EntityKind, Map<string, Entity | null>>();
  private everyEntity?: readonly Entity[];
  private everyLink?: readonly Link[];
  private positions?: ReadonlyMap<string, number>;

  constructor(readonly blueprint: Blueprint) {
    for (const entity of [...blueprint.entities].sort(byId)) {
      this.entities.set(entity.id, entity);
      if (entity.parentId !== undefined) this.children.add(entity.parentId, entity.kind, entity);
    }
    for (const link of [...blueprint.links].sort(byId)) {
      this.links.set(link.id, link);
      this.outgoingLinks.add(link.from, link.kind, link);
      this.incomingLinks.add(link.to, link.kind, link);
    }
  }

  has(id: string): boolean {
    return this.entities.has(id);
  }

  find(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  entity(id: string): Entity {
    const entity = this.entities.get(id);
    if (!entity) throw new NotFoundError(`no entity '${id}' in world ${this.blueprint.id}`);
    return entity;
  }

  link(id: string): Link {
    const link = this.links.get(id);
    if (!link) throw new NotFoundError(`no link '${id}' in world ${this.blueprint.id}`);
    return link;
  }

  all(): readonly Entity[] {
    this.everyEntity ??= [...this.entities.values()];
    return this.everyEntity;
  }

  /**
   * Where an entity stands in `all()`. Hot loops that walk every entity every step (physics) keep their data
   * in arrays by this position instead of looking each id up again and again.
   */
  positionOf(id: string): number | undefined {
    this.positions ??= new Map(this.all().map((e, i) => [e.id, i]));
    return this.positions.get(id);
  }

  allLinks(): readonly Link[] {
    this.everyLink ??= [...this.links.values()];
    return this.everyLink;
  }

  ofKind(kind: EntityKind): readonly Entity[] {
    let list = this.ofKinds.get(kind);
    if (!list) {
      list = this.all().filter((e) => e.kind === kind);
      this.ofKinds.set(kind, list);
    }
    return list;
  }

  childrenOf(id: string, kind?: EntityKind): readonly Entity[] {
    return this.children.get(id, NO_ENTITIES, kind);
  }

  /** Parent, grandparent, ... up to the root. */
  ancestors(id: string): Entity[] {
    const out: Entity[] = [];
    let current = this.find(id);
    const seen = new Set<string>();
    while (current?.parentId !== undefined && !seen.has(current.parentId)) {
      seen.add(current.parentId);
      current = this.find(current.parentId);
      if (current) out.push(current);
    }
    return out;
  }

  /** True when following parents from `id` leads back to `id`. */
  inParentLoop(id: string): boolean {
    const seen = new Set<string>();
    let current = this.find(id)?.parentId;
    while (current !== undefined && !seen.has(current)) {
      if (current === id) return true;
      seen.add(current);
      current = this.find(current)?.parentId;
    }
    return false;
  }

  /** The nearest ancestor (or the entity itself) of the given kind. */
  enclosing(id: string, kind: EntityKind): Entity | undefined {
    let known = this.enclosingOf.get(kind);
    if (!known) {
      known = new Map();
      this.enclosingOf.set(kind, known);
    }
    const hit = known.get(id);
    if (hit !== undefined) return hit ?? undefined;
    const self = this.find(id);
    const found = self?.kind === kind ? self : this.ancestors(id).find((e) => e.kind === kind);
    known.set(id, found ?? null);
    return found;
  }

  /**
   * Everything below `id`, depth first. The blueprint never changes under an index, and physics asks for the
   * same room's contents once per rack per step, so the answer is kept (callers must not change the array).
   */
  descendants(id: string): readonly Entity[] {
    const kept = this.descendantsOf.get(id);
    if (kept) return kept;
    const out: Entity[] = [];
    // A blueprint whose parents loop back on themselves is invalid, but it must still be walkable to say so.
    const seen = new Set<string>([id]);
    const stack = [...this.childrenOf(id)].reverse();
    while (stack.length > 0) {
      const next = stack.pop() as Entity;
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      out.push(next);
      stack.push(...[...this.childrenOf(next.id)].reverse());
    }
    this.descendantsOf.set(id, out);
    return out;
  }

  outgoing(id: string, kind?: LinkKind): readonly Link[] {
    return this.outgoingLinks.get(id, NO_LINKS, kind);
  }

  incoming(id: string, kind?: LinkKind): readonly Link[] {
    return this.incomingLinks.get(id, NO_LINKS, kind);
  }

  /** Every entity reachable by following `kind` links from `id` (suppliers of a consumer). */
  upstream(id: string, kind: LinkKind): string[] {
    return this.walkLinks(id, kind, (node) => this.outgoing(node, kind).map((l) => l.to));
  }

  /** Every entity that (transitively) depends on `id` through `kind` links. */
  downstream(id: string, kind: LinkKind): string[] {
    return this.walkLinks(id, kind, (node) => this.incoming(node, kind).map((l) => l.from));
  }

  /** True when following `kind` links from `id` leads back to `id`. */
  inCycle(id: string, kind: LinkKind): boolean {
    const seen = new Set<string>();
    const stack = this.outgoing(id, kind).map((l) => l.to);
    while (stack.length > 0) {
      const node = stack.pop() as string;
      if (node === id) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      stack.push(...this.outgoing(node, kind).map((l) => l.to));
    }
    return false;
  }

  private walkLinks(id: string, _kind: LinkKind, next: (node: string) => string[]): string[] {
    const seen = new Set<string>([id]);
    const order: string[] = [];
    const queue = [id];
    while (queue.length > 0) {
      for (const neighbour of next(queue.shift() as string)) {
        if (!seen.has(neighbour)) {
          seen.add(neighbour);
          order.push(neighbour);
          queue.push(neighbour);
        }
      }
    }
    return order;
  }
}
