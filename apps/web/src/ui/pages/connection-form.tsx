/**
 * The pieces of the connection form (REQ-051, REQ-052): a field drawn from what the connector says about it,
 * and the editors for headers and metadata. They only draw and report; what the form means is in logic/connections.
 */
import type { ConnectorField } from "@terrarium/core/contract";
import type { ReactNode } from "react";
import type { ConnectionForm, HeaderRow, MetaRow } from "../../logic";
import { Button, Check, SelectField, TextField } from "../kit";

type Patch = (change: Partial<ConnectionForm>) => void;

const MULTILINE: ReadonlyArray<ConnectorField["type"]> = ["textarea", "lines", "json"];

const hintOf = (field: ConnectorField): ReactNode => {
  const extra =
    field.type === "lines"
      ? "한 줄에 하나씩 적어요."
      : field.type === "json"
        ? "JSON 형식으로 적어요."
        : field.type === "env"
          ? "값이 아니라 서버에 있는 환경 변수의 이름을 적어요."
          : "";
  return [field.help, extra].filter(Boolean).join(" ") || undefined;
};

/** A token or password: blank keeps what the server holds, and the person can choose to remove it. */
function SecretField({
  field,
  form,
  kept,
  error,
  patch,
}: {
  readonly field: ConnectorField;
  readonly form: ConnectionForm;
  readonly kept: boolean;
  readonly error?: string;
  readonly patch: Patch;
}) {
  const cleared = form.cleared.includes(field.key);
  const set = (value: string) =>
    patch({
      values: { ...form.values, [field.key]: value },
      cleared: form.cleared.filter((k) => k !== field.key),
    });
  return (
    <div className="stack" style={{ gap: 6 }}>
      <TextField
        secret
        label={field.required ? field.label : `${field.label} (선택)`}
        value={form.values[field.key] ?? ""}
        onChange={set}
        help={
          kept && !cleared
            ? `설정돼 있어요. 비워 두면 그대로 두고, 새로 적으면 바꿔요. ${hintOf(field) ?? ""}`
            : hintOf(field)
        }
        placeholder={kept && !cleared ? "설정됨" : field.placeholder}
        error={error}
      />
      {kept && !cleared && !form.values[field.key] && (
        <div>
          <Button
            size="small"
            kind="quiet"
            onClick={() => patch({ cleared: [...form.cleared, field.key] })}
          >
            저장된 값 지우기
          </Button>
        </div>
      )}
      {cleared && (
        <div className="row">
          <span className="small muted">저장하면 이 값을 지워요.</span>
          <Button
            size="small"
            kind="quiet"
            onClick={() => patch({ cleared: form.cleared.filter((k) => k !== field.key) })}
          >
            되돌리기
          </Button>
        </div>
      )}
    </div>
  );
}

/** One input of a connector, picked by the kind of value it takes. */
export function ConnectorFieldInput({
  field,
  form,
  kept,
  error,
  patch,
}: {
  readonly field: ConnectorField;
  readonly form: ConnectionForm;
  readonly kept: boolean;
  readonly error?: string;
  readonly patch: Patch;
}) {
  const value = form.values[field.key] ?? "";
  const set = (v: string) => patch({ values: { ...form.values, [field.key]: v } });
  const label = field.required ? field.label : `${field.label} (선택)`;
  if (field.type === "secret")
    return <SecretField field={field} form={form} kept={kept} error={error} patch={patch} />;
  if (field.type === "boolean")
    return (
      <Check
        label={field.label}
        checked={value === "true"}
        onChange={(v) => set(String(v))}
        hint={field.help}
      />
    );
  if (field.type === "select")
    return (
      <SelectField
        label={label}
        value={value || undefined}
        options={field.options ?? []}
        onChange={set}
        help={hintOf(field)}
        error={error}
      />
    );
  return (
    <TextField
      label={label}
      value={value}
      onChange={set}
      help={hintOf(field)}
      placeholder={field.placeholder}
      multiline={MULTILINE.includes(field.type)}
      error={error}
    />
  );
}

