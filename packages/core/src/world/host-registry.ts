/**
 * What the world keeps track of about hosts beyond their plain state (ADR-0091): which hosts have a stored
 * operating system, and which VMs an operator moved to another server. Both are looked up by physics every step,
 * so they are kept as sets and maps until something changes them.
 */
import type { BlueprintIndex } from "./graph";
import { freshHostOs, isHost } from "./host-os";
import type { HostOs } from "./os";
import type { EntityState, StateOf } from "./state";
import type { WorldReader } from "./world";

type Host = StateOf<"server"> | StateOf<"vm">;

export class HostRegistry {
  private withOs: Set<string> | undefined;
  private moved: Map<number, number> | undefined | null = null;

  constructor(
    private readonly index: BlueprintIndex,
    private readonly raw: (id: string) => EntityState,
  ) {}

  /** Forget what was worked out (the world's state was replaced). */
  reset(): void {
    this.withOs = undefined;
    this.moved = null;
  }

  /** The hosts whose operating system has a stored state (physics moves only these). */
  osHosts(): Set<string> {
    this.withOs ??= new Set(
      this.index
        .all()
        .flatMap((e) => (isHost(e.kind) && (this.raw(e.id) as Host).os ? [e.id] : [])),
    );
    return this.withOs;
  }

  /** The operating system of a host, stored on first need (a healthy one, made from the host's id). */
  ensureOs(world: WorldReader, id: string): HostOs {
    const state = this.raw(id) as Host;
    if (!state.os) {
      state.os = freshHostOs(world, id);
      this.osHosts().add(id);
    }
    return state.os;
  }

  /** VMs moved to another server, as positions (VM, new host); undefined while none was moved. */
  vmMoves(): ReadonlyMap<number, number> | undefined {
    if (this.moved === null) {
      const out = new Map<number, number>();
      for (const vm of this.index.ofKind("vm")) {
        const to = (this.raw(vm.id) as StateOf<"vm">).hostId;
        const at = this.index.positionOf(vm.id);
        const host = to === undefined ? undefined : this.index.positionOf(to);
        if (at !== undefined && host !== undefined) out.set(at, host);
      }
      this.moved = out.size > 0 ? out : undefined;
    }
    return this.moved;
  }

  /** A VM now runs on this server. */
  moveVm(id: string, host: string): void {
    (this.raw(id) as StateOf<"vm">).hostId = host;
    this.moved = null;
  }
}
