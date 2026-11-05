/**
 * What is wrong with one value: a block parameter, a condition or a scoring item. validate.ts turns
 * these into issues that point at where they live. Messages are Korean, for the editor.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { withJosa } from "@terrarium/core/kernel";
import { TOOL_NAMES } from "@terrarium/core/tools";
import {
  type BlueprintIndex,
  type EntityKind,
  FAULT_SPECS,
  type FaultSpec,
  isMistakeType,
  isTaskType,
  KIND_LABELS,
  kindList,
} from "@terrarium/core/world";
import { blockSpec, CONDITION_FIELDS, type ParamSpec } from "./blocks";
import { EVENT_LABELS, EVENT_TYPES, isEventType } from "./events";
import {
  ACTION_KINDS,
  ACTION_LABELS,
  type ActionKind,
  COMPARE_OPS,
  type Condition,
  type Expectation,
  type ExpectationKind,
  type ScenarioDoc,
  type ScenarioNode,
} from "./model";
import { toMinutes } from "./units";

/** What validation needs to know about the world: its entities and equipment models. */
export interface ScenarioEnv {
  readonly index: BlueprintIndex;
  readonly catalog: Catalog;
  /** Fault types and whether the simulator supports them; the built-in list by default. */
  readonly faults?: readonly FaultSpec[];
}

export type Problem = { readonly code: string; readonly message: string } | undefined;
export const bad = (message: string, code = "SC011"): Problem => ({ code, message });

const MAX_CONDITION_DEPTH = 3;

export function entityProblem(
  env: ScenarioEnv,
  value: unknown,
  kinds?: readonly EntityKind[],
): Problem {
  const entity = typeof value === "string" ? env.index.find(value) : undefined;
  if (!entity) return bad(`이 세계에 '${String(value)}'가 없어요`, "SC012");
  if (kinds && !kinds.includes(entity.kind))
    return bad(
      `${withJosa(entity.name, "은")} ${withJosa(KIND_LABELS[entity.kind], "이에요")}. ${kindList(kinds)}만 고를 수 있어요`,
      "SC012",
    );
  return undefined;
}

type Check<K extends ParamSpec["kind"]> = (
  param: Extract<ParamSpec, { kind: K }>,
  value: unknown,
  node: ScenarioNode,
  doc: ScenarioDoc,
  env: ScenarioEnv,
) => Problem;

/** One check per parameter kind; adding a kind to the spec fails the type check here until it has one. */
const PARAM_CHECKS: { readonly [K in ParamSpec["kind"]]: Check<K> } = {
  number: (p, v) => numberProblem(p, v),
  boolean: (_p, v) => (typeof v === "boolean" ? undefined : bad("예/아니오 값이어야 해요")),
  text: (p, v) => textProblem(p, v),
  entity: (p, v, _n, _d, env) => entityProblem(env, v, p.kinds),
  fault_type: (_p, v, _n, _d, env) => faultTypeProblem(env, v),
  fault_target: (_p, v, n, _d, env) => faultTargetProblem(env, n.params.faultType, v),
  fault_params: (_p, v, n, _d, env) => faultParamsProblem(env, n.params.faultType, v),
  condition: (_p, v, _n, _d, env) => conditionProblem(v, env),
  // Whether the value is among what the device offers is checked with the whole block (net-blocks.ts).
  net_pick: (_p, v) =>
    typeof v === "string" || typeof v === "number" ? undefined : bad("목록에서 골라야 해요"),
  node_ref: (p, v, _n, d) => nodeRefProblem(p, v, d),
};

export function paramProblem(
  node: ScenarioNode,
  param: ParamSpec,
  value: unknown,
  doc: ScenarioDoc,
  env: ScenarioEnv,
): Problem {
  const check = PARAM_CHECKS[param.kind] as Check<ParamSpec["kind"]>;
  return check(param as never, value, node, doc, env);
}

function nodeRefProblem(
  param: Extract<ParamSpec, { kind: "node_ref" }>,
  value: unknown,
  doc: ScenarioDoc,
): Problem {
  if (doc.nodes.find((n) => n.id === value)?.type === param.nodeType) return undefined;
  return bad(
    `'${String(value)}'는 「${blockSpec(param.nodeType)?.label}」 블록이 아니에요`,
    "SC015",
  );
}

function numberProblem(param: Extract<ParamSpec, { kind: "number" }>, value: unknown): Problem {
  if (typeof value !== "number" || !Number.isFinite(value)) return bad("숫자여야 해요");
  if (param.integer && !Number.isInteger(value)) return bad("정수여야 해요");
  if (value < param.min || value > param.max) {
    // durations are stored in seconds and read in minutes
    if (param.unit === "초") {
      const low = param.min === 0 ? 0 : Math.max(0.1, toMinutes(param.min));
      return bad(`${low}~${toMinutes(param.max)}분 사이여야 해요 (지금 ${toMinutes(value)}분)`);
    }
    return bad(`${param.min}~${param.max} ${param.unit} 사이여야 해요 (지금 ${value})`);
  }
  return undefined;
}

