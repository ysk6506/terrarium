/**
 * What a person chose on the settings screen, kept in this browser (ADR-0028 style: every access is guarded,
 * and without storage a choice lasts the visit). One entry in `SETTING_DEFS` is one row of the screen, so a
 * new setting is a new key in `Settings` and a new entry here.
 */
import type { KeyValueStore } from "./identity";
import type { GraphicsChoice } from "./world3d/quality";

export interface Settings {
  readonly graphics: GraphicsChoice;
}

export type SettingKey = keyof Settings;

export interface SettingDef<K extends SettingKey = SettingKey> {
  readonly key: K;
  readonly label: string;
  readonly help: string;
  readonly options: readonly { readonly value: Settings[K]; readonly label: string }[];
}

export const DEFAULT_SETTINGS: Settings = { graphics: "auto" };

export const SETTINGS_KEY = "terrarium.settings";

const GRAPHICS: SettingDef<"graphics"> = {
  key: "graphics",
  label: "그래픽",
  help: "자동은 화면이 느려지면 스스로 가볍게 바꿔요. 높음은 항상 가장 고운 그림으로, 가볍게는 효과를 줄여서 부드럽게 보여 줘요.",
  options: [
    { value: "auto", label: "자동" },
    { value: "high", label: "높음" },
    { value: "light", label: "가볍게" },
  ],
};

/** The rows of the settings screen, top to bottom. */
export const SETTING_DEFS: readonly SettingDef[] = [GRAPHICS as SettingDef];

type Store = Pick<KeyValueStore, "getItem" | "setItem">;

/** Keep only values the screen offers; anything else (an old or hand-edited entry) falls back to the default. */
function validated(raw: unknown): Settings {
  const given = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const def of SETTING_DEFS)
    if (def.options.some((o) => o.value === given[def.key])) out[def.key] = given[def.key];
  return out as unknown as Settings;
}

/** The saved settings, or the defaults when nothing was saved, storage refuses, or the entry is damaged. */
export function readSettings(store: Pick<Store, "getItem"> | undefined): Settings {
  try {
    const text = store?.getItem(SETTINGS_KEY);
    return validated(text ? JSON.parse(text) : undefined);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Save one choice next to the others and return all settings; a storage that refuses still returns the choice. */
export function saveSetting<K extends SettingKey>(
  store: Store | undefined,
  key: K,
  value: Settings[K],
): Settings {
  const next = validated({ ...readSettings(store), [key]: value });
  try {
    store?.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // kept for this visit only
  }
  return next;
}
