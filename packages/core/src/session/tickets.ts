/**
 * The agent's work tickets (REQ-093, ADR-0099 item 3): what it has to do, what it waits for and from whom, what is
 * done. The tools are optional; with them on, a hand-off makes a "waiting" ticket by itself and moves it to "mine" when
 * the other side is finished, because what is left (putting a moved VM back) is the agent's. Every change is written to
 * the run's events, so the board on the run page and the measurement read the same record.
 */
import { InvalidValueError } from "@terrarium/core/kernel";
import type { TicketInput } from "@terrarium/core/tools";
import type { TicketEvent, TicketSnapshot, TicketStatus } from "@terrarium/core/world";

export type TicketDraft = Omit<TicketEvent, "seq">;

export class Tickets {
  private readonly byId = new Map<string, TicketSnapshot>();

  constructor(
    private readonly emit: (event: TicketDraft) => void,
    private readonly now: () => number,
  ) {}

  private put(ticket: TicketSnapshot, what: "created" | "updated", auto: boolean): TicketSnapshot {
    this.byId.set(ticket.id, ticket);
    this.emit({ kind: "ticket", what, t: this.now(), ticket, auto });
    return ticket;
  }

  private fields(input: TicketInput): Partial<TicketSnapshot> {
    return {
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.status ? { status: input.status } : {}),
      ...(input.waitingFor === undefined ? {} : { waitingFor: input.waitingFor }),
      ...(input.dueInSeconds === undefined ? {} : { dueAt: this.now() + input.dueInSeconds }),
      ...(input.note === undefined ? {} : { note: input.note }),
    };
  }

  create(
    input: TicketInput & { readonly title: string },
    handoff?: string,
    auto = false,
  ): TicketSnapshot {
    const base: TicketSnapshot = {
      id: `t${this.byId.size + 1}`,
      title: input.title.trim(),
      status: "mine",
      ...(handoff ? { handoff } : {}),
    };
    return this.put({ ...base, ...this.fields(input) }, "created", auto);
  }

  update(id: string, input: TicketInput, auto = false): TicketSnapshot {
    const old = this.byId.get(id);
    if (!old)
      throw new InvalidValueError(
        `no ticket '${id}' (tickets: ${[...this.byId.keys()].join(", ") || "none"})`,
      );
    return this.put({ ...old, ...this.fields(input) }, "updated", auto);
  }

  list(status?: TicketStatus): TicketSnapshot[] {
    return [...this.byId.values()].filter((t) => status === undefined || t.status === status);
  }

  /** The ticket made for a hand-off, if the tools are on and one was made. */
  forHandoff(handoff: string): TicketSnapshot | undefined {
    return [...this.byId.values()].find((t) => t.handoff === handoff);
  }
}
