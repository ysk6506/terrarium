/**
 * The line from a session to the person an agent can ask for help (ADR-0087 item 4): the `ask_human` call, the wait,
 * what a person does in the world meanwhile, and the answer that goes back as the tool's result. The session lends it
 * only what it needs to record a call, finish one and end the run (`LineHost`).
 */
import { createFacades } from "@terrarium/core/facades";
import { ConflictError, InvalidValueError } from "@terrarium/core/kernel";
import type { EndReason } from "@terrarium/core/oracle";
import { ACTION_LABELS, actionsOf, type ToolCallRecord } from "@terrarium/core/scenario";
import {
  type Args,
  TOOL_SPECS,
  Toolbox,
  type ToolContext,
  type ToolResult,
  type ToolSpec,
  toolSpec,
  validateArgs,
} from "@terrarium/core/tools";
import type { World, WorldPort } from "@terrarium/core/world";
import {
  DEFAULT_ESCALATION,
  type EscalationPolicy,
  type HumanAct,
  HumanDesk,
  type HumanRequest,
  type HumanResolution,
} from "./human";
import type { MetricRecorder } from "./recorder";
import type { RunLog } from "./run-events";
import type { CallResult } from "./types";

/** The cause a person's changes carry in the world's record, so scoring never counts them as the agent's. */
export const HUMAN_CAUSE = "human";

/** What a person may do in the world while the run waits: every tool that changes it, except asking again. */
export const HUMAN_TOOLS: readonly string[] = TOOL_SPECS.filter(
  (t) => t.mutating && t.name !== "ask_human",
).map((t) => t.name);

