/**
 * What an operation run is set up with (REQ-090, ADR-0094): how long the world runs, how time moves, where the faults
 * come from, and what the agent is told. Plain data, so it crosses the thread boundary with the session config.
 */
import type { FaultType } from "@terrarium/core/world";

/** "실시간": world time equals real time (the official score). "빨리 감기": quiet stretches run 10-60x faster. */
export type Pace =
  | { readonly mode: "realtime" }
  | { readonly mode: "fast"; readonly speed: number };

export const FAST_SPEED_MIN = 10;
export const FAST_SPEED_MAX = 60;

/** How busy the world is; each preset scales every fault rate of the table. */
export type OperationPreset = "quiet" | "normal" | "busy";

export const PRESET_SCALE: Readonly<Record<OperationPreset, number>> = {
  quiet: 0.3,
  normal: 1,
  busy: 3,
};

export const PRESET_LABELS: Readonly<Record<OperationPreset, string>> = {
  quiet: "조용함",
  normal: "보통",
  busy: "바쁨",
};

/** One fault to inject when a scenario of a set is played inside the operation. */
export interface FaultTemplate {
  readonly type: FaultType;
  readonly target: string;
  readonly params?: Readonly<Record<string, number>>;
}

export type FaultSource =
  /** Random faults from the failure-rate table, scaled by the preset. */
  | { readonly kind: "preset"; readonly preset: OperationPreset }
  /** The faults of a set of scenarios, each once, in random order within the hours. */
  | { readonly kind: "set"; readonly faults: readonly FaultTemplate[] };

/** What the experiment stops at (ADR-0094 item 8): the run ends and says so when a limit is passed. */
export interface OperationBudget {
  readonly maxToolCalls?: number;
  readonly maxTokens?: number;
  readonly maxCostUsd?: number;
}

export interface OperationConfig {
  /** World hours the operation lasts (8, 24, 48 ...). */
  readonly hours: number;
  readonly pace: Pace;
  readonly source: FaultSource;
  /** Multiplies every rate on top of the preset (1 = as the table says); a small world needs more to see incidents. */
  readonly rateScale?: number;
  /** Chance (0-1) that a fault brings another one close by within minutes. */
  readonly cascadeChance: number;
  /** Chance (0-1) that another fault starts at the same moment. */
  readonly simultaneousChance: number;
  /** Push a summary of every new alarm to the harness (an experiment variable; off by default). */
  readonly wakeOnAlarm: boolean;
  /** What the agent is told to do over the shift (the operation instruction). */
  readonly instruction: string;
  readonly budget?: OperationBudget;
}

export const DEFAULT_OPERATION: OperationConfig = {
  hours: 8,
  pace: { mode: "realtime" },
  source: { kind: "preset", preset: "normal" },
  cascadeChance: 0.1,
  simultaneousChance: 0.05,
  wakeOnAlarm: false,
  instruction: "",
};

/** Why a config cannot be run, or undefined when it can. */
export function operationProblem(c: OperationConfig): string | undefined {
  if (!(c.hours > 0 && c.hours <= 96)) return "운영 시간은 1시간에서 96시간 사이여야 해요";
  if (c.pace.mode === "fast" && !(c.pace.speed >= FAST_SPEED_MIN && c.pace.speed <= FAST_SPEED_MAX))
    return `빨리 감기는 ${FAST_SPEED_MIN}배에서 ${FAST_SPEED_MAX}배 사이여야 해요`;
  if (c.cascadeChance < 0 || c.cascadeChance > 1) return "연쇄 고장 확률은 0에서 1 사이여야 해요";
  if (c.simultaneousChance < 0 || c.simultaneousChance > 1)
    return "동시 고장 확률은 0에서 1 사이여야 해요";
  if (c.source.kind === "set" && c.source.faults.length === 0)
    return "시나리오 세트에 넣을 고장이 없어요";
  return undefined;
}

/** What makes two operations the same task: everything but the instruction and the limits the agent is held to. */
export function operationKey(c: OperationConfig): Record<string, unknown> {
  return {
    hours: c.hours,
    pace: c.pace,
    source: c.source,
    rateScale: c.rateScale ?? 1,
    cascade: c.cascadeChance,
    simultaneous: c.simultaneousChance,
  };
}

/** The label a result and a benchmark key carry for how time moved. */
export function paceLabel(p: Pace): string {
  return p.mode === "realtime" ? "실시간" : `빨리 감기 ${p.speed}배`;
}

/** Only the real-time run counts for the official score; a fast-forward run is marked as such. */
export const isOfficial = (p: Pace): boolean => p.mode === "realtime";
