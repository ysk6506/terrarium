/**
 * Scenario validation (REQ-034). Every issue names the block, edge or expectation it belongs to, so
 * the editor can highlight it, and says in Korean what to change. What is wrong with a single value
 * is decided in problems.ts; this file places it and checks the flow graph.
 *
 * SC001 schema version       SC002 duplicate id            SC003 unknown block
 * SC004 block not supported  SC005 block count             SC007 bad edge
 * SC008 cycle                SC009 unreachable block (warn) SC010 agent task unreachable
 * SC011 bad parameter        SC012 bad entity              SC013 fault cannot target this
 * SC014 bad condition        SC015 bad block reference     SC016 bad expectation
 * SC017 no scoring (warn)    SC019 runs twice (warn)       SC020 too large
 * SC021 answer not injected (warn)
 */
import { josa, type Particle, withJosa } from "@terrarium/core/kernel";
import { BLOCK_SPECS, blockSpec, outputsOf, type ParamSpec } from "./blocks";
import {
  type Expectation,
  SCENARIO_SCHEMA_VERSION,
  type ScenarioDoc,
  type ScenarioEdge,
  type ScenarioNode,
} from "./model";
import { bad, expectationProblem, type Problem, paramProblem, type ScenarioEnv } from "./problems";

export type { ScenarioEnv } from "./problems";

export interface ScenarioIssue {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly nodeId?: string;
  readonly edgeId?: string;
  readonly expectationId?: string;
  readonly param?: string;
}

export const MAX_NODES = 300;

type Where = Pick<ScenarioIssue, "nodeId" | "edgeId" | "expectationId" | "param">;
const error = (code: string, message: string, where: Where = {}): ScenarioIssue => ({
  code,
  severity: "error",
  message,
  ...where,
});
const warning = (code: string, message: string, where: Where = {}): ScenarioIssue => ({
  code,
  severity: "warning",
  message,
  ...where,
});

const labelOf = (node: ScenarioNode) => node.label ?? blockSpec(node.type)?.label ?? node.type;
const nameOf = (node: ScenarioNode) => `「${labelOf(node)}」`;
/** 「name」 followed by the particle that fits the name. */
const named = (node: ScenarioNode, particle: Particle) =>
  `${nameOf(node)}${josa(labelOf(node), particle)}`;

export function validateScenario(doc: ScenarioDoc, env: ScenarioEnv): ScenarioIssue[] {
  if (doc.schemaVersion !== SCENARIO_SCHEMA_VERSION) {
    return [
      error(
        "SC001",
        `시나리오 형식 버전 ${doc.schemaVersion}은 지원하지 않는다 (지원: ${SCENARIO_SCHEMA_VERSION})`,
      ),
    ];
  }
  if (doc.nodes.length > MAX_NODES) {
    return [
      error("SC020", `블록이 ${doc.nodes.length}개다. 한 시나리오는 ${MAX_NODES}개까지 쓸 수 있다`),
    ];
  }
  return [
    ...duplicateIds(doc),
    ...blockCounts(doc),
    ...doc.nodes.flatMap((node) => checkNode(node, doc, env)),
    ...checkEdges(doc),
    ...checkGraph(doc),
    ...doc.expectations.flatMap((e) => checkExpectation(e, env)),
    ...scoringWarnings(doc),
  ];
}

export const hasErrors = (issues: readonly ScenarioIssue[]): boolean =>
  issues.some((i) => i.severity === "error");

function duplicateIds(doc: ScenarioDoc): ScenarioIssue[] {
  const out: ScenarioIssue[] = [];
  const check = (what: string, ids: readonly string[], where: (id: string) => Where) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) out.push(error("SC002", `${what} id '${id}'가 중복된다`, where(id)));
      seen.add(id);
    }
  };
  check(
    "블록",
    doc.nodes.map((n) => n.id),
    (nodeId) => ({ nodeId }),
  );
  check(
    "연결",
    doc.edges.map((e) => e.id),
    (edgeId) => ({ edgeId }),
  );
  check(
    "채점 항목",
    doc.expectations.map((e) => e.id),
    (expectationId) => ({ expectationId }),
  );
  return out;
}

