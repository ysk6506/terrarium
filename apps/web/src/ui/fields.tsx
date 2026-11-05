/** Form controls: every one has its label tied to it and its error announced (kit.tsx re-exports them). */
import { type ReactNode, useEffect, useId, useState } from "react";
import { flushSync } from "react-dom";
import { NARROW_ABOVE, narrowNote, narrowOptions } from "../logic";

interface FieldShell {
  readonly label: string;
  readonly help?: ReactNode;
  readonly error?: string;
  readonly children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

/** A label, a control, a hint and the error for it — wired together for screen readers. */
export function Field({ label, help, error, children }: FieldShell) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy =
    [help ? helpId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children({ id, ...(describedBy ? { describedBy } : {}), invalid: Boolean(error) })}
      {help && (
        <div className="field-help" id={helpId}>
          {help}
        </div>
      )}
      {error && (
        <div className="field-error" id={errorId} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export function TextField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly help?: ReactNode;
  readonly error?: string;
  readonly placeholder?: string;
  readonly multiline?: boolean;
  readonly maxLength?: number;
  readonly autoFocus?: boolean;
  /** A token or password: hidden while typed, and never offered to a password manager. */
  readonly secret?: boolean;
}) {
  return (
    <Field label={props.label} help={props.help} error={props.error}>
      {({ id, describedBy, invalid }) =>
        props.multiline ? (
          <textarea
            id={id}
            className="textarea"
            value={props.value}
            maxLength={props.maxLength}
            placeholder={props.placeholder}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(e) => props.onChange(e.target.value)}
          />
        ) : (
          <input
            id={id}
            className="input"
            value={props.value}
            maxLength={props.maxLength}
            placeholder={props.placeholder}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            {...(props.secret ? { type: "password", autoComplete: "new-password" } : {})}
            // biome-ignore lint/a11y/noAutofocus: dialogs focus their first field on purpose
            autoFocus={props.autoFocus}
            onChange={(e) => props.onChange(e.target.value)}
          />
        )
      }
    </Field>
  );
}

/** A number box that keeps what people type until it is a number, then reports it. */
export function NumberField(props: {
  readonly label: string;
  readonly value: number | undefined;
  readonly onChange: (v: number | undefined) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly help?: ReactNode;
  readonly error?: string;
}) {
  const [text, setText] = useState(props.value === undefined ? "" : String(props.value));
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the value only, not the text being typed
  useEffect(() => {
    if (props.value === undefined || Number(text) !== props.value)
      setText(props.value === undefined ? "" : String(props.value));
  }, [props.value]);
  const commit = (raw: string) => {
    setText(raw);
    if (raw.trim() === "") return props.onChange(undefined);
    const n = Number(raw.replace(",", "."));
    if (Number.isFinite(n)) props.onChange(n);
  };
  return (
    <Field label={props.label} help={props.help} error={props.error}>
      {({ id, describedBy, invalid }) => (
        <div className="input-unit">
          <input
            id={id}
            className="input"
            inputMode="decimal"
            value={text}
            min={props.min}
            max={props.max}
            step={props.step}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(e) => commit(e.target.value)}
          />
          {props.unit && <span className="unit">{props.unit}</span>}
        </div>
      )}
    </Field>
  );
}

export interface Option {
  readonly value: string;
  readonly label: string;
  readonly group?: string;
  readonly disabled?: boolean;
}

/** The choices of a pick list, grouped: one pass, so a long list is not walked once per group. */
const grouped = (options: readonly Option[]): Array<[string, Option[]]> => {
  const by = new Map<string, Option[]>();
  for (const o of options) {
    const g = o.group ?? "";
    const list = by.get(g);
    if (list) list.push(o);
    else by.set(g, [o]);
  }
  return [...by];
};

export function SelectField(props: {
  readonly label: string;
  readonly value: string | undefined;
  readonly options: readonly Option[];
  readonly onChange: (v: string) => void;
  readonly placeholder?: string;
  readonly help?: ReactNode;
  readonly error?: string;
}) {
  const [query, setQuery] = useState("");
  const [armed, setArmed] = useState(false);
  // A list too long to scroll gets a search box and shows only the first matches. Until someone reaches
  // for it, only the chosen one is drawn: a sheet with hundreds of these would otherwise be tens of thousands of nodes.
  const long = props.options.length > NARROW_ABOVE;
  const narrowed = long && armed ? narrowOptions(props.options, query, props.value) : undefined;
  const options = narrowed
    ? narrowed.shown
    : long
      ? props.options.filter((o) => o.value === props.value)
      : props.options;
  const note = narrowed ? narrowNote(narrowed, query.trim() !== "") : undefined;
  const groups = grouped(options);
  const render = (o: Option) => (
    <option key={o.value} value={o.value} disabled={o.disabled}>
      {o.label}
    </option>
  );
  const help = note ? (
    <>
      {props.help}
      {props.help ? " " : ""}
      <span aria-live="polite">{note}</span>
    </>
  ) : (
    props.help
  );
  return (
    <Field label={props.label} help={help} error={props.error}>
      {({ id, describedBy, invalid }) => (
        <div className="stack" style={{ gap: 6 }}>
          {long && (
            <input
              className="input"
              type="search"
              aria-label={`${props.label} 찾기`}
              placeholder="이름으로 찾기 (예: 17라인 서버)"
              value={query}
              onFocus={() => setArmed(true)}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <select
            id={id}
            className="select"
            value={props.value ?? ""}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onFocus={() => setArmed(true)}
            // The list must exist before the browser opens it, so this one is drawn at once.
            onMouseDown={() => flushSync(() => setArmed(true))}
            onChange={(e) => props.onChange(e.target.value)}
          >
            <option value="" disabled>
              {props.placeholder ?? "골라 주세요"}
            </option>
            {groups.length <= 1
              ? options.map(render)
              : groups.map(([g, list]) => (
                  <optgroup key={g} label={g}>
                    {list.map(render)}
                  </optgroup>
                ))}
          </select>
        </div>
      )}
    </Field>
  );
}

export function Check(props: {
  readonly label: ReactNode;
  readonly checked: boolean;
  readonly onChange: (v: boolean) => void;
  readonly disabled?: boolean;
  readonly hint?: string;
}) {
  return (
    <label className="check" title={props.hint}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

export function Segmented<T extends string>(props: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (v: T) => void;
  /** The hand is on its way to it: a chance to start a download the choice will need. */
  readonly onWarm?: () => void;
}) {
  return (
    <fieldset className="segmented" onPointerEnter={props.onWarm} onFocus={props.onWarm}>
      <legend className="sr-only">{props.label}</legend>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === props.value}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}
