/**
 * Forks and lineage (REQ-040): take an experiment as it is, change a condition (harness, agent,
 * tools, or anything else), and run it again. The fork remembers its parent; the difference is
 * shown in words; the family tree can be walked both ways.
 */
import { InvalidValueError } from "@terrarium/core/kernel";
import type { Experiment, Metadata, Recipe, Snapshot, Subject } from "./model";
import { benchmarkKey, normalizeTools } from "./recipe";

export interface ForkMeta {
  readonly id: string;
  readonly owner: string;
  readonly createdAt: string;
  readonly name?: string;
  readonly note?: string;
  /** Replaces the parent's metadata; left out, the fork keeps it. */
  readonly metadata?: Metadata;
  /** Who runs the fork, when the harness or agent changed; left out, the parent's. */
  readonly subject?: Subject;
}

/**
 * A new experiment from `parent` with `change` applied. `snapshot` describes what the new recipe
 * points at (the caller resolves it; it equals the parent's when world and scenario are unchanged).
 */
export function forkExperiment(
  parent: Experiment,
  change: Partial<Recipe>,
  meta: ForkMeta,
  snapshot: Snapshot,
): Experiment {
  const recipe: Recipe = {
    ...parent.recipe,
    ...change,
    tools: normalizeTools(change.tools ?? parent.recipe.tools),
  };
  const sameVersions =
    snapshot.worldDigest === parent.snapshot.worldDigest &&
    snapshot.scenarioDigest === parent.snapshot.scenarioDigest;
  if (recipeDiff(parent.recipe, recipe).length === 0 && sameVersions)
    throw new InvalidValueError(
      "포크는 조건을 하나 이상 바꿔야 해요 (같은 조건으로 다시 돌리려면 실행을 더해 주세요)",
    );
  return {
    id: meta.id,
    name: meta.name ?? `${parent.name} (포크)`,
    owner: meta.owner,
    createdAt: meta.createdAt,
    recipe,
    snapshot,
    benchmarkKey: benchmarkKey(snapshot, recipe),
    parentId: parent.id,
    ...(meta.note ? { note: meta.note } : {}),
    ...withMetadata(meta.metadata ?? parent.metadata, meta.subject ?? parent.subject),
    ...(parent.agentVersion === undefined ? {} : { agentVersion: parent.agentVersion }),
  };
}

const withMetadata = (metadata: Metadata | undefined, subject: Subject | undefined) => ({
  ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
  ...(subject ? { subject } : {}),
});

export interface RecipeChange {
  readonly field: keyof Recipe;
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

const LABELS: Readonly<Record<keyof Recipe, string>> = {
  worldId: "세계",
  scenarioId: "시나리오",
  harnessId: "하네스",
  agentId: "에이전트",
  tools: "툴",
  seeds: "시드",
  time: "시간 정책",
  profiles: "제품 버전",
  escalation: "에스컬레이션 처리",
  faultScope: "고장 범위",
  sop: "절차서",
};

const ESCALATION_TEXT = {
  wait: "사람 기다림",
  auto: "정해 둔 답으로 자동 응답",
  fail: "실패로 끝냄",
};
const SCOPE_TEXT = { inside: "준 툴 안에서만", all: "전부" };
const SOP_TEXT = { none: "안 줌", given: "줌", search: "찾게 함" };

function timeText(t: Recipe["time"]): string {
  return t.kind === "lockstep" ? `호출당 ${t.secondsPerCall}초` : `실시간 ×${t.speed}`;
}

const TEXTS: Partial<Record<keyof Recipe, (r: Recipe) => string>> = {
  tools: (r) => r.tools.join(", "),
  seeds: (r) => r.seeds.join(", "),
  time: (r) => timeText(r.time),
  profiles: (r) => `vCenter ${r.profiles.vcenter ?? "기본"} · vROps ${r.profiles.vrops ?? "기본"}`,
  escalation: (r) => ESCALATION_TEXT[r.escalation?.mode ?? "auto"],
  faultScope: (r) => SCOPE_TEXT[r.faultScope ?? "all"],
  sop: (r) => SOP_TEXT[r.sop ?? "none"],
};

function text(field: keyof Recipe, r: Recipe): string {
  return TEXTS[field]?.(r) ?? String(r[field]);
}

function toolDelta(a: Recipe, b: Recipe): string {
  const added = b.tools.filter((t) => !a.tools.includes(t));
  const removed = a.tools.filter((t) => !b.tools.includes(t));
  return [
    added.length > 0 ? `+${added.join(", +")}` : "",
    removed.length > 0 ? `−${removed.join(", −")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** What changed from `a` to `b`, in words people read. Tools show what was added and removed. */
export function recipeDiff(a: Recipe, b: Recipe): RecipeChange[] {
  const out: RecipeChange[] = [];
  for (const field of Object.keys(LABELS) as (keyof Recipe)[]) {
    const before = text(field, a);
    const after = text(field, b);
    if (before === after) continue;
    out.push({
      field,
      label: LABELS[field],
      before,
      after: field === "tools" ? `${after} (${toolDelta(a, b)})` : after,
    });
  }
  return out;
}

/** Ancestors from the root down to `id` (inclusive). */
export function lineage(all: readonly Experiment[], id: string): Experiment[] {
  const byId = new Map(all.map((e) => [e.id, e]));
  const chain: Experiment[] = [];
  for (
    let e = byId.get(id);
    e && !chain.includes(e);
    e = e.parentId ? byId.get(e.parentId) : undefined
  )
    chain.unshift(e);
  return chain;
}

/** Direct forks of `id`, oldest first. */
export function forksOf(all: readonly Experiment[], id: string): Experiment[] {
  return all
    .filter((e) => e.parentId === id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
