/**
 * The other side of `escalate` (REQ-093, ADR-0099, ADR-0100): a state machine in code, not a model. When the agent
 * hands a domain over, every fault that is in that domain at that moment gets a wait drawn from its kind's lead-time
 * range (docs/design-docs/lead-times.md) with the run's seed, and is gone after it. Faults that appear later are not in
 * the hand-off. Nothing here asks questions or says no, and the same seed with the same calls gives the same times.
 *
 * Each fault goes through `started` (the last stretch of the wait: an engineer arrives on site, or begins at the
 * console) and `done` (the fault is removed from the world, and a part that was changed leaves the equipment as new).
 */
import { SeededRng, withJosa } from "@terrarium/core/kernel";
import type { EscalateAnswer } from "@terrarium/core/tools";
import {
  type CounterpartEvent,
  clockAt,
  type Domain,
  domainInfo,
  type Fault,
  faultDomain,
  faultSpec,
  formatSpan,
  type HandedFault,
  type LeadTimeSettings,
  leadRange,
  resolveLeadSettings,
  roundLead,
  sampleLead,
  type World,
  workWindow,
} from "@terrarium/core/world";

/** An event as `Counterparts` makes it, before the log gives it its place. */
export type CounterpartDraft = CounterpartEvent extends infer E
  ? E extends CounterpartEvent
    ? Omit<E, "seq">
    : never
  : never;

export interface CounterpartDeps {
  readonly world: World;
  readonly seed: number;
  readonly settings: LeadTimeSettings | undefined;
  /** World time the agent got the task: the day and hour of the surcharge count from there. */
  readonly originT: () => number;
  readonly nameOf: (id: string) => string;
  readonly emit: (event: CounterpartDraft) => void;
  /** A hand-off has been made. */
  readonly onHanded?: (h: Handoff) => void;
  /** Every fault of a hand-off is gone. */
  readonly onFinished?: (h: Handoff) => void;
}

interface Job {
  readonly fault: Fault;
  readonly handed: HandedFault;
  started: boolean;
  done: boolean;
}

export interface Handoff {
  readonly id: string;
  readonly domain: Domain;
  readonly team: string;
  readonly at: number;
  readonly note?: string;
  readonly jobs: Job[];
}

const EPS = 1e-6;

const etaText = (s: number) => formatSpan(s);

/** Who is named on the equipment and in the events: the vendor when it comes with a part, else the domain's team. */
const whoText = (domain: Domain, who: "team" | "vendor") =>
  who === "vendor" ? "벤더" : domainInfo(domain).team;

export class Counterparts {
  private readonly handoffs: Handoff[] = [];

  constructor(private readonly deps: CounterpartDeps) {}

  all(): readonly Handoff[] {
    return this.handoffs;
  }

  /** The faults in a domain now, the wait of each, and the answer the agent reads. */
  escalate(domain: Domain, note: string | undefined): EscalateAnswer {
    const { world } = this.deps;
    const t = world.time();
    const info = domainInfo(domain);
    const faults = world.faults().filter((f) => faultDomain(f.type) === domain);
    const jobs = this.plan(faults, t);
    const handoff: Handoff = {
      id: `h${this.handoffs.length + 1}`,
      domain,
      team: info.team,
      at: t,
      ...(note ? { note } : {}),
      jobs,
    };
    this.handoffs.push(handoff);
    const handed = jobs.map((j) => j.handed);
    this.deps.emit({
      kind: "counterpart",
      what: "handed",
      t,
      handoff: handoff.id,
      domain,
      team: info.team,
      summary: `${info.team}에 넘겼어요 · ${handed.length > 0 ? `고장 ${handed.length}개` : "고장 없음"}`,
      ...(note ? { note } : {}),
      faults: handed,
    });
    this.deps.onHanded?.(handoff);
    if (jobs.length === 0) this.deps.onFinished?.(handoff);
    return this.answer(handoff);
  }

  /** Each fault's wait; faults on one piece of equipment are fixed in one visit, so they share the longest. */
  private plan(faults: readonly Fault[], t: number): Job[] {
    const { seed, settings, originT } = this.deps;
    const start = resolveLeadSettings(settings).start;
    const clock = clockAt(t, originT(), start);
    const root = new SeededRng(seed);
    const drawn = [...faults]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((fault) => {
        const range = leadRange(fault.type, settings, clock);
        const z = root.fork(`lead:${fault.id}`).gauss(0, 1);
        return { fault, range, lead: roundLead(sampleLead(range, () => z)) };
      });
    const longest = new Map<string, number>();
    for (const d of drawn)
      longest.set(d.fault.target, Math.max(longest.get(d.fault.target) ?? 0, d.lead));
    return drawn.map(({ fault, range }) => {
      const lead = longest.get(fault.target) as number;
      const work = workWindow(range.kind);
      const handed: HandedFault = {
        faultId: fault.id,
        faultType: fault.type,
        target: fault.target,
        etaSeconds: lead,
        doneAt: t + lead,
        startsAt: t + lead - Math.min(lead, work.seconds),
        kind: range.kind,
        onSite: work.onSite,
        who: range.who,
      };
      return { fault, handed, started: false, done: false };
    });
  }

