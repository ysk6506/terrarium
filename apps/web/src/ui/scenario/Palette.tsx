/**
 * The block palette (REQ-034, REQ-071): three questions, not a list of every block. 어디가 고장 나나요 / 에이전트가 뭘
 * 하면 되나요 / 어떻게 채점하나요. Pressing a question opens its blocks only: the few used most often, then "더 보기".
 * A block pressed goes right after the selected block (at the end when none is selected), or can be dragged onto the
 * canvas. Blocks that cannot be used — not supported yet, or nothing in this world to act on — stay visible with the
 * reason. The third question's blocks are scoring lines: pressing one puts a sentence on the sheet and opens it.
 */
import { type PaletteItem, paletteFor } from "@terrarium/core/scenario";
import { useId, useMemo, useState } from "react";
import { scenario } from "../../logic";
import type { ScenarioEditor } from "./useScenario";

export const DRAG_TYPE = "application/x-terrarium-block";

function BlockButton({ item, e }: { readonly item: PaletteItem; readonly e: ScenarioEditor }) {
  const reasonId = useId();
  return (
    <button
      type="button"
      className="palette-item"
      title={item.available ? item.description : undefined}
      draggable={item.available}
      aria-disabled={!item.available}
      aria-describedby={item.available ? undefined : reasonId}
      onDragStart={(ev) => {
        ev.dataTransfer.setData(DRAG_TYPE, item.key);
        ev.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => e.insert(item)}
    >
      <span>{item.label}</span>
      <small id={reasonId} className={item.available ? "sr-only" : undefined}>
        {item.available ? item.description : item.reason}
      </small>
    </button>
  );
}

function ScoreButton({
  entry,
  e,
  openSheet,
}: {
  readonly entry: Extract<scenario.Entry, { kind: "score" }>;
  readonly e: ScenarioEditor;
  readonly openSheet: () => void;
}) {
  return (
    <button
      type="button"
      className="palette-item palette-score"
      title={entry.description}
      onClick={() => {
        if (e.addScore(entry.score)) openSheet();
      }}
    >
      <span>{entry.label}</span>
      <small className="sr-only">{entry.description}</small>
    </button>
  );
}

function EntryButton(props: {
  readonly entry: scenario.Entry;
  readonly e: ScenarioEditor;
  readonly openSheet: () => void;
}) {
  const { entry, e, openSheet } = props;
  return entry.kind === "block" ? (
    <BlockButton item={entry.item} e={e} />
  ) : (
    <ScoreButton entry={entry} e={e} openSheet={openSheet} />
  );
}

/** One group of blocks (a fault domain such as 설비) under a small heading. */
function Entries(props: {
  readonly entries: readonly scenario.Entry[];
  readonly e: ScenarioEditor;
  readonly openSheet: () => void;
  /** Under small headings by fault domain (설비, 서버 …), for the long list behind "더 보기". */
  readonly grouped?: boolean;
}) {
  const groupOf = (x: scenario.Entry) =>
    props.grouped && x.kind === "block" ? (x.item.group ?? "") : "";
  const groups = [...new Set(props.entries.map(groupOf))];
  return (
    <>
      {groups.map((g) => (
        <div key={g || "all"} style={{ marginBottom: 8 }}>
          {g && (
            <div className="tiny muted" style={{ margin: "4px 0 6px", fontWeight: 600 }}>
              {g}
            </div>
          )}
          {props.entries
            .filter((x) => groupOf(x) === g)
            .map((x) => (
              <EntryButton key={x.key} entry={x} e={props.e} openSheet={props.openSheet} />
            ))}
        </div>
      ))}
    </>
  );
}

function QuestionCard(props: {
  readonly q: scenario.Question;
  readonly items: readonly PaletteItem[];
  readonly open: boolean;
  readonly toggle: () => void;
  readonly e: ScenarioEditor;
  readonly openSheet: () => void;
}) {
  const { q, items, open, toggle, e, openSheet } = props;
  const panel = useId();
  const [more, setMore] = useState(false);
  const { common, more: rest } = scenario.entriesOf(q.id, items);
  return (
    <section className="builder-block question" data-open={open}>
      <button
        type="button"
        className="question-head"
        aria-expanded={open}
        aria-controls={panel}
        onClick={toggle}
      >
        <span>{q.title}</span>
        <small>{q.hint}</small>
      </button>
      {open && (
        <div id={panel} className="question-body">
          <Entries entries={common} e={e} openSheet={openSheet} />
          {rest.length > 0 && (
            <button
              type="button"
              className="link-button tiny"
              aria-expanded={more}
              onClick={() => setMore(!more)}
            >
              {more ? "접기" : `더 보기 (${rest.length})`}
            </button>
          )}
          {more && <Entries entries={rest} e={e} openSheet={openSheet} grouped />}
        </div>
      )}
    </section>
  );
}

export function Palette({
  e,
  openSheet,
}: {
  readonly e: ScenarioEditor;
  readonly openSheet: () => void;
}) {
  const items = useMemo(() => paletteFor(e.index), [e.index]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<scenario.QuestionId>(() => scenario.firstOpen(e.doc));
  const found = scenario.searchEntries(items, query);
  const after = e.selected ? e.doc.nodes.find((n) => n.id === e.selected) : undefined;
  return (
    <aside className="builder-side" aria-label="블록">
      <div className="builder-block">
        <input
          className="input"
          type="search"
          placeholder="블록 찾기 (예: 냉방, 온도, 점수)"
          aria-label="블록 찾기"
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
        />
        <p className="tiny muted" style={{ marginTop: 8 }} aria-live="polite">
          {after
            ? `"${scenario.titleOf(after)}" 바로 뒤에 들어가요.`
            : "누르면 맨 끝에 이어져요. 블록을 고르면 그 뒤에 들어가요."}{" "}
          끌어다 놓아도 돼요.
        </p>
      </div>
      {query.trim() ? (
        <div className="builder-block">
          <h2>찾은 블록 {found.length}</h2>
          {found.length === 0 && (
            <p className="small muted">맞는 블록이 없어요. 다른 낱말로 찾아 보세요.</p>
          )}
          <Entries entries={found} e={e} openSheet={openSheet} grouped />
        </div>
      ) : (
        scenario.QUESTIONS.map((q) => (
          <QuestionCard
            key={q.id}
            q={q}
            items={items}
            open={open === q.id}
            toggle={() => setOpen(q.id)}
            e={e}
            openSheet={openSheet}
          />
        ))
      )}
    </aside>
  );
}

export const paletteItem = (e: ScenarioEditor, key: string) =>
  paletteFor(e.index).find((i) => i.key === key);
