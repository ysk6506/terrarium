/**
 * The connection form, as plain data (REQ-051, REQ-052): what a connector's fields start as, what is sent
 * when the form is saved, and what is still missing. The screen only draws it. Tokens and passwords are
 * never in a view the server sends back, so a secret field starts blank and blank means "keep what is
 * kept"; clearing one is a separate choice.
 */
import type { ConnectionHeader, ConnectionView, ConnectorSpec } from "@terrarium/core/contract";

export interface HeaderRow {
  readonly name: string;
  readonly value: string;
  readonly secret: boolean;
  /** A secret header the server already holds: a blank value keeps it. */
  readonly kept: boolean;
}

export interface MetaRow {
  readonly key: string;
  readonly value: string;
}

export interface ConnectionForm {
  readonly name: string;
  readonly description: string;
  /** What is typed in each field, by key. Booleans are "true"/"false", lists and JSON stay as text. */
  readonly values: Readonly<Record<string, string>>;
  /** Secret fields the person chose to remove. */
  readonly cleared: readonly string[];
  readonly headers: readonly HeaderRow[];
  readonly metadata: readonly MetaRow[];
}

const text = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "";

/** A new connection to a connector: every field at its default. */
export function blankForm(spec: ConnectorSpec): ConnectionForm {
  return {
    name: "",
    description: "",
    values: Object.fromEntries(
      spec.fields.map((f) => [f.key, f.default === undefined ? "" : String(f.default)]),
    ),
    cleared: [],
    headers: [],
    metadata: [],
  };
}

function shown(type: ConnectorSpec["fields"][number]["type"], value: unknown): string {
  if (type === "secret" || value === undefined || value === null) return "";
  if (type === "lines") return Array.isArray(value) ? value.map(text).join("\n") : text(value);
  if (type === "json") return JSON.stringify(value, null, 2);
  return text(value);
}

const headerRow = (h: ConnectionHeader): HeaderRow => ({
  name: h.name,
  value: h.value ?? "",
  secret: h.secret,
  kept: h.secret,
});

/** The form of a connection that already exists: what it was made with, without the secrets. */
export function formOf(spec: ConnectorSpec, view: ConnectionView): ConnectionForm {
  return {
    name: view.name,
    description: view.description ?? "",
    values: Object.fromEntries(spec.fields.map((f) => [f.key, shown(f.type, view.config[f.key])])),
    cleared: [],
    headers: view.headers.map(headerRow),
    metadata: Object.entries(view.metadata).map(([key, value]) => ({ key, value })),
  };
}

function valueFor(
  field: ConnectorSpec["fields"][number],
  raw: string,
  cleared: boolean,
): unknown | undefined {
  const typed = raw.trim();
  switch (field.type) {
    case "secret":
      return raw !== "" ? raw : cleared ? null : undefined;
    case "boolean":
      return raw === "true";
    case "number":
      return typed === "" ? undefined : Number(typed);
    case "lines": {
      const lines = raw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      return lines.length === 0 ? undefined : lines;
    }
    case "json":
      return typed === "" ? undefined : JSON.parse(typed);
    default:
      return typed === "" ? undefined : typed;
  }
}

/** What goes in the request's `config`: only what was given, a cleared secret as `null`. */
export function configOf(spec: ConnectorSpec, form: ConnectionForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of spec.fields) {
    const v = valueFor(field, form.values[field.key] ?? "", form.cleared.includes(field.key));
    if (v !== undefined) out[field.key] = v;
  }
  return out;
}

/** The headers to send: rows without a name are dropped, a kept secret goes without its value. */
export function headersOf(
  rows: readonly HeaderRow[],
): Array<{ name: string; secret: boolean; value?: string }> {
  return rows
    .filter((r) => r.name.trim() !== "")
    .map((r) => {
      const name = r.name.trim();
      return r.secret && r.kept && r.value === ""
        ? { name, secret: true }
        : { name, secret: r.secret, value: r.value };
    });
}

/** The metadata to send: rows without a name are dropped. */
export function metadataOf(rows: readonly MetaRow[]): Record<string, string> {
  return Object.fromEntries(
    rows.filter((r) => r.key.trim() !== "").map((r) => [r.key.trim(), r.value.trim()]),
  );
}