function blockCounts(doc: ScenarioDoc): ScenarioIssue[] {
  const out: ScenarioIssue[] = [];
  for (const spec of BLOCK_SPECS) {
    const count = doc.nodes.filter((n) => n.type === spec.type).length;
    if (spec.minCount !== undefined && count < spec.minCount)
      out.push(error("SC005", `「${spec.label}」 블록이 필요하다`));
    if (spec.maxCount !== undefined && count > spec.maxCount)
      out.push(
        error(
          "SC005",
          `「${spec.label}」 블록은 ${spec.maxCount}개만 둘 수 있다 (지금 ${count}개)`,
        ),
      );
  }
  return out;
}

function checkNode(node: ScenarioNode, doc: ScenarioDoc, env: ScenarioEnv): ScenarioIssue[] {
  const spec = blockSpec(node.type);
  if (!spec) return [error("SC003", `알 수 없는 블록 종류 '${node.type}'`, { nodeId: node.id })];
  if (spec.status === "planned") {
    const message = `${nameOf(node)} 블록은 아직 시뮬레이터가 지원하지 않는다: ${spec.plannedReason}`;
    return [error("SC004", message, { nodeId: node.id })];
  }
  const issues = spec.params.flatMap((param) => checkParam(node, param, doc, env));
  return issues.length > 0 ? issues : extraChecks(node, env);
}

function checkParam(
  node: ScenarioNode,
  param: ParamSpec,
  doc: ScenarioDoc,
  env: ScenarioEnv,
): ScenarioIssue[] {
  const value = node.params[param.name];
  const where = { nodeId: node.id, param: param.name };
  const label = `${nameOf(node)}의 ${param.label}`;
  if (value === undefined) {
    const hasDefault = "default" in param && param.default !== undefined;
    return param.optional || hasDefault
      ? []
      : [error("SC011", `${label}${josa(param.label, "을")} 정해야 한다`, where)];
  }
  const problem = paramProblem(node, param, value, doc, env);
  return problem ? [error(problem.code, `${label}: ${problem.message}`, where)] : [];
}

/** Checks that need more than one parameter or the equipment catalog. */
function extraChecks(node: ScenarioNode, env: ScenarioEnv): ScenarioIssue[] {
  if (node.type !== "set_setpoint") return [];
  const unit = env.index.entity(String(node.params.target));
  if (!unit.modelId) return [];
  const model = env.catalog.getOf(unit.modelId, "cooling_unit");
  const celsius = Number(node.params.celsius ?? 18);
  if (celsius >= model.minSetpointC && celsius <= model.maxSetpointC) return [];
  const message = `${unit.name}(${model.name})의 설정 온도는 ${model.minSetpointC}~${model.maxSetpointC} °C 사이여야 한다`;
  return [error("SC011", message, { nodeId: node.id, param: "celsius" })];
}

function checkEdges(doc: ScenarioDoc): ScenarioIssue[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  return doc.edges.flatMap((edge) => {
    const problem = edgeProblem(edge, byId.get(edge.from), byId.get(edge.to));
    return problem ? [error(problem.code, problem.message, { edgeId: edge.id })] : [];
  });
}

function edgeProblem(edge: ScenarioEdge, from?: ScenarioNode, to?: ScenarioNode): Problem {
  if (!from || !to) return bad(`연결 ${withJosa(edge.id, "이")} 없는 블록을 가리킨다`, "SC007");
  // An unknown block is reported once, on the block itself, not again on every edge.
  if (!blockSpec(from.type) || !blockSpec(to.type)) return undefined;
  if (edge.from === edge.to) return bad(`${named(from, "이")} 자기 자신으로 이어진다`, "SC008");
  if (!outputsOf(from).includes(edge.port))
    return bad(`${nameOf(from)}에는 '${edge.port}' 출구가 없다`, "SC007");
  if (!blockSpec(to.type)?.hasInput)
    return bad(`${named(to, "로")} 들어오는 연결은 둘 수 없다`, "SC007");
  return undefined;
}

/** Successor ids per node (valid edges only). */
function successors(doc: ScenarioDoc): Map<string, string[]> {
  const ids = new Set(doc.nodes.map((n) => n.id));
  const next = new Map<string, string[]>(doc.nodes.map((n) => [n.id, []]));
  for (const e of doc.edges) if (ids.has(e.from) && ids.has(e.to)) next.get(e.from)?.push(e.to);
  return next;
}

