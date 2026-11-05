/**
 * Versions of an agent, kept by itself (REQ-053). Each time an experiment is made, the agent is looked at
 * again; if what it says about itself differs from the newest version, a new version is written with the
 * date and what changed. People can also add a version of their own (for what Terrarium cannot see, such as
 * a changed prompt), name or annotate any version, and delete one. Everything here is pure: the caller
 * brings the time and keeps the result.
 *
 * Version numbers only go up and are never given out twice, so "v3" in an old result always means the same
 * thing, even after v2 was deleted.
 */
import { NotFoundError } from "@terrarium/core/kernel";
import type { Metadata, Subject } from "./model";

/** What an agent says about itself, flat so that two of them can be compared field by field. */
export type AgentSnapshot = Readonly<Record<string, string>>;

export interface FieldChange {
  /** The key in the snapshot (`model`, `fact.graph`) or `attr.<name>` for a version attribute. */
  readonly field: string;
  /** The field in words people read. */
  readonly label: string;
  /** Missing when the field was added. */
  readonly before?: string;
  /** Missing when the field was removed. */
  readonly after?: string;
}

export interface AgentVersion {
  readonly n: number;
  readonly at: string;
  /** `auto` was found by looking; `manual` was added by a person. */
  readonly source: "auto" | "manual";
  /** Who made the experiment that found it, or who added it. */
  readonly by?: string;
  readonly snapshot: AgentSnapshot;
  /** A short name people give a version ("프롬프트 v3"). */
  readonly label?: string;
  readonly note?: string;
  /** What people say about this version that Terrarium cannot see; carried on to the next version. */
  readonly attributes: Metadata;
}

export interface AgentHistory {
  readonly harnessId: string;
  readonly agentId: string;
  /** The number the next version gets. */
  readonly next: number;
  /** Oldest first. */
  readonly versions: readonly AgentVersion[];
}

export interface AgentKey {
  readonly harnessId: string;
  readonly agentId: string;
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: "이름",
  description: "설명",
  model: "모델",
  "harness.kind": "하네스 종류",
  "harness.name": "하네스 이름",
  "harness.toolTransport": "툴 전달 방식",
};

const PREFIX_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["fact.", "하네스가 알려 준 사실 "],
  ["harness.meta.", "연결 메타데이터 "],
  ["attr.", "속성 "],
];

const ORDER = Object.keys(FIELD_LABELS);

const ATTR = "attr.";

export function labelOf(field: string): string {
  const fixed = FIELD_LABELS[field];
  if (fixed) return fixed;
  for (const [prefix, label] of PREFIX_LABELS)
    if (field.startsWith(prefix)) return `${label}${field.slice(prefix.length)}`;
  return field;
}

/** The agent's side of a subject, as one flat record. Fields the agent did not report are left out. */
export function snapshotOf(subject: Subject): AgentSnapshot {
  const out: Record<string, string> = {
    name: subject.agent.name,
    "harness.kind": subject.harness.kind,
    "harness.name": subject.harness.name,
    "harness.toolTransport": subject.harness.toolTransport,
  };
  if (subject.agent.description) out.description = subject.agent.description;
  if (subject.agent.model) out.model = subject.agent.model;
  for (const [k, v] of Object.entries(subject.agent.facts ?? {})) out[`fact.${k}`] = v;
  for (const [k, v] of Object.entries(subject.harness.metadata ?? {})) out[`harness.meta.${k}`] = v;
  return out;
}

const rank = (field: string): number => {
  const i = ORDER.indexOf(field);
  return i < 0 ? ORDER.length : i;
};

/** What changed from `before` to `after`: fixed fields first, then the rest by name. */
export function diffSnapshots(before: AgentSnapshot, after: AgentSnapshot): FieldChange[] {
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  );
  const out: FieldChange[] = [];
  for (const field of fields) {
    const was = before[field];
    const now = after[field];
    if (was === now) continue;
    out.push({
      field,
      label: labelOf(field),
      ...(was === undefined ? {} : { before: was }),
      ...(now === undefined ? {} : { after: now }),
    });
  }
  return out;
}

/** Newest first would hide the order versions were made in, so lookups go by the number. */
export const newest = (history: AgentHistory | undefined): AgentVersion | undefined =>
  history?.versions.reduce<AgentVersion | undefined>(
    (best, v) => (best === undefined || v.n > best.n ? v : best),
    undefined,
  );

const flat = (v: AgentVersion): AgentSnapshot => ({
  ...v.snapshot,
  ...Object.fromEntries(Object.entries(v.attributes).map(([k, val]) => [`${ATTR}${k}`, val])),
});

