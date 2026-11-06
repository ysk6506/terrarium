/**
 * The runbook tab of the scenario editor (REQ-082, ADR-0087 item 6): the team's way of handling this situation, as
 * steps with what to do, what to check and which tools to use. It can be written by hand, made as a first draft from
 * the best run so far, or pasted in from the team's own text. An experiment decides whether the agent gets it.
 */
import type { Runbook, RunbookStep } from "@terrarium/core/tools";
import { TOOL_SPECS } from "@terrarium/core/tools";
import { useState } from "react";
import { runbook as rb } from "../../logic";
import { messageOf, useApp } from "../context";
import { Button, Note, type Option, SelectField, TextField } from "../kit";
import { PresetBar } from "../presets";
import type { ScenarioEditor } from "./useScenario";

const { RUNBOOK_WORDS: W } = rb;
const TOOL_OPTIONS: Option[] = TOOL_SPECS.map((t) => ({ value: t.name, label: t.title }));
const titleOf = (name: string) => TOOL_SPECS.find((t) => t.name === name)?.title ?? name;

function ToolChips({
  step,
  onAdd,
  onRemove,
}: {
  readonly step: RunbookStep;
  readonly onAdd: (tool: string) => void;
  readonly onRemove: (tool: string) => void;
}) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <SelectField
        label={W.TOOLS}
        value={undefined}
        placeholder={W.ADD_TOOL}
        options={TOOL_OPTIONS.filter((o) => !step.tools.includes(o.value))}
        onChange={onAdd}
      />
      {step.tools.length > 0 ? (
        <ul className="row list-plain" style={{ gap: 6, flexWrap: "wrap" }} aria-label={W.TOOLS}>
          {step.tools.map((t) => (
            <li key={t} className="tag">
              {titleOf(t)}
              <button
                type="button"
                className="chip-x"
                aria-label={`${titleOf(t)} 빼기`}
                onClick={() => onRemove(t)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tiny muted">{W.NO_TOOL}</p>
      )}
    </div>
  );
}

function StepCard({
  step,
  n,
  last,
  edit,
}: {
  readonly step: RunbookStep;
  readonly n: number;
  readonly last: boolean;
  readonly edit: (next: (r: Runbook) => Runbook) => void;
}) {
  return (
    <li className="builder-block stack runbook-step" data-testid="runbook-step">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>{n}단계</b>
        <span className="row" style={{ gap: 4 }}>
          <Button
            size="small"
            kind="quiet"
            aria-label={`${n}단계 ${W.UP}`}
            disabled={n === 1}
            onClick={() => edit((r) => rb.moveStep(r, step.id, -1))}
          >
            {W.UP}
          </Button>
          <Button
            size="small"
            kind="quiet"
            aria-label={`${n}단계 ${W.DOWN}`}
            disabled={last}
            onClick={() => edit((r) => rb.moveStep(r, step.id, 1))}
          >
            {W.DOWN}
          </Button>
          <Button
            size="small"
            kind="quiet"
            aria-label={`${n}단계 지우기`}
            onClick={() => edit((r) => rb.removeStep(r, step.id))}
          >
            {W.REMOVE}
          </Button>
        </span>
      </div>
      <TextField
        label={W.TODO}
        value={step.todo}
        maxLength={2000}
        onChange={(todo) => edit((r) => rb.changeStep(r, step.id, { todo }))}
      />
      <TextField
        label={W.CHECK}
        value={step.check}
        maxLength={2000}
        onChange={(check) => edit((r) => rb.changeStep(r, step.id, { check }))}
      />
      <ToolChips
        step={step}
        onAdd={(tool) => edit((r) => rb.addTool(r, step.id, tool))}
        onRemove={(tool) => edit((r) => rb.removeTool(r, step.id, tool))}
      />
    </li>
  );
}

function Drafting({
  e,
  edit,
}: {
  readonly e: ScenarioEditor;
  readonly edit: (r: Runbook) => void;
}) {
  const { api } = useApp();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const run = async () => {
    setBusy(true);
    setNote(undefined);
    try {
      const view = await api.call("runbookDraft", { params: { id: e.record.id } });
      if (!view.runbook || !view.from) setNote(W.DRAFT_NONE);
      else {
        edit(view.runbook);
        setNote(W.drafted(view.from.experimentName, view.from.score));
      }
    } catch (err) {
      setNote(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <Button busy={busy} onClick={() => void run()}>
        {W.DRAFT}
      </Button>
      {note && <p className="small muted">{note}</p>}
    </div>
  );
}

function Paste({ edit }: { readonly edit: (r: Runbook) => void }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<string>();
  return (
    <details className="fold">
      <summary>{W.PASTE}</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <TextField label={W.PASTE} value={text} multiline help={W.PASTE_HELP} onChange={setText} />
        <Button
          disabled={text.trim() === ""}
          why={W.PASTE_HELP}
          onClick={() => {
            const { runbook, parsed } = rb.pasted(text);
            edit(runbook);
            setNote(parsed ? undefined : W.PASTE_ONE);
          }}
        >
          {W.PASTE_GO}
        </Button>
        {note && <Note tone="warn">{note}</Note>}
      </div>
    </details>
  );
}

export function RunbookTab({ e }: { readonly e: ScenarioEditor }) {
  const book = e.doc.runbook;
  const set = (next: Runbook) => e.change((d) => ({ ...d, runbook: next }));
  const edit = (f: (r: Runbook) => Runbook) => set(f(book ?? rb.EMPTY_RUNBOOK));
  const problems = book ? rb.problemsOf(book) : [];
  return (
    <div className="page-narrow stack runbook-tab" style={{ gap: 16 }} data-testid="runbook-tab">
      <div>
        <h2 style={{ fontSize: 20 }}>{W.TAB}</h2>
        <p className="small muted">{W.LEDE}</p>
      </div>
      <Drafting e={e} edit={set} />
      <Paste edit={set} />
      <PresetBar<"runbook">
        kind="runbook"
        current={book ?? rb.EMPTY_RUNBOOK}
        onLoad={(loaded) => set(loaded as Runbook)}
      />
      {!book && <Note>{W.NONE}</Note>}
      {book && (
        <>
          <TextField
            label={W.TITLE}
            value={book.title}
            maxLength={200}
            onChange={(title) => edit((r) => ({ ...r, title }))}
          />
          {problems.length > 0 && (
            <ul className="issues" aria-label="고칠 곳">
              {problems.map((p) => (
                <li key={p} className="issue issue-static">
                  <span className="issue-mark" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
          <ol className="list-plain stack" style={{ gap: 12 }} aria-label="단계">
            {book.steps.map((step, i) => (
              <StepCard
                key={step.id}
                step={step}
                n={i + 1}
                last={i === book.steps.length - 1}
                edit={edit}
              />
            ))}
          </ol>
        </>
      )}
      <div className="row">
        <Button
          icon="plus"
          disabled={(book?.steps.length ?? 0) >= 30}
          why={W.full(30)}
          onClick={() => edit((r) => rb.addStep(r))}
        >
          {W.ADD_STEP}
        </Button>
        {book && (
          <Button
            kind="quiet"
            onClick={() =>
              e.change((d) => {
                const { runbook: _gone, ...rest } = d;
                return rest;
              })
            }
          >
            {W.CLEAR}
          </Button>
        )}
      </div>
    </div>
  );
}
