/**
 * 저장해 둔 것(ADR-0092 결정 3, ADR-0112): 지시문·툴 묶음·절차서에 이름을 붙여 서버에 둔다. 이 파일은 화면이 서버와 주고받는
 * 모양(본문 부호화)과, 이 브라우저에 있던 옛 저장분을 서버로 한 번 옮기는 일을 맡는다.
 */
import type { PresetKind, PresetView } from "@terrarium/core/contract";
import type { KeyValueStore } from "./identity";

export type { PresetKind, PresetView };

/** What a kind keeps: a text, a list of tool names, a runbook. */
export interface PresetData {
  readonly instruction: string;
  readonly toolset: readonly string[];
  readonly runbook: { readonly title: string; readonly steps: readonly unknown[] };
}

/** The body the server keeps for something the person has in front of them. */
export function encode<K extends PresetKind>(kind: K, data: PresetData[K]): string {
  return kind === "instruction" ? (data as string) : JSON.stringify(data);
}

/** What a saved body is, or nothing when it cannot be read (the server checks bodies, so this is a safety net). */
export function decode<K extends PresetKind>(kind: K, body: string): PresetData[K] | undefined {
  if (kind === "instruction") return body as PresetData[K];
  try {
    const parsed: unknown = JSON.parse(body);
    const fits =
      kind === "toolset"
        ? Array.isArray(parsed)
        : Array.isArray((parsed as { steps?: unknown } | null)?.steps);
    return fits ? (parsed as PresetData[K]) : undefined;
  } catch {
    return undefined;
  }
}

// ── what this browser kept before the server did ──────────────────────────────────────────────

const LEGACY_TOOLS = "terrarium.presets.tools.v1";
const LEGACY_RUNBOOK = "terrarium.presets.runbook.v1";
const LEGACY_INSTRUCTIONS = "terrarium.operation.instructions";

/** One saved thing found in this browser, as the server takes it. */
export interface LegacyItem {
  readonly kind: PresetKind;
  readonly name: string;
  readonly body: string;
  readonly createdAt?: string;
}

function readJson(store: KeyValueStore | undefined, key: string): unknown {
  try {
    const raw = store?.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function listed(store: KeyValueStore | undefined, key: string, kind: PresetKind): LegacyItem[] {
  const all = readJson(store, key);
  if (!Array.isArray(all)) return [];
  return all.flatMap(
    (p: { name?: unknown; data?: unknown; savedAt?: unknown; deletedAt?: unknown }) =>
      typeof p?.name === "string" && p.data !== undefined && p.deletedAt === undefined
        ? [
            {
              kind,
              name: p.name,
              body: encode(kind, p.data as never),
              ...(typeof p.savedAt === "string" ? { createdAt: p.savedAt } : {}),
            },
          ]
        : [],
  );
}

/** Everything the old localStorage holds: tool sets, runbooks (not the ones deleted) and instructions. */
export function legacyItems(store: KeyValueStore | undefined): LegacyItem[] {
  const instructions = readJson(store, LEGACY_INSTRUCTIONS);
  const texts =
    instructions && typeof instructions === "object" && !Array.isArray(instructions)
      ? Object.entries(instructions as Record<string, unknown>).flatMap(([name, text]) =>
          typeof text === "string" && text.trim() !== ""
            ? [{ kind: "instruction" as const, name, body: text }]
            : [],
        )
      : [];
  return [
    ...listed(store, LEGACY_TOOLS, "toolset"),
    ...listed(store, LEGACY_RUNBOOK, "runbook"),
    ...texts,
  ];
}

/** Forget the old copies, once the server has them. */
export function clearLegacy(store: KeyValueStore | undefined): void {
  for (const key of [LEGACY_TOOLS, LEGACY_RUNBOOK, LEGACY_INSTRUCTIONS]) {
    try {
      store?.removeItem(key);
    } catch {
      // a browser that refuses storage keeps them; the server skips names it already has
    }
  }
}

/** Move what this browser kept to the server and forget it. Says whether anything was moved; a failure keeps the old copies for next time. */
export async function moveLegacy(
  store: KeyValueStore | undefined,
  send: (items: LegacyItem[]) => Promise<unknown>,
): Promise<boolean> {
  const items = legacyItems(store);
  if (items.length === 0) {
    clearLegacy(store);
    return false;
  }
  try {
    await send(items);
  } catch {
    return false;
  }
  clearLegacy(store);
  return true;
}

export const PRESET_WORDS = {
  TITLE: {
    instruction: "지시문",
    toolset: "툴 묶음",
    runbook: "내 절차서",
  } as Readonly<Record<PresetKind, string>>,
  NAME: "이름",
  SAVE: "이름 붙여 저장",
  LOAD: "불러오기",
  DELETE: "지우기",
  RENAME: "이름 바꾸기",
  NEW_NAME: "바꿀 이름",
  NONE: "아직 저장해 둔 것이 없어요",
  PICK: "저장해 둔 것 고르기",
  UNDO: "되돌리기",
  MOVED: "이 브라우저에 있던 저장분을 서버로 옮겼어요",
  undo: (name: string) => `'${name}'을 지웠어요. 7일 안에는 되돌릴 수 있어요`,
  saved: (name: string) => `'${name}'을 저장했어요`,
} as const;