function reachableFrom(
  next: ReadonlyMap<string, readonly string[]>,
  roots: readonly string[],
): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return seen;
}

function checkGraph(doc: ScenarioDoc): ScenarioIssue[] {
  const next = successors(doc);
  const cycle = findCycle(next);
  if (cycle) {
    const names = cycle
      .map((id) => nameOf(doc.nodes.find((n) => n.id === id) as ScenarioNode))
      .join(" → ");
    const message = `블록이 고리를 이룬다: ${names}. 반복은 '조건 대기'로 표현한다`;
    return [error("SC008", message, { nodeId: cycle[0] })];
  }
  const start = doc.nodes.find((n) => n.type === "start");
  const reached = reachableFrom(next, start ? [start.id] : []);
  const out: ScenarioIssue[] = [];
  for (const node of doc.nodes) {
    if (reached.has(node.id) || node.type === "note") continue;
    const where = { nodeId: node.id };
    out.push(
      node.type === "agent_task"
        ? error(
            "SC010",
            "「에이전트 투입」 블록이 시작에서 이어지지 않아 에이전트가 투입되지 않는다",
            where,
          )
        : warning("SC009", `${named(node, "은")} 시작에서 이어지지 않아 실행되지 않는다`, where),
    );
  }
  return [...out, ...doubleRuns(doc, next)];
}

function findCycle(next: ReadonlyMap<string, readonly string[]>): string[] | undefined {
  const state = new Map<string, "open" | "done">();
  const path: string[] = [];
  const visit = (id: string): string[] | undefined => {
    if (state.get(id) === "done") return undefined;
    if (state.get(id) === "open") return path.slice(path.indexOf(id));
    state.set(id, "open");
    path.push(id);
    for (const to of next.get(id) ?? []) {
      const found = visit(to);
      if (found) return found;
    }
    path.pop();
    state.set(id, "done");
    return undefined;
  };
  for (const id of next.keys()) {
    const found = visit(id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Several edges from one output run their targets in parallel. If two parallel paths meet again,
 * the meeting block runs once per path, which is rarely what the author meant.
 */
function doubleRuns(
  doc: ScenarioDoc,
  next: ReadonlyMap<string, readonly string[]>,
): ScenarioIssue[] {
  const flagged = new Set<string>();
  for (const node of doc.nodes) {
    for (const port of outputsOf(node)) {
      const targets = doc.edges
        .filter((e) => e.from === node.id && e.port === port)
        .map((e) => e.to);
      const counts = new Map<string, number>();
      for (const t of targets)
        for (const id of reachableFrom(next, [t])) counts.set(id, (counts.get(id) ?? 0) + 1);
      for (const [id, count] of counts) if (count > 1) flagged.add(id);
    }
  }
  return doc.nodes
    .filter((n) => flagged.has(n.id))
    .map((n) =>
      warning("SC019", `${named(n, "은")} 동시에 진행되는 두 갈래에서 모두 실행된다`, {
        nodeId: n.id,
      }),
    );
}

function checkExpectation(e: Expectation, env: ScenarioEnv): ScenarioIssue[] {
  const problem = expectationProblem(e, env);
  if (!problem) return [];
  return [
    error(problem.code, `채점 항목 '${e.label ?? e.id}': ${problem.message}`, {
      expectationId: e.id,
    }),
  ];
}

function scoringWarnings(doc: ScenarioDoc): ScenarioIssue[] {
  const out: ScenarioIssue[] = [];
  const diagnosis = doc.expectations.filter((e) => e.kind === "diagnosis");
  if (doc.expectations.length === 0)
    out.push(warning("SC017", "채점 기준이 없다. 실행은 되지만 점수가 나오지 않는다"));
  else if (diagnosis.length === 0)
    out.push(warning("SC017", "진단 정답이 없어 진단은 채점하지 않는다"));
  const injected = new Set(
    doc.nodes.filter((n) => n.type === "inject_fault").map((n) => String(n.params.faultType)),
  );
  for (const d of diagnosis) {
    if (!d.faultType.some((t) => injected.has(t)))
      out.push(
        warning("SC021", `정답 장애 종류(${d.faultType.join(", ")})를 주입하는 블록이 없다`, {
          expectationId: d.id,
        }),
      );
  }
  return out;
}
