/** Form controls: every one has its label tied to it and its error announced (kit.tsx re-exports them). */
import { type ReactNode, useEffect, useId, useState } from "react";

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

export function SelectField(props: {
  readonly label: string;
  readonly value: string | undefined;
  readonly options: readonly Option[];
  readonly onChange: (v: string) => void;
  readonly placeholder?: string;
  readonly help?: ReactNode;
  readonly error?: string;
}) {
  const groups = [...new Set(props.options.map((o) => o.group ?? ""))];
  const render = (o: Option) => (
    <option key={o.value} value={o.value} disabled={o.disabled}>
      {o.label}
    </option>
  );
  return (
    <Field label={props.label} help={props.help} error={props.error}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          className="select"
          value={props.value ?? ""}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(e) => props.onChange(e.target.value)}
        >
          <option value="" disabled>
            {props.placeholder ?? "고른다"}
          </option>
          {groups.length <= 1
            ? props.options.map(render)
            : groups.map((g) => (
                <optgroup key={g} label={g}>
                  {props.options.filter((o) => (o.group ?? "") === g).map(render)}
                </optgroup>
              ))}
        </select>
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
}) {
  return (
    <fieldset className="segmented">
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
