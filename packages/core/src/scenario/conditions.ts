/** Evaluating and describing conditions. Shared by the runner (branch, wait_until) and the oracle. */
import { josa } from "@terrarium/core/kernel";
import type { Diagnosis } from "@terrarium/core/tools";
import type { BlueprintIndex, WorldCommand, WorldReader } from "@terrarium/core/world";
import { CONDITION_FIELDS } from "./blocks";
import {
  ACTION_LABELS,
  type ActionKind,
  type AgentAction,
  type CompareOp,
  type Condition,
  callTargets,
} from "./model";

export type { Diagnosis } from "@terrarium/core/tools";

/** One tool call the agent made, as the session records it. */
export interface ToolCallRecord {
  readonly t: number;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly ok: boolean;
  /** Why the call failed, as the agent was told. */
  readonly error?: string;
  /** What the call did to the world (derived from the world events it caused). */
  readonly effects?: readonly AgentAction[];
}

const SIMPLE_ACTIONS: Partial<Record<WorldCommand["type"], ActionKind>> = {
  "breaker.reset": "breaker_reset",
  "setpoint.set": "setpoint_change",
};

/**
 * The actions in the world commands one tool call caused. Off then on for the same target within
 * one call is a restart (power_server off/on, Redfish ForceRestart, restart_cooling_unit).
 */
export function actionsOf(commands: readonly WorldCommand[]): AgentAction[] {
  const out: AgentAction[] = [];
  const consumed = new Set<number>();
  commands.forEach((c, i) => {
    if (consumed.has(i)) return;
    if (c.type !== "power.set") {
      const action = SIMPLE_ACTIONS[c.type];
      if (action && "target" in c) out.push({ action, target: c.target });
      return;
    }
    const backOn = c.on
      ? -1
      : commands.findIndex(
          (n, j) => j > i && n.type === "power.set" && n.target === c.target && n.on,
        );
    if (backOn >= 0) consumed.add(backOn);
    out.push({
      action: backOn >= 0 ? "restart" : c.on ? "power_on" : "power_off",
      target: c.target,
    });
  });
  return out;
}

/** Every action the agent took, in order. */
export function agentActions(calls: readonly ToolCallRecord[]): AgentAction[] {
  return calls.flatMap((c) => c.effects ?? []);
}

export function matchesAction(a: AgentAction, action: ActionKind, target?: string): boolean {
  return a.action === action && (target === undefined || a.target === target);
}

/** What the scenario can observe about the agent. */
export interface AgentSignals {
  toolCalls(): readonly ToolCallRecord[];
  diagnosis(): Diagnosis | undefined;
}

export const NO_AGENT: AgentSignals = { toolCalls: () => [], diagnosis: () => undefined };

export function matchesCall(call: ToolCallRecord, tool: string, target?: string): boolean {
  return call.tool === tool && (target === undefined || callTargets(call.args).includes(target));
}

export function compare(op: CompareOp, actual: unknown, expected: unknown): boolean {
  if (op === "==") return actual === expected;
  if (op === "!=") return actual !== expected;
  if (typeof actual !== "number" || typeof expected !== "number") return false;
  if (op === "<") return actual < expected;
  if (op === "<=") return actual <= expected;
  if (op === ">") return actual > expected;
  return actual >= expected;
}

type Readable = Pick<WorldReader, "stateOf" | "alarms">;

export function evaluate(condition: Condition, world: Readable, agent: AgentSignals): boolean {
  switch (condition.kind) {
    case "state": {
      const state = world.stateOf(condition.entity) as unknown as Record<string, unknown>;
      return compare(condition.op, state[condition.field], condition.value);
    }
    case "alarm": {
      const found = world
        .alarms()
        .some(
          (a) =>
            (condition.entity === undefined || a.entityId === condition.entity) &&
            (condition.code === undefined || a.code === condition.code) &&
            (condition.severity === undefined || a.severity === condition.severity),
        );
      return found === condition.active;
    }
    case "tool_called":
      return agent.toolCalls().some((c) => matchesCall(c, condition.tool, condition.target));
    case "action_taken":
      return agentActions(agent.toolCalls()).some((a) =>
        matchesAction(a, condition.action, condition.target),
      );
    case "diagnosis_submitted":
      return agent.diagnosis() !== undefined;
    case "all":
      return condition.of.every((c) => evaluate(c, world, agent));
    case "any":
      return condition.of.some((c) => evaluate(c, world, agent));
  }
}

const OP_WORDS: Readonly<Record<CompareOp, string>> = {
  "<": "<",
  "<=": "≤",
  ">": ">",
  ">=": "≥",
  "==": "=",
  "!=": "≠",
};

function valueText(value: unknown, unit: string | undefined): string {
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (typeof value === "number" && unit === "비율") return `${Math.round(value * 100)}%`;
  return unit && typeof value === "number"
    ? `${value}${unit === "%" ? "%" : ` ${unit}`}`
    : String(value);
}

const SEVERITY_WORDS = { critical: "심각", warning: "경고" } as const;

type Describers = {
  readonly [K in Condition["kind"]]: (
    c: Extract<Condition, { kind: K }>,
    name: (id: string) => string,
    index?: BlueprintIndex,
  ) => string;
};

const DESCRIBERS: Describers = {
  state: (c, name, index) => {
    const kind = index?.find(c.entity)?.kind;
    const field = kind ? CONDITION_FIELDS[kind][c.field] : undefined;
    const value = valueText(c.value, field?.unit);
    return `${name(c.entity)} ${field?.label ?? c.field} ${OP_WORDS[c.op]} ${value}`;
  },
  alarm: (c, name) => {
    const what = [
      c.entity ? name(c.entity) : "어느 장비든",
      c.severity ? SEVERITY_WORDS[c.severity] : "",
      c.code ? `'${c.code}'` : "",
      "알람",
    ]
      .filter(Boolean)
      .join(" ");
    return `${what}이 ${c.active ? "있다" : "없다"}`;
  },
  tool_called: (c, name) =>
    `에이전트가 ${c.tool}${c.target ? `(${name(c.target)})` : ""}${josa(c.tool, "을")} 호출했다`,
  action_taken: (c, name) => {
    const label = ACTION_LABELS[c.action];
    return `에이전트가 ${c.target ? `${name(c.target)} ` : ""}${label}${josa(label, "을")} 했다`;
  },
  diagnosis_submitted: () => "에이전트가 진단을 제출했다",
  all: (c, _name, index) => c.of.map((inner) => describe(inner, index)).join(" 그리고 "),
  any: (c, _name, index) => c.of.map((inner) => describe(inner, index)).join(" 또는 "),
};

/** A sentence a person can read, e.g. "srv-a1 흡기 온도 > 35 °C". */
export function describe(condition: Condition, index?: BlueprintIndex): string {
  const name = (id: string) => index?.find(id)?.name ?? id;
  const describer = DESCRIBERS[condition.kind] as (
    c: Condition,
    name: (id: string) => string,
    index?: BlueprintIndex,
  ) => string;
  return describer(condition, name, index);
}