const replaceAt = <T,>(rows: readonly T[], i: number, row: T): T[] =>
  rows.map((r, k) => (k === i ? row : r));

/** Headers sent with every request: name, value, and whether the value is a secret. */
export function HeaderEditor({
  rows,
  problems,
  onChange,
}: {
  readonly rows: readonly HeaderRow[];
  readonly problems: Readonly<Record<string, string>>;
  readonly onChange: (rows: HeaderRow[]) => void;
}) {
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        사내 게이트웨이가 Authorization 말고 다른 헤더를 요구할 때 써요. 이 연결의 모든 요청에
        붙어요.
      </p>
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity until saved
        <div className="stack" key={i} style={{ gap: 4 }}>
          <div className="pair-row pair-row-header">
            <input
              className="input"
              aria-label={`헤더 ${i + 1} 이름`}
              placeholder="X-Api-Key"
              value={row.name}
              onChange={(e) => onChange(replaceAt(rows, i, { ...row, name: e.target.value }))}
            />
            <input
              className="input"
              aria-label={`헤더 ${i + 1} 값`}
              placeholder={row.kept && row.secret ? "설정됨" : "값"}
              value={row.value}
              {...(row.secret ? { type: "password", autoComplete: "new-password" } : {})}
              onChange={(e) => onChange(replaceAt(rows, i, { ...row, value: e.target.value }))}
            />
            <Check
              label="비밀"
              checked={row.secret}
              onChange={(secret) =>
                onChange(replaceAt(rows, i, { ...row, secret, kept: secret && row.kept }))
              }
            />
            <Button
              size="small"
              kind="quiet"
              aria-label={`헤더 ${i + 1} 지우기`}
              onClick={() => onChange(rows.filter((_, k) => k !== i))}
            >
              지우기
            </Button>
          </div>
          {problems[`header.${i}`] && (
            <span className="field-error" role="alert">
              {problems[`header.${i}`]}
            </span>
          )}
        </div>
      ))}
      <div>
        <Button
          size="small"
          onClick={() => onChange([...rows, { name: "", value: "", secret: true, kept: false }])}
        >
          헤더 더하기
        </Button>
      </div>
    </div>
  );
}

/** Name=value pairs attached to every experiment run on the connection, to tell results apart. */
export function MetaEditor({
  rows,
  problems,
  onChange,
  hint = '이 연결로 돌린 모든 실험에 붙어요. 결과를 견줄 때 "무엇이 달랐나"를 가르는 이름표예요(예: 팀=검색, 프롬프트=v3).',
}: {
  /** What these rows are attached to, in a sentence. */
  readonly hint?: string;
  readonly rows: readonly MetaRow[];
  readonly problems: Readonly<Record<string, string>>;
  readonly onChange: (rows: MetaRow[]) => void;
}) {
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        {hint}
      </p>
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity until saved
        <div className="stack" key={i} style={{ gap: 4 }}>
          <div className="pair-row pair-row-meta">
            <input
              className="input"
              aria-label={`메타데이터 ${i + 1} 이름`}
              placeholder="이름"
              value={row.key}
              onChange={(e) => onChange(replaceAt(rows, i, { ...row, key: e.target.value }))}
            />
            <input
              className="input"
              aria-label={`메타데이터 ${i + 1} 값`}
              placeholder="값"
              value={row.value}
              onChange={(e) => onChange(replaceAt(rows, i, { ...row, value: e.target.value }))}
            />
            <Button
              size="small"
              kind="quiet"
              aria-label={`메타데이터 ${i + 1} 지우기`}
              onClick={() => onChange(rows.filter((_, k) => k !== i))}
            >
              지우기
            </Button>
          </div>
          {problems[`meta.${i}`] && (
            <span className="field-error" role="alert">
              {problems[`meta.${i}`]}
            </span>
          )}
        </div>
      ))}
      <div>
        <Button size="small" onClick={() => onChange([...rows, { key: "", value: "" }])}>
          메타데이터 더하기
        </Button>
      </div>
    </div>
  );
}