function textProblem(param: Extract<ParamSpec, { kind: "text" }>, value: unknown): Problem {
  if (typeof value !== "string") return bad("글이어야 해요");
  if (!param.optional && value.trim() === "") return bad("비어 있어요");
  if (value.length > param.maxLength)
    return bad(`${param.maxLength}자를 넘어요 (${value.length}자)`);
  return undefined;
}

/** The spec of a fault type, from the environment's fault list. */
function specOf(env: ScenarioEnv, faultType: unknown): FaultSpec | undefined {
  return (env.faults ?? FAULT_SPECS).find((f) => f.type === faultType);
}

function faultTypeProblem(env: ScenarioEnv, value: unknown): Problem {
  const spec = specOf(env, value);
  if (!spec)
    return bad(
      `모르는 고장 종류예요: ${FAULT_SPECS.find((f) => f.type === value)?.label ?? String(value)}`,
    );
  return spec.status === "planned"
    ? bad(`${withJosa(spec.label, "은")} 아직 시뮬레이터가 지원하지 않아요`, "SC004")
    : undefined;
}

const isLinkId = (env: ScenarioEnv, value: unknown) =>
  typeof value === "string" && env.index.allLinks().some((l) => l.id === value);

function faultTargetProblem(env: ScenarioEnv, faultType: unknown, value: unknown): Problem {
  const spec = specOf(env, faultType);
  if (!spec) return undefined; // reported on faultType
  if (isLinkId(env, value))
    return spec.targets.includes("link")
      ? undefined
      : bad(`${withJosa(spec.label, "은")} 링크에 줄 수 없어요`, "SC013");
  const entity = typeof value === "string" ? env.index.find(value) : undefined;
  if (!entity) return bad(`이 세계에 '${String(value)}'가 없어요`, "SC012");
  if (!spec.targets.includes(entity.kind))
    return bad(
      `${withJosa(spec.label, "은")} ${kindList(spec.targets)}에만 줄 수 있어요 (${withJosa(entity.name, "은")} ${KIND_LABELS[entity.kind]})`,
      "SC013",
    );
  return undefined;
}

function faultParamsProblem(env: ScenarioEnv, faultType: unknown, value: unknown): Problem {
  const spec = specOf(env, faultType);
  if (!spec) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return bad("세부값 목록이어야 해요");
  for (const [name, v] of Object.entries(value)) {
    const param = spec.params.find((p) => p.name === name);
    if (!param) return bad(`${spec.label}에는 '${name}' 세부값이 없어요`);
    if (typeof v !== "number" || v < param.min || v > param.max)
      return bad(
        `${withJosa(param.label, "은")} ${param.min}~${param.max} ${param.unit} 사이여야 해요`,
      );
  }
  return undefined;
}

function toolProblem(
  env: ScenarioEnv,
  tool: string,
  target: string | undefined,
  code: string,
): Problem {
  if (!TOOL_NAMES.includes(tool)) return bad(`알 수 없는 툴 '${tool}'`, code);
  return target === undefined ? undefined : entityProblem(env, target);
}

function actionProblem(
  env: ScenarioEnv,
  action: string,
  target: string | undefined,
  code: string,
): Problem {
  if (!ACTION_KINDS.includes(action as ActionKind))
    return bad(
      `알 수 없는 행동 '${action}' (가능: ${ACTION_KINDS.map((a) => ACTION_LABELS[a]).join(", ")})`,
      code,
    );
  return target === undefined ? undefined : entityProblem(env, target);
}

type Checks<U extends { kind: string }, Extra extends unknown[]> = {
  readonly [K in U["kind"]]: (
    item: Extract<U, { kind: K }>,
    env: ScenarioEnv,
    ...extra: Extra
  ) => Problem;
};

function groupProblem(
  c: Extract<Condition, { kind: "all" | "any" }>,
  env: ScenarioEnv,
  depth: number,
): Problem {
  if (depth >= MAX_CONDITION_DEPTH)
    return bad(`조건은 ${MAX_CONDITION_DEPTH}단계까지만 겹칠 수 있어요`, "SC014");
  if (!Array.isArray(c.of) || c.of.length === 0) return bad("묶음 조건이 비었어요", "SC014");
  for (const inner of c.of) {
    const problem = conditionProblem(inner, env, depth + 1);
    if (problem) return problem;
  }
  return undefined;
}

