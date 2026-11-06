/**
 * The scenarios of a world, to choose one (REQ-080, ADR-0087 item 5). When faults are limited to the given tools, a
 * scenario those tools cannot solve is greyed out and says why ("`restart_cooling_unit`이 없어서 풀 수 없어요"); when
 * they are not, it can still be chosen, with a line that it measures asking for help.
 */
import { toolPicker } from "../../logic";

/** A sentence with `tool_names` in backticks, the names set as code. */
function WithCode({ text }: { readonly text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith("`") ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one sentence never reorder
          <code key={i}>{part.slice(1, -1)}</code>
        ) : (
          part
        ),
      )}
    </>
  );
}

interface Props {
  readonly choices: readonly toolPicker.ScenarioChoice[];
  readonly value: string | undefined;
  readonly onChange: (id: string) => void;
  /** Said under the list when the world has no scenario yet. */
  readonly empty?: string;
}

export function ScenarioPick({ choices, value, onChange, empty }: Props) {
  if (choices.length === 0 && empty) return <p className="small muted">{empty}</p>;
  return (
    <fieldset className="scenario-pick stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }}>
      <legend className="field-label">시나리오</legend>
      {choices.map((c) => (
        <label
          key={c.id}
          className={`scenario-pick-row${c.out ? " scenario-pick-out" : ""}${c.id === value ? " scenario-pick-on" : ""}`}
          aria-disabled={c.out || undefined}
        >
          <input
            type="radio"
            name="scenario"
            value={c.id}
            checked={c.id === value}
            disabled={c.out}
            onChange={() => onChange(c.id)}
          />
          <span>
            <span className="scenario-pick-name">
              {c.name} <span className="tiny muted">채점 {c.items}항목</span>
            </span>
            {c.reason && (
              <span className="tiny scenario-pick-why">
                <WithCode text={c.reason} />
                {!c.out && ` — ${toolPicker.OUT_BUT_ALLOWED}`}
              </span>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