/** A world that records every command as the person's. */
function asHuman(world: World): WorldPort {
  return new Proxy(world, {
    get(target, prop) {
      if (prop === "apply")
        return (command: Parameters<World["apply"]>[0]) => target.apply(command, HUMAN_CAUSE);
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as WorldPort;
}

/** What the line needs of the session it belongs to. */
export interface LineHost {
  readonly world: World;
  readonly toolbox: Toolbox;
  readonly recorder: MetricRecorder;
  readonly log: RunLog;
  readonly profiles: { readonly vcenter?: string; readonly vrops?: string } | undefined;
  calls(): readonly ToolCallRecord[];
  /** Write a finished call into the record. */
  record(tool: string, args: Args, result: ToolResult, t: number, before: number): void;
  /** A call is done: record it, let time move on, end the run if it was the last. */
  conclude(tool: string, args: Args, result: ToolResult, t: number, before: number): CallResult;
  end(reason: EndReason): void;
}

type Answer = "reply" | "acted" | "more_tools" | "end";

export class HumanLine {
  readonly desk: HumanDesk;
  /** Wall-clock seconds people kept a realtime run waiting; simulated time does not follow them. */
  pausedSeconds = 0;
  /** The `ask_human` call the run waits on. */
  private asking: { readonly args: Args; readonly t: number } | undefined;
  private handsOf: { readonly toolbox: Toolbox; readonly ctx: ToolContext } | undefined;

  constructor(
    private readonly host: LineHost,
    policy: EscalationPolicy = DEFAULT_ESCALATION,
  ) {
    this.desk = new HumanDesk(policy);
  }

  /** The request a person is asked to answer right now. */
  get waiting(): HumanRequest | undefined {
    return this.desk.waiting;
  }

  /** The agent's last five calls, for the person who is asked. */
  private recentCalls(): HumanRequest["recent"] {
    return this.host
      .calls()
      .slice(-5)
      .map((c) => ({
        tool: c.tool,
        ok: c.ok,
        summary: c.ok
          ? (c.effects ?? []).map((e) => `${e.target} ${ACTION_LABELS[e.action]}`).join(", ")
          : (c.error ?? "실패했어요"),
      }));
  }

  private answered(
    by: "human" | "auto" | "none",
    answer: Answer,
    waitedSeconds: number,
    extra: { readonly reply?: string; readonly tools?: readonly string[] } = {},
  ): void {
    this.host.log.human({
      kind: "human",
      what: "answered",
      t: this.host.world.time(),
      by,
      answer,
      waitedSeconds,
      ...(extra.reply === undefined ? {} : { reply: extra.reply }),
      ...(extra.tools ? { tools: extra.tools } : {}),
    });
  }

  /** `ask_human`: answered at once by the setup, ends the run, or stops it until a person answers. */
  ask(args: Args, t: number): CallResult {
    const { host } = this;
    const before = host.world.lastSeq();
    const problems = validateArgs((toolSpec("ask_human") as ToolSpec).inputSchema, args);
    if (problems.length > 0)
      return host.conclude("ask_human", args, { ok: false, error: problems.join("; ") }, t, before);
    this.desk.count++;
    const request: HumanRequest = { t, request: String(args.request), recent: this.recentCalls() };
    host.log.human({
      kind: "human",
      what: "asked",
      t,
      request: request.request,
      recent: request.recent,
    });
    const { mode, reply } = this.desk.policy;
    if (mode === "wait") {
      this.desk.begin(request);
      this.asking = { args, t };
      return { ok: true, t, waiting: request };
    }
    if (mode === "auto") {
      const text = reply ?? DEFAULT_ESCALATION.reply ?? "";
      this.answered("auto", "reply", 0, { reply: text });
      const result = { ok: true, data: { reply: text, from: "auto" } };
      return host.conclude("ask_human", args, result, t, before);
    }
    const error = "이 실험에서는 사람에게 넘기면 실패로 끝나요";
    this.answered("none", "end", 0, { reply: error });
    host.record("ask_human", args, { ok: false, error }, t, before);
    host.end("escalated");
    return { ok: false, t, error, ended: "escalated" };
  }

  /** The tools a person can do things with while the run waits (the same ones an agent has, as a person's hands). */
  private hands(): { readonly toolbox: Toolbox; readonly ctx: ToolContext } {
    if (!this.handsOf) {
      const port = asHuman(this.host.world);
      this.handsOf = {
        toolbox: new Toolbox(HUMAN_TOOLS),
        ctx: {
          world: port,
          facades: createFacades(port, this.host.profiles),
          metrics: this.host.recorder,
        },
      };
    }
    return this.handsOf;
  }

  /**
   * A person changes the world for the agent while the run waits ("대신 조치하기"): the same operations an agent
   * has, recorded as the person's and never scored as the agent's. Returns what it changed.
   */
  act(tool: string, args: Args): HumanAct {
    const { world, log } = this.host;
    if (!this.desk.waiting) throw new ConflictError("no one is waiting for a person");
    if (!HUMAN_TOOLS.includes(tool))
      throw new InvalidValueError(
        `'${tool}' does not change the world, so there is nothing to do with it`,
      );
    const { toolbox, ctx } = this.hands();
    const before = world.lastSeq();
    const t = world.time();
    const result = toolbox.call(tool, args, ctx);
    const changed = actionsOf(world.events(before), (id, end) => {
      const link = world.index.link(id);
      return end === "from" ? link.from : link.to;
    }).map((e) => `${world.index.find(e.target)?.name ?? e.target} ${ACTION_LABELS[e.action]}`);
    const summary = result.ok
      ? changed.join(", ") || "바뀐 것이 없어요"
      : (result.error ?? "실패했어요");
    const act: HumanAct = { t, tool, args, ok: result.ok, summary };
    this.desk.acts.push(act);
    log.human({ kind: "human", what: "acted", t, tool, args, ok: act.ok, summary });
    return act;
  }

  /** What went back to the agent, by how the person answered. */
  private reply(r: HumanResolution, acts: readonly HumanAct[]): ToolResult {
    if (r.kind === "reply") return { ok: true, data: { reply: r.text, from: "human" } };
    if (r.kind === "more_tools") {
      const added = this.host.toolbox.grant(r.tools);
      this.desk.granted.push(...added);
      return {
        ok: true,
        data: {
          reply: `툴을 더 받았어요: ${added.join(", ") || "(이미 가진 툴)"}. 이어서 하세요.`,
          from: "human",
          newTools: added,
        },
      };
    }
    return {
      ok: true,
      data: {
        reply:
          acts.length > 0
            ? "사람이 직접 조치했어요. 상태를 다시 확인하고 이어서 하세요."
            : "사람이 확인했지만 바꾼 것은 없어요.",
        from: "human",
        changes: acts.map((a) => a.summary),
      },
    };
  }

  /**
   * The person has answered: the call the agent was waiting on gets its result, and the run goes on (or ends, when
   * the person ended it). `waitedSeconds` is the wall-clock time the host measured; the session cannot read the clock.
   */
  resolve(r: HumanResolution): CallResult {
    const asking = this.asking;
    const { host } = this;
    if (!asking || !this.desk.waiting) throw new ConflictError("no one is waiting for a person");
    const waited = Math.max(0, r.waitedSeconds ?? 0);
    const acts = this.desk.actsWhileWaiting();
    this.desk.end(waited);
    this.pausedSeconds += waited;
    this.asking = undefined;
    const before = host.world.lastSeq();
    if (r.kind === "end") {
      const error = "사람이 이 실행을 끝냈어요";
      this.answered("human", "end", waited, { reply: error });
      host.record("ask_human", asking.args, { ok: false, error }, asking.t, before);
      host.end("escalated");
      return { ok: false, t: asking.t, error, ended: "escalated" };
    }
    const result = this.reply(r, acts);
    this.answered("human", r.kind, waited, {
      reply: (result.data as { reply: string }).reply,
      ...(r.kind === "more_tools" ? { tools: r.tools } : {}),
    });
    return host.conclude("ask_human", asking.args, result, asking.t, before);
  }

  /** A run that ends while a person is being waited for: the question is recorded as unanswered. */
  abandon(): void {
    const asking = this.asking;
    if (!asking || !this.desk.waiting) return;
    this.asking = undefined;
    this.desk.end(0);
    this.answered("none", "end", 0);
    this.host.record(
      "ask_human",
      asking.args,
      { ok: false, error: "the run ended while waiting for a person" },
      asking.t,
      this.host.world.lastSeq(),
    );
  }
}