/**
 * What version `n` changed compared with the version before it (the one with the next lower number that
 * still exists), attributes included. The first version has no changes to show.
 */
export function changesOf(history: AgentHistory, n: number): FieldChange[] {
  const version = history.versions.find((v) => v.n === n);
  if (!version) return [];
  const before = history.versions
    .filter((v) => v.n < n)
    .reduce<AgentVersion | undefined>(
      (best, v) => (best === undefined || v.n > best.n ? v : best),
      undefined,
    );
  return before ? diffSnapshots(flat(before), flat(version)) : [];
}

export interface Pending {
  /** No version exists yet: the next experiment writes the first. */
  readonly first: boolean;
  readonly changes: readonly FieldChange[];
}

/** What looking at the agent now would write, without writing it; `undefined` when nothing differs. */
export function pendingChange(
  history: AgentHistory | undefined,
  snapshot: AgentSnapshot,
): Pending | undefined {
  const last = newest(history);
  if (!last) return { first: true, changes: [] };
  const changes = diffSnapshots(last.snapshot, snapshot);
  return changes.length === 0 ? undefined : { first: false, changes };
}

const emptyHistory = (key: AgentKey): AgentHistory => ({
  harnessId: key.harnessId,
  agentId: key.agentId,
  next: 1,
  versions: [],
});

/**
 * The agent has been looked at: the newest version if it still describes the agent, else a new one. A new
 * version keeps what people said about the version before it.
 */
export function observe(
  history: AgentHistory | undefined,
  key: AgentKey,
  snapshot: AgentSnapshot,
  at: string,
  by?: string,
): { history: AgentHistory; version: AgentVersion; created: boolean } {
  const last = newest(history);
  if (history && last && diffSnapshots(last.snapshot, snapshot).length === 0)
    return { history, version: last, created: false };
  const base = history ?? emptyHistory(key);
  const version: AgentVersion = {
    n: base.next,
    at,
    source: "auto",
    ...(by ? { by } : {}),
    snapshot,
    attributes: last?.attributes ?? {},
  };
  return {
    history: { ...base, next: base.next + 1, versions: [...base.versions, version] },
    version,
    created: true,
  };
}

export interface ManualVersion {
  readonly label?: string;
  readonly note?: string;
  /** Replaces the attributes of the version before; left out, they carry on. */
  readonly attributes?: Metadata;
}

/** A version a person declares: it takes the newest version's snapshot and what the person says on top. */
export function addManual(
  history: AgentHistory | undefined,
  key: AgentKey,
  snapshot: AgentSnapshot,
  at: string,
  by: string,
  input: ManualVersion,
): { history: AgentHistory; version: AgentVersion } {
  const base = history ?? emptyHistory(key);
  const last = newest(base);
  const version: AgentVersion = {
    n: base.next,
    at,
    source: "manual",
    by,
    snapshot: last?.snapshot ?? snapshot,
    ...(input.label ? { label: input.label } : {}),
    ...(input.note ? { note: input.note } : {}),
    attributes: input.attributes ?? last?.attributes ?? {},
  };
  return {
    history: { ...base, next: base.next + 1, versions: [...base.versions, version] },
    version,
  };
}

export interface VersionPatch {
  /** `null` removes it. */
  readonly label?: string | null;
  readonly note?: string | null;
  readonly attributes?: Metadata;
}

function versionOf(history: AgentHistory, n: number): AgentVersion {
  const found = history.versions.find((v) => v.n === n);
  if (!found) throw new NotFoundError(`버전 ${n}을 찾을 수 없어요`);
  return found;
}

/** Name, annotate or re-tag a version. What was observed (the snapshot and the date) does not change. */
export function editVersion(history: AgentHistory, n: number, patch: VersionPatch): AgentHistory {
  const found = versionOf(history, n);
  const { label: oldLabel, note: oldNote, ...rest } = found;
  const label = patch.label === undefined ? oldLabel : (patch.label ?? undefined);
  const note = patch.note === undefined ? oldNote : (patch.note ?? undefined);
  const edited: AgentVersion = {
    ...rest,
    ...(label ? { label } : {}),
    ...(note ? { note } : {}),
    attributes: patch.attributes ?? found.attributes,
  };
  return { ...history, versions: history.versions.map((v) => (v.n === n ? edited : v)) };
}

/** Take a version out. Its number is not given out again. */
export function removeVersion(history: AgentHistory, n: number): AgentHistory {
  versionOf(history, n);
  return { ...history, versions: history.versions.filter((v) => v.n !== n) };
}
