/**
 * Choosing the tools of an experiment (REQ-080, ADR-0087 item 1): the tools this scenario needs and a button that
 * turns on just those, a search, a card for each area that folds out to its tools, and a small tag on every tool for
 * how common it is in a real operations team. Tool sets can be saved under a name.
 *
 * The same picker is used when a person hands tools to a waiting agent (`given` are the ones it already has).
 */
import type { ScenarioDoc } from "@terrarium/core/scenario";
import { useState } from "react";
import { TOOL_WORDS, toolPicker } from "../../logic";
import { Button, Check, Note } from "../kit";
import { PresetBar } from "../presets";

interface Props {
  readonly selected: readonly string[];
  readonly onChange: (tools: string[]) => void;
  /** The scenario whose faults decide "the tools it needs". */
  readonly scenario?: ScenarioDoc;
  /** Tools the agent already has: shown on and fixed (handing over more tools). */
  readonly given?: readonly string[];
  /** Saved sets are for making an experiment, not for handing over tools. */
  readonly noPresets?: boolean;
}

function NeedLine({
  scenario,
  selected,
  onChange,
}: Pick<Props, "scenario" | "selected" | "onChange">) {
  const need = toolPicker.needOf(scenario, selected);
  if (!need)
    return (
      <p className="small muted" data-testid="tool-need">
        {TOOL_WORDS.NEED_NONE}
      </p>
    );
  return (
    <div className="builder-block stack tool-need" data-testid="tool-need">
      <b>{TOOL_WORDS.need(need.tools.length)}</b>
      <ul className="tool-need-list" aria-label={TOOL_WORDS.need(need.tools.length)}>
        {need.tools.map((t) => (
          <li key={t} className={need.missing.includes(t) ? "tag tag-off" : "tag"}>
            {toolPicker.titleOf(t)}
          </li>
        ))}
      </ul>
      <p className="tiny muted">
        {need.missing.length > 0 ? TOOL_WORDS.missing(need.missing.length) : TOOL_WORDS.NEED_ALL}
      </p>
      <Button
        kind="primary"
        size="small"
        disabled={need.exact}
        why={TOOL_WORDS.NEED_SAME}
        onClick={() => onChange(toolPicker.onlyNeeded(scenario as ScenarioDoc))}
      >
        {TOOL_WORDS.NEED_BUTTON}
      </Button>
    </div>
  );
}

function ToolLine({
  row,
  onToggle,
}: {
  readonly row: toolPicker.ToolRow;
  readonly onToggle: (on: boolean) => void;
}) {
  return (
    <li className="tool-row">
      <Check
        label={
          <>
            {row.title}
            <span className={`tag tag-real tag-real-${row.realism}`}>{row.realismLabel}</span>
          </>
        }
        checked={row.on}
        disabled={row.locked}
        onChange={onToggle}
      />
      {row.note && <p className="tiny tool-note">{row.note}</p>}
    </li>
  );
}

function AreaCard({
  card,
  open,
  onSet,
}: {
  readonly card: toolPicker.AreaCard;
  readonly open: boolean;
  readonly onSet: (names: readonly string[], on: boolean) => void;
}) {
  const names = card.tools.filter((t) => !t.locked).map((t) => t.name);
  const allOn = card.tools.every((t) => t.on);
  return (
    <details className="fold tool-area" open={open || undefined} data-testid={`area-${card.area}`}>
      <summary>
        <span className="tool-area-name">{card.label}</span>
        <span className="tiny muted">{TOOL_WORDS.areaCount(card.onCount, card.total)}</span>
      </summary>
      <div className="stack" style={{ marginTop: 8, gap: 6 }}>
        {names.length > 0 && (
          <Button size="small" kind="quiet" onClick={() => onSet(names, !allOn)}>
            {allOn ? TOOL_WORDS.AREA_OFF : TOOL_WORDS.AREA_ON}
          </Button>
        )}
        <ul className="list-plain tool-rows">
          {card.tools.map((row) => (
            <ToolLine key={row.name} row={row} onToggle={(on) => onSet([row.name], on)} />
          ))}
        </ul>
      </div>
    </details>
  );
}

export function ToolPicker({ selected, onChange, scenario, given = [], noPresets }: Props) {
  const [query, setQuery] = useState("");
  const granting = given.length > 0;
  const cards = toolPicker.areaCards(selected, query, given);
  const set = (names: readonly string[], on: boolean) =>
    onChange(toolPicker.setTools(selected, names, on));
  return (
    <div className="stack tool-picker" style={{ gap: 12 }} data-testid="tool-picker">
      <div>
        <b>{granting ? TOOL_WORDS.GRANT_TITLE : TOOL_WORDS.TITLE}</b>
        <p className="small muted">{granting ? TOOL_WORDS.GRANT_LEDE : TOOL_WORDS.LEDE}</p>
      </div>
      {!granting && <NeedLine scenario={scenario} selected={selected} onChange={onChange} />}
      <label className="field-inline">
        <span className="small">{TOOL_WORDS.SEARCH}</span>
        <input
          className="input"
          type="search"
          value={query}
          placeholder={TOOL_WORDS.SEARCH_HELP}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {!granting && !noPresets && (
        <PresetBar<string[]>
          kind="tools"
          current={[...selected]}
          onLoad={(tools) => onChange(toolPicker.setTools([], tools, true))}
        />
      )}
      <p className="tiny muted">{TOOL_WORDS.REALISM_HELP}</p>
      {cards.length === 0 && <Note>{TOOL_WORDS.NO_MATCH}</Note>}
      <div className="stack tool-areas" style={{ gap: 8 }}>
        {cards.map((card) => (
          <AreaCard key={card.area} card={card} open={query.trim() !== ""} onSet={set} />
        ))}
      </div>
      {!granting && <p className="tiny muted">{TOOL_WORDS.LOCKED}</p>}
    </div>
  );
}
