/**
 * "이 하네스의 트레이스는 어디에 쌓이나요?" on the connection form (REQ-079, ADR-0085): the choice as plain
 * data, what is sent, and what is still missing. The tools come from the server (`TelemetryAdapterList`), so a
 * new one needs no change here.
 */
import type {
  ConnectionTraces,
  ConnectorField,
  TelemetryAdapterList,
  TelemetryAdapterSpec,
} from "@terrarium/core/contract";

export interface TracesForm {
  /** "none", "default" (the server's), or a telemetry adapter's kind. */
  readonly kind: string;
  /** What is typed in the fields of that tool, by key. */
  readonly values: Readonly<Record<string, string>>;
  /** Secret fields the person chose to remove. */
  readonly cleared: readonly string[];
}

export const TRACES_QUESTION = "이 하네스의 트레이스는 어디에 쌓이나요?";

const text = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "";

/** The tool of a kind, if the server has it. */
export const adapterSpecOf = (
  list: TelemetryAdapterList | undefined,
  kind: string,
): TelemetryAdapterSpec | undefined => list?.adapters.find((a) => a.kind === kind);

/** The choices: none, each tool the server knows, and the server's own default when it has one. */
export function tracesOptions(
  list: TelemetryAdapterList | undefined,
): Array<{ value: string; label: string }> {
  return [
    { value: "none", label: "없음" },
    ...(list?.adapters ?? []).map((a) => ({ value: a.kind, label: a.label })),
    ...(list?.serverDefault
      ? [{ value: "default", label: `서버 기본값 (${list.serverDefault.name})` }]
      : []),
  ];
}

/** A new connection: the server's default when it has one, else none. */
export function blankTraces(list: TelemetryAdapterList | undefined): TracesForm {
  return { kind: list?.serverDefault ? "default" : "none", values: {}, cleared: [] };
}

const defaultsOf = (fields: readonly ConnectorField[]): Record<string, string> =>
  Object.fromEntries(fields.map((f) => [f.key, f.default === undefined ? "" : String(f.default)]));

/** Moving to another tool starts that tool's form at its defaults. */
export function tracesKind(list: TelemetryAdapterList | undefined, kind: string): TracesForm {
  return { kind, values: defaultsOf(adapterSpecOf(list, kind)?.fields ?? []), cleared: [] };
}

/** The form of a connection that exists: what its choice was made with, without the secrets. */
export function tracesFormOf(traces: ConnectionTraces): TracesForm {
  return {
    kind: traces.kind,
    values: Object.fromEntries(Object.entries(traces.config).map(([k, v]) => [k, text(v)])),
    cleared: [],
  };
}

/** The `traces` of a request. Settings of the chosen tool only; a tool with no form sends none. */
export function tracesRequest(
  list: TelemetryAdapterList | undefined,
  form: TracesForm,
  settings: (
    fields: readonly ConnectorField[],
    values: Readonly<Record<string, string>>,
    cleared: readonly string[],
  ) => Record<string, unknown>,
): { kind: string; config: Record<string, unknown> } {
  const spec = adapterSpecOf(list, form.kind);
  return { kind: form.kind, config: spec ? settings(spec.fields, form.values, form.cleared) : {} };
}

/** What is missing from the chosen tool's form, by `traces.<key>` (the server uses the same names). */
export function tracesProblems(
  list: TelemetryAdapterList | undefined,
  form: TracesForm,
  kept: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of adapterSpecOf(list, form.kind)?.fields ?? []) {
    const raw = form.values[f.key] ?? "";
    const has =
      f.type === "secret"
        ? raw !== "" || (kept.includes(f.key) && !form.cleared.includes(f.key))
        : raw.trim() !== "";
    if (f.required && !has) out[`traces.${f.key}`] = `${f.label}을(를) 적어 주세요`;
  }
  return out;
}

/** The line under a connection that says where its traces go. */
export function tracesLabel(traces: ConnectionTraces): string {
  if (traces.kind === "none") return "트레이스: 쌓지 않아요";
  return `트레이스: ${traces.name ?? traces.kind}`;
}
