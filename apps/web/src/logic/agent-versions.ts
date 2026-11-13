/**
 * The version history of an agent, as the screen reads it (REQ-053): what a change looks like in words,
 * what the next experiment would do, and the form a person fills to add or annotate a version.
 */
import type { AgentHistoryView, AgentVersionView } from "@terrarium/core/contract";
import type { FieldChange } from "@terrarium/core/experiments";
import { type MetaRow, metadataOf } from "./connections";

export interface VersionForm {
  readonly label: string;
  readonly note: string;
  readonly attributes: readonly MetaRow[];
}

/** The form for a version: its own name, note and attributes, or empty for a new one. */
export function versionFormOf(
  version?: Pick<AgentVersionView, "label" | "note" | "attributes">,
): VersionForm {
  return {
    label: version?.label ?? "",
    note: version?.note ?? "",
    attributes: Object.entries(version?.attributes ?? {}).map(([key, value]) => ({ key, value })),
  };
}

/** A new version by hand: only what was written goes, and the attributes are the ones on the form. */
export function addRequest(form: VersionForm): {
  label?: string;
  note?: string;
  attributes: Record<string, string>;
} {
  return {
    ...(form.label.trim() ? { label: form.label.trim() } : {}),
    ...(form.note.trim() ? { note: form.note.trim() } : {}),
    attributes: metadataOf(form.attributes),
  };
}

/** Changing a version: a name or a note emptied on the form is removed (`null`). */
export function editRequest(form: VersionForm): {
  label: string | null;
  note: string | null;
  attributes: Record<string, string>;
} {
  return {
    label: form.label.trim() || null,
    note: form.note.trim() || null,
    attributes: metadataOf(form.attributes),
  };
}

/** "v3" or "v3 · 프롬프트 v3". */
export const versionTitle = (v: Pick<AgentVersionView, "n" | "label">): string =>
  v.label ? `v${v.n} · ${v.label}` : `v${v.n}`;

/** A field before and after, in words: a missing side is said, not left blank. */
export function changeText(c: FieldChange): { before: string; after: string } {
  return { before: c.before ?? "(없었어요)", after: c.after ?? "(없어졌어요)" };
}

export interface Pending {
  readonly tone: "plain" | "warn" | "good";
  readonly text: string;
  readonly changes: readonly FieldChange[];
}

/** What an experiment made now would do to the history. */
export function pendingOf(history: AgentHistoryView): Pending {
  if (history.pendingError)
    return {
      tone: "warn",
      text: `지금은 에이전트를 볼 수 없어 다음 실험이 새 버전을 만드는지 알 수 없어요. ${history.pendingError}`,
      changes: [],
    };
  if (history.pending?.first)
    return {
      tone: "plain",
      text: "아직 버전이 없어요. 이 에이전트로 실험을 만들면 v1이 생겨요.",
      changes: [],
    };
  if (history.pending)
    return {
      tone: "warn",
      text: `지금 실험을 만들면 새 버전이 생겨요. 앞 버전 v${history.versions[0]?.n}과 다른 점은 아래와 같아요.`,
      changes: history.pending.changes,
    };
  const newest = history.versions[0];
  return {
    tone: "good",
    text: newest
      ? `지금 실험을 만들어도 새 버전은 생기지 않아요. 가장 새 버전 v${newest.n}과 같아요.`
      : "지금은 버전이 없어요.",
    changes: [],
  };
}

/**
 * Who may add, change or remove versions (permissions.md section 4): the one who connected it and administrators; for a
 * connection from the server's config file only administrators. The button is hidden from everyone else, since pressing it
 * would only bring a 403.
 */
export const canEditVersions = (
  connection: { readonly source: "config" | "screen"; readonly owner?: string } | undefined,
  me: string | undefined,
  admin: boolean,
): boolean => {
  if (!connection) return false;
  if (connection.source === "config") return admin;
  return admin || (connection.owner !== undefined && connection.owner === me);
};
