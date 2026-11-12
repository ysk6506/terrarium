/**
 * Runs that wait for a person (ADR-0087 item 4). When an agent calls `ask_human` and the experiment's escalation is
 * "wait", the session stops (simulated time too) and the executor parks the call here. The card on the home and
 * experiment screens lists what is parked; a person answers, does something in the world for the agent, hands over
 * more tools, or ends the run. The wall-clock wait is measured here, because only the host can read the clock.
 */
import type { EscalationAnswerRequest, EscalationCard } from "@terrarium/core/contract";
import { NotFoundError, wallClockMs } from "@terrarium/core/kernel";
import type { CallResult, HumanAct, HumanResolution } from "@terrarium/core/session";
import { TOOL_SPECS } from "@terrarium/core/tools";
import type { Viewer } from "./context";
import type { HostedSession } from "./hosts";
import { allow } from "./permissions";

type Card = Omit<EscalationCard, "tools" | "grantable" | "acts">;

interface Parked {
  readonly card: Card;
  readonly session: HostedSession;
  readonly startedMs: number;
  readonly acts: HumanAct[];
  readonly settle: (resolution: HumanResolution) => void;
}

/** What `hold` reports back to the executor besides the call's result. */
export interface Held {
  readonly result: CallResult;
  /** Wall-clock milliseconds the run waited (the executor does not count them against the agent's time). */
  readonly waitedMs: number;
}

export class Escalations {
  private readonly parked = new Map<string, Parked>();

  get size(): number {
    return this.parked.size;
  }

  private cardOf(p: Parked): EscalationCard {
    const have = new Set(p.session.specs.map((s) => s.name));
    return {
      ...p.card,
      tools: [...have],
      grantable: TOOL_SPECS.filter((t) => !have.has(t.name)).map((t) => ({
        name: t.name,
        title: t.title,
      })),
      acts: p.acts,
    };
  }

  /** The runs that wait for a person now, oldest first. */
  list(): EscalationCard[] {
    return [...this.parked.values()]
      .sort((a, b) => a.startedMs - b.startedMs)
      .map((p) => this.cardOf(p));
  }

  /**
   * Park a run's `ask_human` call until a person answers. Stopping the run from outside (`signal`) ends the wait
   * as if the person had ended it.
   */
  async hold(card: Card, session: HostedSession, signal: AbortSignal): Promise<Held> {
    const startedMs = wallClockMs();
    const resolution = await new Promise<HumanResolution>((resolve) => {
      const settle = (r: HumanResolution) => {
        signal.removeEventListener("abort", onAbort);
        resolve(r);
      };
      const onAbort = () => settle({ kind: "end" });
      this.parked.set(card.runId, { card, session, startedMs, acts: [], settle });
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    this.parked.delete(card.runId);
    const waitedMs = wallClockMs() - startedMs;
    const result = await session.resolveHuman({
      ...resolution,
      waitedSeconds: Math.round(waitedMs) / 1000,
    });
    return { result, waitedMs };
  }

  /** A person answers. `act` does one thing in the world and keeps the run waiting; the others end the wait. */
  async answer(
    viewer: Viewer,
    runId: string,
    answer: EscalationAnswerRequest,
  ): Promise<EscalationCard | undefined> {
    const p = this.parked.get(runId);
    if (!p) throw new NotFoundError("이 실행은 지금 사람을 기다리고 있지 않아요");
    allow(viewer, "answerEscalation", { owner: p.card.owner }, "넘긴 일에 답하기");
    if (answer.kind === "act") {
      p.acts.push(await p.session.humanAct(answer.tool, answer.args));
      return this.cardOf(p);
    }
    p.settle(
      answer.kind === "reply"
        ? { kind: "reply", text: answer.text }
        : answer.kind === "more_tools"
          ? { kind: "more_tools", tools: answer.tools }
          : { kind: answer.kind },
    );
    return undefined;
  }
}
