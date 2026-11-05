/**
 * Presets of the connection form (REQ-079, ADR-0085): a few questions that stand for a whole template. The
 * connector says what to ask and what to fix (`ConnectorSpec.presets`); this turns the answers into the
 * connector's own settings, and reads them back when a connection is edited. It knows no protocol.
 */
import type { ConnectorField, ConnectorPreset, ConnectorSpec } from "@terrarium/core/contract";

type Typed = Readonly<Record<string, string>>;
type Settings = Record<string, string | number | boolean>;

/** The key of the preset a form is on; empty is "write it all by hand". */
export const CUSTOM_PRESET = "";

export const presetOf = (
  spec: ConnectorSpec,
  key: string | undefined,
): ConnectorPreset | undefined => spec.presets?.find((p) => p.key === key);

/** Text that sits inside a JSON string: quotes and line breaks are escaped. */
const inJson = (value: string): string => JSON.stringify(value).slice(1, -1);

/** `[[model]]` becomes what was typed in the field `model`. */
const fill = (template: string, typed: Typed): string =>
  template.replace(/\[\[([A-Za-z]+)\]\]/g, (_, key: string) => inJson((typed[key] ?? "").trim()));

/** The address split in two: where the API lives, and the path the preset's requests go to. */
export function splitAddress(
  raw: string,
  urlPath: NonNullable<ConnectorPreset["urlPath"]>,
): { readonly url: string; readonly path: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return undefined;
  }
  const own = parsed.pathname.replace(/\/+$/, "");
  const append = urlPath.append ?? "";
  const path = append && !own.endsWith(append) ? `${own}${append}` : own;
  return { url: parsed.origin, path: `${path === "" ? "/" : path}${parsed.search}` };
}

/** The answers that go into the settings as typed (not secrets, and not the address that is split in two). */
function typedAnswers(preset: ConnectorPreset, typed: Typed): Settings {
  const out: Settings = {};
  for (const field of preset.fields) {
    const raw = (typed[field.key] ?? "").trim();
    const splitLater = preset.urlPath !== undefined && field.key === "url";
    if (raw !== "" && field.type !== "secret" && !splitLater) out[field.key] = raw;
  }
  return out;
}

/** The settings a preset and its answers stand for. */
export function presetSettings(preset: ConnectorPreset, typed: Typed): Settings {
  const out: Settings = {};
  for (const [key, value] of Object.entries(preset.fixed))
    out[key] = typeof value === "string" ? fill(value, typed) : value;
  Object.assign(out, typedAnswers(preset, typed));
  const split = preset.urlPath ? splitAddress(typed.url ?? "", preset.urlPath) : undefined;
  if (preset.urlPath && split) {
    out.url = split.url;
    out[preset.urlPath.into] = split.path;
  }
  return out;
}

/** What a field has by default, as the form holds it. */
const defaultOf = (f: ConnectorField): string => (f.default === undefined ? "" : String(f.default));

/** The fields the "고급" fold still shows: the connector's own, less the ones the preset asks above. */
export function advancedFields(spec: ConnectorSpec, preset: ConnectorPreset): ConnectorField[] {
  const asked = new Set(preset.fields.map((f) => f.key));
  return spec.fields.filter((f) => !asked.has(f.key));
}

/**
 * What the fold changed from its defaults. Only a field that differs counts, so a preset's own setting is
 * not overwritten by a default the person never touched.
 */
export function advancedChanges(
  spec: ConnectorSpec,
  preset: ConnectorPreset,
  values: Typed,
): ConnectorField[] {
  return advancedFields(spec, preset).filter((f) => (values[f.key] ?? "") !== defaultOf(f));
}

/** The address a person would have typed, rebuilt from the settings of a saved connection. */
export function typedUrl(
  preset: ConnectorPreset,
  config: Readonly<Record<string, unknown>>,
): string {
  const url = typeof config.url === "string" ? config.url : "";
  const into = preset.urlPath?.into;
  const path = into && typeof config[into] === "string" ? (config[into] as string) : "";
  const append = preset.urlPath?.append ?? "";
  const bare = path.split("?")[0] ?? "";
  const shortPath = append && bare.endsWith(append) ? bare.slice(0, -append.length) : bare;
  const query = path.includes("?") ? `?${path.split("?").slice(1).join("?")}` : "";
  return `${url.replace(/\/+$/, "")}${shortPath === "/" ? "" : shortPath}${query}`;
}

/** Whether the typed address is one a preset can use. */
export function addressProblem(preset: ConnectorPreset, raw: string): string | undefined {
  if (raw.trim() === "") return "주소를 적어 주세요";
  return preset.urlPath && !splitAddress(raw, preset.urlPath)
    ? "주소 형식이 맞지 않아요"
    : undefined;
}

/** What is missing in the few questions of a preset, by field key. */
export function presetProblems(
  preset: ConnectorPreset,
  values: Typed,
  kept: readonly string[],
  cleared: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of preset.fields) {
    const raw = values[f.key] ?? "";
    const has =
      f.type === "secret"
        ? raw !== "" || (kept.includes(f.key) && !cleared.includes(f.key))
        : raw.trim() !== "";
    if (f.key === "url") {
      const why = addressProblem(preset, raw);
      if (why) out.url = why;
    } else if (f.required && !has) out[f.key] = `${f.label}을(를) 적어 주세요`;
  }
  return out;
}
