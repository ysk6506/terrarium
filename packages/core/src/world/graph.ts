import { NotFoundError } from "@terrarium/core/kernel";
import type { Blueprint, Entity, EntityKind, Link, LinkKind } from "./blueprint";

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Read-only indexes over a blueprint: lookups, the containment tree and link adjacency. */
export class BlueprintIndex {
  private readonly entities = new Map<string, Entity>();
  private readonly links = new Map<string, Link>();
  private readonly children = new Map<string, Entity[]>();
  private readonly outgoingLinks = new Map<string, Link[]>();
  private readonly incomingLinks = new Map<string, Link[]>();
  private readonly descendantsOf = new Map<string, readonly Entity[]>();

  constructor(readonly blueprint: Blueprint) {
    for (const entity of [...blueprint.entities].sort(byId)) {
      this.entities.set(entity.id, entity);
      if (entity.parentId !== undefined) this.push(this.children, entity.parentId, entity);
    }
    for (const link of [...blueprint.links].sort(byId)) {
      this.links.set(link.id, link);
      this.push(this.outgoingLinks, link.from, link);
      this.push(this.incomingLinks, link.to, link);
    }
  }

  private push<T>(map: Map<string, T[]>, key: string, value: T): void {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
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

  all(): Entity[] {
    return [...this.entities.values()];
  }

  allLinks(): Link[] {
    return [...this.links.values()];
  }

  ofKind(kind: EntityKind): Entity[] {
    return this.all().filter((e) => e.kind === kind);
  }

  childrenOf(id: string, kind?: EntityKind): Entity[] {
    return (this.children.get(id) ?? []).filter((e) => kind === undefined || e.kind === kind);
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

  /** The nearest ancestor (or the entity itself) of the given kind. */
  enclosing(id: string, kind: EntityKind): Entity | undefined {
    const self = this.find(id);
    if (self?.kind === kind) return self;
    return this.ancestors(id).find((e) => e.kind === kind);
  }

  /**
   * Everything below `id`, depth first. The blueprint never changes under an index, and physics asks for the
   * same room's contents once per rack per step, so the answer is kept (callers must not change the array).
   */
  descendants(id: string): readonly Entity[] {
    const kept = this.descendantsOf.get(id);
    if (kept) return kept;
    const out: Entity[] = [];
    const stack = [...this.childrenOf(id)].reverse();
    while (stack.length > 0) {
      const next = stack.pop() as Entity;
      out.push(next);
      stack.push(...[...this.childrenOf(next.id)].reverse());
    }
    this.descendantsOf.set(id, out);
    return out;
  }

  outgoing(id: string, kind?: LinkKind): Link[] {
    return (this.outgoingLinks.get(id) ?? []).filter((l) => kind === undefined || l.kind === kind);
  }

  incoming(id: string, kind?: LinkKind): Link[] {
    return (this.incomingLinks.get(id) ?? []).filter((l) => kind === undefined || l.kind === kind);
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
