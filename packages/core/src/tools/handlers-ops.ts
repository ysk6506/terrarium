/**
 * The handlers of handing work over and keeping track of it (REQ-093, ADR-0098, ADR-0100): `escalate`,
 * `events_since` and the three ticket tools. They hold no state; the session does, behind `OpsPort`, so a replay
 * of the same calls with the same seed gives the same answers.
 */
import { InvalidValueError } from "@terrarium/core/kernel";
import {
  type Domain,
  domainChoices,
  parseDomain,
  type TicketSnapshot,
  type TicketStatus,
} from "@terrarium/core/world";
import type { Args, ToolContext } from "./handlers";

/** What `escalate` answers: which team has it, and when each fault will be gone. */
export interface EscalateAnswer {
  readonly message: string;
  readonly handoff: string;
  readonly domain: Domain;
  readonly team: string;
  readonly faults: ReadonlyArray<{
    readonly fault: string;
    readonly type: string;
    readonly target: string;
    readonly who: "team" | "vendor";
    readonly eta: string;
    readonly etaSeconds: number;
  }>;
}

/** One thing that happened on the other side or in the world, as the agent reads it. */
export interface VisibleEvent {
  readonly t: number;
  readonly type: string;
  readonly text: string;
  readonly entity?: string;
  readonly handoff?: string;
  readonly [key: string]: unknown;
}

export interface TicketInput {
  readonly title?: string;
  readonly status?: TicketStatus;
  readonly waitingFor?: string;
  /** Seconds from now by which it is due. */
  readonly dueInSeconds?: number;
  readonly note?: string;
}

/** What the session offers the handlers; absent in a bare tool context (a unit test of another tool). */
export interface OpsPort {
  escalate(domain: Domain, note: string | undefined): EscalateAnswer;
  /** The events after position `cursor`, and the position to ask from next time. */
  eventsSince(cursor: number): {
    readonly cursor: number;
    readonly events: readonly VisibleEvent[];
  };
  createTicket(input: TicketInput & { readonly title: string }): TicketSnapshot;
  updateTicket(id: string, input: TicketInput): TicketSnapshot;
  listTickets(status: TicketStatus | undefined): readonly TicketSnapshot[];
}

type Handler = (ctx: ToolContext, args: Args) => unknown;

const ops = (ctx: ToolContext): OpsPort => {
  if (!ctx.ops) throw new InvalidValueError("this session cannot hand work over");
  return ctx.ops;
};

function statusOf(args: Args): TicketStatus | undefined {
  if (args.status === undefined) return undefined;
  return String(args.status) as TicketStatus;
}

function inputOf(args: Args): TicketInput {
  const status = statusOf(args);
  return {
    ...(args.title === undefined ? {} : { title: String(args.title) }),
    ...(status ? { status } : {}),
    ...(args.waitingFor === undefined ? {} : { waitingFor: String(args.waitingFor) }),
    ...(typeof args.dueInSeconds === "number" ? { dueInSeconds: args.dueInSeconds } : {}),
    ...(args.note === undefined ? {} : { note: String(args.note) }),
  };
}

const escalate: Handler = (ctx, args) => {
  const domain = parseDomain(args.domain);
  if (!domain) throw new InvalidValueError(`가능한 도메인: ${domainChoices()}`);
  return ops(ctx).escalate(domain, args.note === undefined ? undefined : String(args.note));
};

const eventsSince: Handler = (ctx, args) => {
  const cursor = typeof args.cursor === "number" ? Math.max(0, Math.floor(args.cursor)) : 0;
  return ops(ctx).eventsSince(cursor);
};

const createTicket: Handler = (ctx, args) => {
  const input = inputOf(args);
  if (!input.title || input.title.trim() === "") throw new InvalidValueError("title is required");
  return ops(ctx).createTicket({ ...input, title: input.title });
};

const updateTicket: Handler = (ctx, args) => ops(ctx).updateTicket(String(args.id), inputOf(args));

const listTickets: Handler = (ctx, args) => ops(ctx).listTickets(statusOf(args));

export const OPS_HANDLERS: Readonly<Record<string, Handler>> = {
  escalate,
  events_since: eventsSince,
  create_ticket: createTicket,
  update_ticket: updateTicket,
  list_tickets: listTickets,
};