  private answer(h: Handoff): EscalateAnswer {
    const etas = h.jobs.map((j) => etaText(j.handed.etaSeconds));
    const head = `${h.team}에 넘겼어요`;
    const message =
      h.jobs.length === 0
        ? `${head} · 지금 이 도메인에 고장이 없어요`
        : `${head} · 고장 ${h.jobs.length}개 · 예상 ${etas.join(" / ")}`;
    return {
      message,
      handoff: h.id,
      domain: h.domain,
      team: h.team,
      faults: h.jobs.map((j) => ({
        fault: j.fault.id,
        type: j.fault.type,
        target: j.fault.target,
        who: j.handed.who,
        eta: etaText(j.handed.etaSeconds),
        etaSeconds: j.handed.etaSeconds,
      })),
    };
  }

  /** The next moment something happens on the other side, after `now`; the session lands its steps on it. */
  nextWakeAt(now: number): number | undefined {
    let next: number | undefined;
    for (const h of this.handoffs)
      for (const j of h.jobs) {
        if (j.done) continue;
        const at = j.started ? j.handed.doneAt : j.handed.startsAt;
        if (at > now + EPS && (next === undefined || at < next)) next = at;
      }
    return next;
  }

  /** Do what is due at the world's time: arrivals first, then the faults that are gone. */
  tick(): void {
    const now = this.deps.world.time();
    for (const h of this.handoffs) {
      const open = h.jobs.filter((j) => !j.done);
      if (open.length === 0) continue;
      for (const j of open) {
        if (!j.started && now >= j.handed.startsAt - EPS) this.start(h, j);
        if (now >= j.handed.doneAt - EPS) this.finish(h, j);
      }
      if (h.jobs.every((j) => j.done)) this.deps.onFinished?.(h);
    }
  }

  private start(h: Handoff, j: Job): void {
    j.started = true;
    const name = this.deps.nameOf(j.handed.target);
    const who = whoText(h.domain, j.handed.who);
    const text = j.handed.onSite
      ? `${who} 기사가 ${name}에 도착했어요`
      : `${who}이 ${withJosa(name, "을")} 작업하기 시작했어요`;
    this.deps.emit({
      kind: "counterpart",
      what: "started",
      t: j.handed.startsAt,
      handoff: h.id,
      domain: h.domain,
      team: who,
      summary: text,
      fault: j.handed,
    });
  }

  private finish(h: Handoff, j: Job): void {
    const { world } = this.deps;
    j.done = true;
    const still = world.faults().some((f) => f.id === j.fault.id);
    if (still) {
      world.apply({ type: "fault.remove", faultId: j.fault.id }, `counterpart:${h.domain}`);
      if (j.handed.kind === "replace") restartIfShutDown(world, j.handed.target, h.domain);
    }
    const name = this.deps.nameOf(j.handed.target);
    const label = faultSpec(j.fault.type).label;
    const who = whoText(h.domain, j.handed.who);
    this.deps.emit({
      kind: "counterpart",
      what: "done",
      t: j.handed.doneAt,
      handoff: h.id,
      domain: h.domain,
      team: who,
      summary: still
        ? `${who}: ${name} ${label} 처리를 끝냈어요`
        : `${who}: ${name}에 가 보니 ${withJosa(label, "이")} 이미 없어졌어요`,
      fault: j.handed,
    });
  }
}

/**
 * A part was changed in a machine that had shut itself down (too hot) or been shut down by the fault: the engineer
 * switches it back on. A machine the agent itself switched off stays off: that was the agent's decision to undo.
 */
function restartIfShutDown(world: World, target: string, domain: Domain): void {
  const kind = world.index.find(target)?.kind;
  if (kind !== "server" && kind !== "switch" && kind !== "storage") return;
  const state = world.stateOf(target) as { adminOn?: boolean };
  if (state.adminOn !== false) return;
  const last = world
    .events()
    .filter(
      (e) =>
        (e.type === "power.set" || e.type === "thermal.shutdown") &&
        (e as { target: string }).target === target,
    )
    .at(-1);
  if (last?.type === "thermal.shutdown")
    world.apply({ type: "power.set", target, on: true }, `counterpart:${domain}`);
}
