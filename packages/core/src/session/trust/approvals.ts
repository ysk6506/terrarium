/**
 * Approval of an action (REQ-124, ADR-0203): the agent asks with `request_approval`, a code approver answers after a wait
 * in world time, an approval becomes a permit, and the gate lets a call through only on a permit that fits. The state is
 * a handful of requests and permits; every fact that matters is written into the run's events as it happens, so the
 * record alone tells the story and the session's own state is never read back by the rules.
 *
 * The wait is the approval row of the lead-time table, drawn the way a hand-off's wait is (the run's seed, one fork per
 * request, ten-minute steps), so the same situation gets the same answer at the same moment.
 */
import { InvalidValueError, SeededRng } from "@terrarium/core/kernel";
import { callTargets, isWorldAction, toolSpec } from "@terrarium/core/tools";
import {
  type ApprovalEvent,
  approvalRange,
  clockAt,
  type LeadTimeSettings,
  resolveLeadSettings,
  roundLead,
  type RunEvent,
  sampleLead,
  type ToolEvent,
  type World,
} from "@terrarium/core/world";
import { judge, type Verdict } from "./approver";
import { approvalNeededAnswer, type Gate } from "./gate";
import { type ApprovalConfig, permitSecondsOf } from "./model";
import { serviceReach } from "./reach";

/** An approval event as the approvals make it, before the log gives it its place. */
export type ApprovalDraft = ApprovalEvent extends infer E
  ? E extends ApprovalEvent
    ? Omit<E, "seq">
    : never
  : never;

export interface ApprovalDeps {
  readonly world: World;
  readonly config: ApprovalConfig;
  readonly seed: number;
  readonly leadTimes: LeadTimeSettings | undefined;
  /** World time the agent got the task: the day and hour of the wait count from there. */
  readonly originT: () => number;
  /** Whether the agent has this tool. */
  readonly has: (tool: string) => boolean;
  /** The run's record so far: what the agent looked at before it asked. */
  readonly events: () => readonly RunEvent[];
  readonly emit: (event: ApprovalDraft) => void;
}

interface Pending {
  readonly id: string;
  readonly tool: string;
  readonly target: string;
  readonly requestedAt: number;
  readonly dueAt: number;
  readonly verdict: Verdict;
}

interface Permit {
  readonly request: string;
  readonly tool: string;
  readonly target: string;
  readonly expiresAt: number;
  used: boolean;
}

const EPS = 1e-6;

/** What `request_approval` answers. */
export interface RequestAnswer {
  readonly request: string;
  readonly status: "waiting" | "approved";
  readonly message: string;
}

export class Approvals {
  private count = 0;
  private readonly pending: Pending[] = [];
  private readonly permits: Permit[] = [];

  constructor(private readonly d: ApprovalDeps) {}

  /** The agent asks for an approval of `tool` on `target` (empty for a call that names no equipment). */
  request(tool: string, target: string, reason: string): RequestAnswer {
    const { world, has } = this.d;
    if (!has(tool)) throw new InvalidValueError(`tool '${tool}' is not available in this experiment`);
    if (toolSpec(tool)?.mutating !== true)
      throw new InvalidValueError(`'${tool}' does not change the world, so it needs no approval`);
    if (target !== "" && !world.index.find(target))
      throw new InvalidValueError(`'${target}' is not equipment of this world`);
    const waiting = this.pending.find((p) => p.tool === tool && p.target === target);
    if (waiting)
      return {
        request: waiting.id,
        status: "waiting",
        message: `같은 요청이 이미 기다리고 있어요(요청 ${waiting.id}). 새로 만들지 않았어요. 답은 사건으로 와요.`,
      };
    const held = this.permits.find(
      (p) => p.tool === tool && p.target === target && !p.used && world.time() <= p.expiresAt,
    );
    if (held)
      return {
        request: held.request,
        status: "approved",
        message: `이미 승인된 요청이 있어요(요청 ${held.request}). 새로 만들지 않았어요. 성공한 호출 한 번에 쓸 수 있어요.`,
      };
    const id = `a${++this.count}`;
    const t = world.time();
    const lead = this.lead(id, t);
    this.pending.push({
      id,
      tool,
      target,
      requestedAt: t,
      dueAt: t + lead,
      verdict: judge(this.d.config.approver, target, this.calls()),
    });
    this.d.emit({ kind: "approval", what: "requested", t, request: id, tool, target, reason });
    return {
      request: id,
      status: "waiting",
      message: `승인을 요청했어요(요청 ${id}). 답은 사건으로 와요. events_since나 wait로 확인해요.`,
    };
  }