const CONDITION_CHECKS: Checks<Condition, [depth: number]> = {
  state: (c, env) => stateConditionProblem(c, env),
  alarm: (c, env) => (c.entity === undefined ? undefined : entityProblem(env, c.entity)),
  event: (c, env) => eventProblem(c, env),
  tool_called: (c, env) => toolProblem(env, c.tool, c.target, "SC014"),
  action_taken: (c, env) => actionProblem(env, c.action, c.target, "SC014"),
  diagnosis_submitted: () => undefined,
  all: groupProblem,
  any: groupProblem,
};

export function conditionProblem(value: unknown, env: ScenarioEnv, depth = 0): Problem {
  const c = value as Condition;
  if (typeof c !== "object" || c === null || typeof c.kind !== "string")
    return bad("조건이 비었어요", "SC014");
  const check = CONDITION_CHECKS[c.kind] as
    | ((item: Condition, env: ScenarioEnv, depth: number) => Problem)
    | undefined;
  return check ? check(c, env, depth) : bad(`알 수 없는 조건 종류 '${c.kind}'`, "SC014");
}

function eventProblem(c: Extract<Condition, { kind: "event" }>, env: ScenarioEnv): Problem {
  if (!isEventType(c.type))
    return bad(
      `알 수 없는 사건 '${String(c.type)}' (가능: ${EVENT_TYPES.map((t) => EVENT_LABELS[t]).join(", ")})`,
      "SC014",
    );
  if (c.target === undefined || isLinkId(env, c.target)) return undefined;
  return entityProblem(env, c.target);
}

function stateConditionProblem(
  c: Extract<Condition, { kind: "state" }>,
  env: ScenarioEnv,
): Problem {
  const entity = env.index.find(c.entity);
  if (!entity) return bad(`이 세계에 '${c.entity}'가 없어요`, "SC012");
  const field = CONDITION_FIELDS[entity.kind][c.field];
  if (!field) {
    const allowed = Object.values(CONDITION_FIELDS[entity.kind])
      .map((f) => f.label)
      .join(", ");
    return bad(
      `${KIND_LABELS[entity.kind]}에는 '${c.field}' 값이 없어요 (가능: ${allowed})`,
      "SC014",
    );
  }
  if (!COMPARE_OPS.includes(c.op)) return bad(`알 수 없는 비교 '${c.op}'`, "SC014");
  if (field.type !== "number" && c.op !== "==" && c.op !== "!=")
    return bad(`${withJosa(field.label, "은")} 같다/다르다로만 비교할 수 있어요`, "SC014");
  const okValue =
    field.type === "number"
      ? typeof c.value === "number"
      : field.type === "boolean"
        ? typeof c.value === "boolean"
        : field.values === undefined
          ? typeof c.value === "string"
          : field.values.includes(String(c.value));
  return okValue ? undefined : bad(`${field.label}에 맞지 않는 값 '${String(c.value)}'`, "SC014");
}

const positive = (n: number, what: string): Problem =>
  n > 0 && Number.isFinite(n) ? undefined : bad(`${withJosa(what, "은")} 0보다 커야 해요`, "SC016");

function diagnosisProblem(
  e: Extract<Expectation, { kind: "diagnosis" }>,
  env: ScenarioEnv,
): Problem {
  if (e.rootCause.length === 0) return bad("정답 원인을 하나 이상 골라야 해요", "SC016");
  const missing = e.rootCause.find((id) => !isLinkId(env, id) && !env.index.find(id));
  if (missing !== undefined) return bad(`이 세계에 '${missing}'가 없어요`, "SC012");
  if (
    e.faultType.length === 0 ||
    !e.faultType.every((t) => specOf(env, t) || isMistakeType(t) || isTaskType(t))
  )
    return bad("정답 고장 종류가 올바르지 않아요", "SC016");
  return positive(e.weight, "점수");
}

const EXPECTATION_CHECKS: Checks<Expectation, []> = {
  diagnosis: diagnosisProblem,
  final_state: (e, env) => conditionProblem(e.condition, env) ?? positive(e.weight, "점수"),
  required_action: (e, env) =>
    actionProblem(env, e.action, e.target, "SC016") ?? positive(e.weight, "점수"),
  forbidden_action: (e, env) =>
    actionProblem(env, e.action, e.target, "SC016") ?? positive(e.penalty, "감점"),
  time_limit: (e) => positive(e.seconds, "제한 시간") ?? positive(e.weight, "점수"),
  tool_budget: (e) => positive(e.maxCalls, "툴 호출 상한") ?? positive(e.weight, "점수"),
};

export function expectationProblem(e: Expectation, env: ScenarioEnv): Problem {
  const check = EXPECTATION_CHECKS[e.kind as ExpectationKind] as
    | ((item: Expectation, env: ScenarioEnv) => Problem)
    | undefined;
  return check ? check(e, env) : bad(`알 수 없는 채점 항목 종류 '${e.kind}'`, "SC016");
}
