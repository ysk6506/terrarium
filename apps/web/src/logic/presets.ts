/**
 * Saved sets (ADR-0092 item 3, "저장해 두기" for tool sets and runbooks): a name on a set, to load, change and delete
 * later. They live in this browser; a deleted one can be brought back for seven days. Pure over a key-value store, so
 * a test can read it.
 */
import type { KeyValueStore } from "./identity";

export type PresetKind = "tools" | "runbook";

export interface Preset<T> {
  readonly id: string;
  readonly name: string;
  readonly data: T;
  /** ISO time it was saved or last changed. */
  readonly savedAt: string;
  /** ISO time it was deleted; kept for a week. */
  readonly deletedAt?: string;
}

export const UNDO_DAYS = 7;
const DAY_MS = 86_400_000;

const keyOf = (kind: PresetKind) => `terrarium.presets.${kind}.v1`;

function readAll<T>(store: KeyValueStore | undefined, kind: PresetKind): Preset<T>[] {
  try {
    const raw = store?.getItem(keyOf(kind));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Preset<T>[]) : [];
  } catch {
    return [];
  }
}

function writeAll<T>(store: KeyValueStore | undefined, kind: PresetKind, all: Preset<T>[]): void {
  try {
    store?.setItem(keyOf(kind), JSON.stringify(all));
  } catch {
    // a browser that refuses storage just forgets; the set in front of the person is not lost
  }
}

/** The saved sets, newest first, without the deleted ones. */
export function listPresets<T>(store: KeyValueStore | undefined, kind: PresetKind): Preset<T>[] {
  return readAll<T>(store, kind)
    .filter((p) => p.deletedAt === undefined)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** The ones deleted within the last week, newest first. */
export function deletedPresets<T>(
  store: KeyValueStore | undefined,
  kind: PresetKind,
  now: Date,
): Preset<T>[] {
  return readAll<T>(store, kind)
    .filter(
      (p) =>
        p.deletedAt !== undefined && now.getTime() - Date.parse(p.deletedAt) < UNDO_DAYS * DAY_MS,
    )
    .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
}

/** Save a set under a name; the same name changes the set it names. Returns the saved one. */
export function savePreset<T>(
  store: KeyValueStore | undefined,
  kind: PresetKind,
  name: string,
  data: T,
  now: Date,
): Preset<T> | undefined {
  const clean = name.trim();
  if (clean === "") return undefined;
  const all = readAll<T>(store, kind).filter(
    (p) => !(p.name === clean && p.deletedAt === undefined),
  );
  const saved: Preset<T> = {
    id: `p${now.getTime().toString(36)}${all.length}`,
    name: clean,
    data,
    savedAt: now.toISOString(),
  };
  writeAll(store, kind, [...all, saved]);
  return saved;
}

/** Delete a set; it can be brought back for a week. */
export function removePreset(
  store: KeyValueStore | undefined,
  kind: PresetKind,
  id: string,
  now: Date,
): void {
  const week = now.getTime() - UNDO_DAYS * DAY_MS;
  const all = readAll<unknown>(store, kind)
    .map((p) => (p.id === id ? { ...p, deletedAt: now.toISOString() } : p))
    .filter((p) => p.deletedAt === undefined || Date.parse(p.deletedAt) >= week);
  writeAll(store, kind, all);
}

/** Bring a deleted set back. */
export function restorePreset(
  store: KeyValueStore | undefined,
  kind: PresetKind,
  id: string,
): void {
  const all = readAll<unknown>(store, kind).map((p) => {
    if (p.id !== id) return p;
    const { deletedAt: _gone, ...kept } = p;
    return kept as Preset<unknown>;
  });
  writeAll(store, kind, all);
}

export const PRESET_WORDS = {
  TITLE: { tools: "툴 묶음", runbook: "내 절차서" } as Readonly<Record<PresetKind, string>>,
  NAME: "이름",
  SAVE: "이름 붙여 저장",
  LOAD: "불러오기",
  DELETE: "지우기",
  NONE: "아직 저장해 둔 것이 없어요",
  PICK: "저장해 둔 것 고르기",
  undo: (name: string) => `'${name}'을 지웠어요. 7일 안에는 되돌릴 수 있어요`,
  UNDO: "되돌리기",
} as const;