  /** How long the answer takes: the experiment's fixed time, or a draw from the approval row. */
  private lead(id: string, t: number): number {
    const { config, seed, leadTimes, originT } = this.d;
    if (config.leadSeconds !== undefined) return config.leadSeconds;
    const clock = clockAt(t, originT(), resolveLeadSettings(leadTimes).start);
    const z = new SeededRng(seed).fork(`approval:${id}`).gauss(0, 1);
    return roundLead(sampleLead(approvalRange(leadTimes, clock), () => z));
  }

  private calls(): ToolEvent[] {
    return this.d.events().filter((e): e is ToolEvent => e.kind === "tool");
  }

  /** The next moment an answer is due, after `now`; the session lands its steps on it. */
  nextWakeAt(now: number): number | undefined {
    const due = this.pending.map((p) => p.dueAt).filter((at) => at > now + EPS);
    return due.length === 0 ? undefined : Math.min(...due);
  }

  /** Answer what is due at the world's time; an approval gives a permit from the moment of the answer. */
  tick(): void {
    const now = this.d.world.time();
    const due = this.pending
      .filter((p) => p.dueAt <= now + EPS)
      .sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id));
    for (const p of due) {
      this.pending.splice(this.pending.indexOf(p), 1);
      const { verdict } = p;
      const expiresAt = p.dueAt + permitSecondsOf(this.d.config);
      if (verdict.decision === "approved")
        this.permits.push({ request: p.id, tool: p.tool, target: p.target, expiresAt, used: false });
      this.d.emit({
        kind: "approval",
        what: "answered",
        t: p.dueAt,
        request: p.id,
        tool: p.tool,
        target: p.target,
        decision: verdict.decision,
        by: this.d.config.approver,
        because: verdict.because,
        checked: verdict.checked,
        missing: verdict.missing,
        waitedSeconds: p.dueAt - p.requestedAt,
        ...(verdict.decision === "approved" ? { permit: { expiresAt } } : {}),
      });
    }
  }

  /**
   * The targets of a call that need an approval under the rule. Every target of a change when the rule is `all`; under
   * `service_reach` the ones that reach a service that is well now, and the ones that cannot be judged: a call that
   * names no equipment (`""`), or equipment this world does not have. What cannot be judged needs an approval, the safe side.
   */
  private needs(targets: readonly string[]): string[] {
    if (targets.length === 0) return [""];
    if (this.d.config.rule === "all") return [...targets];
    return targets.filter((t) => serviceReach({ world: this.d.world }, t) !== "clear");
  }

  /** The gate's decision on a call at `t`: nothing when it needs no approval, the permits it goes through on, or a stop. */
  check(tool: string, args: Readonly<Record<string, unknown>>, t: number): Gate | undefined {
    if (!isWorldAction(tool, args)) return undefined;
    const needed = this.needs(callTargets(tool, args));
    if (needed.length === 0) return undefined;
    const used: string[] = [];
    for (const target of needed) {
      const permit = this.permits.find(
        (p) => !p.used && p.tool === tool && p.target === target && t <= p.expiresAt,
      );
      if (!permit) return this.stop(tool, target, t);
      used.push(permit.request);
    }
    return { permits: used };
  }

  /** Why no permit fits: the closest one that does not, in the order of how much of it matched. */
  private stop(tool: string, target: string, t: number): Gate {
    const same = this.permits.filter((p) => p.tool === tool && p.target === target);
    const open = this.permits.filter((p) => !p.used && t <= p.expiresAt);
    const why = same.some((p) => p.used)
      ? "used"
      : same.some((p) => t > p.expiresAt)
        ? "expired"
        : open.some((p) => p.tool === tool)
          ? "other_target"
          : open.some((p) => p.target === target)
            ? "other_tool"
            : "no_permit";
    const { rule } = this.d.config;
    return {
      stop: approvalNeededAnswer(why, rule, permitSecondsOf(this.d.config), this.d.has),
      blocked: why,
      permits: [],
    };
  }

  /** A call went through on these approvals and succeeded: each is used up. */
  use(requests: readonly string[]): void {
    for (const p of this.permits) if (requests.includes(p.request)) p.used = true;
  }
}