/** Whether a field has something in it (a kept secret counts, unless it was chosen to be cleared). */
function filled(
  field: ConnectorSpec["fields"][number],
  form: ConnectionForm,
  kept: readonly string[],
): boolean {
  const raw = form.values[field.key] ?? "";
  if (field.type === "secret")
    return raw !== "" || (kept.includes(field.key) && !form.cleared.includes(field.key));
  return field.type === "boolean" || raw.trim() !== "";
}

/** What is wrong with the way a typed value is written, or nothing. */
function shapeProblem(
  type: ConnectorSpec["fields"][number]["type"],
  raw: string,
): string | undefined {
  if (raw.trim() === "") return undefined;
  if (type === "number") return Number.isFinite(Number(raw)) ? undefined : "숫자로 적어 주세요";
  if (type !== "json") return undefined;
  try {
    JSON.parse(raw);
    return undefined;
  } catch {
    return "JSON 형식이 맞지 않아요";
  }
}

/** What is wrong with one field's value, or nothing. */
function fieldProblem(
  field: ConnectorSpec["fields"][number],
  form: ConnectionForm,
  kept: readonly string[],
): string | undefined {
  if (field.required && !filled(field, form, kept)) return `${field.label}을(를) 적어 주세요`;
  return shapeProblem(field.type, form.values[field.key] ?? "");
}

/** What is wrong with the form before anything is sent, by field key (`name`, `header.0`, `meta.1`, …). */
export function formProblems(
  spec: ConnectorSpec,
  form: ConnectionForm,
  kept: readonly string[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (form.name.trim() === "") out.name = "이름을 적어 주세요";
  for (const field of spec.fields) {
    const problem = fieldProblem(field, form, kept);
    if (problem) out[field.key] = problem;
  }
  form.headers.forEach((h, i) => {
    if (h.name.trim() !== "" && h.value === "" && !(h.secret && h.kept))
      out[`header.${i}`] = "값을 적어 주세요";
  });
  return { ...out, ...metaProblems(form.metadata) };
}

/** What is wrong with name=value rows, by `meta.<row>`: a name that cannot be used, a missing value. */
export function metaProblems(rows: readonly MetaRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  rows.forEach((m, i) => {
    if (m.key.trim() === "") return;
    if (!/^[\p{L}\p{N}._-]{1,40}$/u.test(m.key.trim()))
      out[`meta.${i}`] = "이름은 글자·숫자·._-로 40자까지 쓸 수 있어요";
    else if (m.value.trim() === "") out[`meta.${i}`] = "값을 적어 주세요";
  });
  return out;
}

/** How soon a connection made on the screen is removed for lack of use, in words that say what to do. */
export interface Expiry {
  readonly state: "none" | "ok" | "soon";
  readonly label: string;
}

export const EXPIRY_WARNING_DAYS = 7;

export function expiryOf(view: Pick<ConnectionView, "source" | "daysLeft">): Expiry {
  if (view.source !== "screen" || view.daysLeft === undefined) return { state: "none", label: "" };
  const days = Math.max(0, Math.ceil(view.daysLeft));
  if (days <= EXPIRY_WARNING_DAYS)
    return {
      state: "soon",
      label: days === 0 ? "오늘 안에 지워져요" : `안 쓰면 ${days}일 뒤 지워져요`,
    };
  return { state: "ok", label: `${days}일 뒤까지 안 쓰면 지워져요` };
}

/** The banner on every page: connections of the viewer's that are about to be removed. */
export function expiringNotice(
  expiring: ReadonlyArray<{ readonly name: string; readonly daysLeft: number }> | undefined,
): string | undefined {
  if (!expiring || expiring.length === 0) return undefined;
  const soonest = expiring.reduce((a, b) => (b.daysLeft < a.daysLeft ? b : a));
  const days = Math.max(0, Math.ceil(soonest.daysLeft));
  const when = days === 0 ? "오늘" : `${days}일 안에`;
  const what =
    expiring.length === 1 ? `'${soonest.name}'` : `'${soonest.name}' 외 ${expiring.length - 1}개`;
  return `${what} 연결이 ${when} 지워져요. 계속 쓰려면 연결 화면에서 '계속 쓰기'를 눌러 주세요`;
}

/** How a connector's tool transport reads on the screen. */
export const TRANSPORT_LABELS: Readonly<Record<ConnectorSpec["toolTransport"], string>> = {
  mcp: "MCP로 툴을 받아요",
  "function-calling": "함수 호출로 툴을 받아요",
  "in-process": "테라리움 안에서 바로 툴을 써요",
};
