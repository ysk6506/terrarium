/**
 * The person an agent can ask for help with `ask_human` (ADR-0087 item 4). What the experiment decided about
 * escalation is the policy:
 *
 *   wait   the run stops until a person answers (simulated time stands still; the wall-clock wait is recorded)
 *   auto   the setup answers at once with a fixed text
 *   fail   asking ends the run as failed
 *
 * The desk keeps what the result shows apart from the score: how many times the agent asked, how long people kept
 * it waiting, and what they did in the world meanwhile.
 */
import type { RecentCall } from "@terrarium/core/world";

export type EscalationMode = "wait" | "auto" | "fail";

export interface EscalationPolicy {
  readonly mode: EscalationMode;
  /** The fixed answer of `auto`. */
  readonly reply?: string;
}

export const DEFAULT_AUTO_REPLY =
  "지금은 사람이 도와줄 수 없어요. 가진 툴로 할 수 있는 만큼 하고 진단을 제출하세요.";

/** The default: nobody sits at the other end, so asking gets a fixed answer and the run goes on. */
export const DEFAULT_ESCALATION: EscalationPolicy = { mode: "auto", reply: DEFAULT_AUTO_REPLY };

export const ESCALATION_LABELS: Readonly<Record<EscalationMode, string>> = {
  wait: "사람이 답할 때까지 기다림",
  auto: "정해 둔 답으로 자동 응답",
  fail: "실패로 끝냄",
};

/** What a person sees when the run waits for them. */
export interface HumanRequest {
  /** World time the agent asked at. */
  readonly t: number;
  readonly request: string;
  /** The agent's last five calls, newest last. */
  readonly recent: readonly RecentCall[];
}

/** How a person answers; `waitedSeconds` is the wall-clock time the run waited, which only the host can measure. */
export type HumanResolution =
  | { readonly kind: "reply"; readonly text: string; readonly waitedSeconds?: number }
  | { readonly kind: "acted"; readonly waitedSeconds?: number }
  | {
      readonly kind: "more_tools";
      readonly tools: readonly string[];
      readonly waitedSeconds?: number;
    }
  | { readonly kind: "end"; readonly waitedSeconds?: number };

/** One thing a person did in the world while the run waited. */
export interface HumanAct {
  readonly t: number;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly ok: boolean;
  /** What it changed, in words. */
  readonly summary: string;
}

/** Escalation as the result shows it, apart from the score. */
export interface HumanSummary {
  readonly mode: EscalationMode;
  /** How many times the agent asked. */
  readonly count: number;
  /** Wall-clock seconds people kept the run waiting. */
  readonly waitedSeconds: number;
  /** What people did in the world for the agent. */
  readonly acts: readonly HumanAct[];
  /** Tools people handed over in the middle of the run. */
  readonly granted: readonly string[];
}

export class HumanDesk {
  count = 0;
  waited = 0;
  readonly acts: HumanAct[] = [];
  readonly granted: string[] = [];
  private open: { request: HumanRequest; acts: number } | undefined;

  constructor(readonly policy: EscalationPolicy) {}

  get waiting(): HumanRequest | undefined {
    return this.open?.request;
  }

  /** The agent has asked and the run now waits for a person. */
  begin(request: HumanRequest): void {
    this.open = { request, acts: this.acts.length };
  }

  /** What people did since the run began to wait. */
  actsWhileWaiting(): readonly HumanAct[] {
    return this.acts.slice(this.open?.acts ?? this.acts.length);
  }

  /** The person has answered; returns the request that was open. */
  end(waitedSeconds: number): HumanRequest | undefined {
    const request = this.open?.request;
    this.open = undefined;
    this.waited += waitedSeconds;
    return request;
  }

  summary(): HumanSummary {
    return {
      mode: this.policy.mode,
      count: this.count,
      waitedSeconds: Math.round(this.waited * 10) / 10,
      acts: this.acts,
      granted: this.granted,
    };
  }
}
