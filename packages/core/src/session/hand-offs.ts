/**
 * Everything of a session that has to do with handing work to other teams (REQ-093): the teams (`Counterparts`), the
 * agent's tickets (`Tickets`) and what the tools see of both (`OpsPort`). The session builds one, asks it for the
 * next moment something happens on the other side, and lets it act after each step of time.
 */
import type { OpsPort } from "@terrarium/core/tools";
import {
  type Domain,
  describeLeadSettings,
  type LeadTimeSettings,
  resolveLeadSettings,
  type World,
} from "@terrarium/core/world";
import { Counterparts } from "./counterparts";
import { visibleSince } from "./ops";
import type { RunLog } from "./run-events";
import { Tickets } from "./tickets";

export interface HandOffsDeps {
  readonly world: World;
  readonly log: RunLog;
  readonly seed: number;
  readonly leadTimes: LeadTimeSettings | undefined;
  /** World time the agent got the task. */
  readonly originT: () => number;
  /** Whether the ticket tools are on: only then does a hand-off make a ticket by itself. */
  readonly ticketsOn: () => boolean;
}

export class HandOffs {
  private readonly counterparts: Counterparts;
  private readonly tickets: Tickets;
  readonly port: OpsPort;

  constructor(readonly deps: HandOffsDeps) {
    const { world, log } = deps;
    const nameOf = (id: string) => world.index.find(id)?.name ?? id;
    this.tickets = new Tickets(
      (e) => log.ticket(e),
      () => world.time(),
    );
    this.counterparts = new Counterparts({
      world,
      seed: deps.seed,
      settings: deps.leadTimes,
      originT: deps.originT,
      nameOf,
      emit: (e) => log.counterpart(e),
      onHanded: (h) => {
        if (h.jobs.length === 0 || !deps.ticketsOn()) return;
        const longest = Math.max(...h.jobs.map((j) => j.handed.etaSeconds));
        this.tickets.create(
          {
            title: `${h.team}에 넘긴 일`,
            status: "waiting",
            waitingFor: h.team,
            dueInSeconds: longest,
          },
          h.id,
          true,
        );
      },
      onFinished: (h) => {
        const ticket = this.tickets.forHandoff(h.id);
        if (ticket?.status === "waiting")
          this.tickets.update(
            ticket.id,
            { status: "mine", note: `${h.team}이 끝냈어요. 임시로 해 둔 일이 있으면 되돌려요` },
            true,
          );
      },
    });
    this.port = {
      escalate: (domain, note) => this.counterparts.escalate(domain, note),
      eventsSince: (cursor) => {
        log.flush();
        return visibleSince(log.events, cursor, nameOf);
      },
      createTicket: (input) => this.tickets.create(input),
      updateTicket: (id, input) => this.tickets.update(id, input),
      listTickets: (status) => this.tickets.list(status),
    };
  }

  /** The next moment something happens on the other side, after `now`. */
  nextWakeAt(now: number): number | undefined {
    return this.counterparts.nextWakeAt(now);
  }

  /** Do what is due at the world's time. */
  tick(): void {
    this.counterparts.tick();
  }
}

/** What a result says about the scope of a run: its domains and the waits, when either was set. */
export function scopeOf(
  domains: readonly Domain[] | undefined,
  leadTimes: LeadTimeSettings | undefined,
) {
  const mine = domains ?? [];
  if (mine.length === 0 && !leadTimes) return {};
  return {
    scope: {
      domains: mine,
      leadTimes: resolveLeadSettings(leadTimes),
      leadTimesLabel: describeLeadSettings(leadTimes),
    },
  };
}
