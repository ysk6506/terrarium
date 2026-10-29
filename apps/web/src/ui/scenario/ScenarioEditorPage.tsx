/**
 * The no-code scenario editor (REQ-033, REQ-034): blocks on a canvas, the scoring sheet, problems shown
 * where they are, and a dry run with no agent. Opened lazily: React Flow loads here.
 */
import type { ScenarioRecord, WorldRecord } from "@terrarium/core/experiments";
import { hasErrors, type ScenarioIssue } from "@terrarium/core/scenario";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { Go, useApp, useAsync, useLeaveGuard, usePageTitle } from "../context";
import { Icon } from "../icons";
import { Button, Failure, Loading, Note } from "../kit";
import { SeriesGrid, Timeline } from "../results";
import { Canvas } from "./Canvas";
import { NodeInspector } from "./NodeInspector";
import { Palette } from "./Palette";
import { Sheet } from "./Sheet";
import { type ScenarioEditor, useScenario } from "./useScenario";

type Tab = "flow" | "sheet";

function Name({ e }: { readonly e: ScenarioEditor }) {
  const [name, setName] = useState(e.record.name);
  useEffect(() => setName(e.record.name), [e.record.name]);
  if (!e.mine) return <b>{e.record.name}</b>;
  return (
    <input
      className="title-input"
      aria-label="시나리오 이름"
      value={name}
      maxLength={80}
      onChange={(ev) => setName(ev.target.value)}
      onBlur={() => void e.rename(name.trim())}
      onKeyDown={(ev) => ev.key === "Enter" && (ev.target as HTMLInputElement).blur()}
    />
  );
}

function ModeSwitch({
  e,
  tab,
  setTab,
}: {
  readonly e: ScenarioEditor;
  readonly tab: Tab;
  readonly setTab: (t: Tab) => void;
}) {
  const tabs: ReadonlyArray<readonly [Tab, string]> = [
    ["flow", "흐름"],
    ["sheet", `채점표 (${e.doc.expectations.length})`],
  ];
  // Arrow keys move between the two, as in every tab list; only the chosen one is a tab stop.
  const move = (ev: ReactKeyboardEvent<HTMLDivElement>) => {
    if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
    ev.preventDefault();
    const next = tab === "flow" ? 1 : 0;
    setTab(tabs[next]?.[0] ?? tab);
    (ev.currentTarget.querySelectorAll("button")[next] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className="segmented" role="tablist" aria-label="편집할 것" onKeyDown={move}>
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          tabIndex={tab === id ? 0 : -1}
          onClick={() => setTab(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function UndoRedo({ e }: { readonly e: ScenarioEditor }) {
  return (
    <>
      <Button
        kind="quiet"
        icon="undo"
        aria-label="되돌리기"
        title="되돌리기 (Ctrl+Z)"
        disabled={!e.canUndo}
        onClick={e.undo}
      />
      <Button
        kind="quiet"
        icon="redo"
        aria-label="다시 하기"
        title="다시 하기 (Ctrl+Shift+Z)"
        disabled={!e.canRedo}
        onClick={e.redo}
      />
    </>
  );
}

function SaveButton({ e }: { readonly e: ScenarioEditor }) {
  if (!e.mine)
    return (
      <Button kind="primary" busy={e.saving} onClick={() => void e.saveCopy()}>
        내 사본으로 저장
      </Button>
    );
  return (
    <Button kind="primary" busy={e.saving} disabled={!e.dirty} onClick={() => void e.save()}>
      {e.dirty ? "저장" : "저장됨"}
    </Button>
  );
}

function Bar({
  e,
  tab,
  setTab,
}: {
  readonly e: ScenarioEditor;
  readonly tab: Tab;
  readonly setTab: (t: Tab) => void;
}) {
  const errors = e.issues.filter((i) => i.severity === "error").length;
  return (
    <div className="toolbar">
      <Go
        to={{ name: "scenarios", worldId: e.world.id }}
        className="btn btn-quiet btn-small"
        aria-label="시나리오 목록으로"
      >
        <Icon name="back" size={18} />
      </Go>
      <div className="toolbar-title">
        <h1 className="sr-only">{e.record.name}</h1>
        <Name e={e} />
        <span className="tiny muted">
          세계 <Go to={{ name: "world", id: e.world.id }}>{e.world.name}</Go>
          {!e.mine && `, ${e.record.owner}의 시나리오`}
        </span>
      </div>
      <ModeSwitch e={e} tab={tab} setTab={setTab} />
      <UndoRedo e={e} />
      <Button
        icon="play"
        busy={e.running}
        disabled={!e.mine && e.dirty}
        onClick={() => void e.runDry()}
        title={errors > 0 ? "고칠 곳을 먼저 고친다" : "에이전트 없이 시나리오만 돌려 본다"}
      >
        미리 돌려 보기
      </Button>
      <Go
        to={{ name: "newExperiment", scenarioId: e.record.id }}
        className="btn"
        aria-disabled={hasErrors(e.issues)}
      >
        이 시나리오로 실험
      </Go>
      <SaveButton e={e} />
    </div>
  );
}

function IssueList({
  e,
  issues,
}: {
  readonly e: ScenarioEditor;
  readonly issues: readonly ScenarioIssue[];
}) {
  if (issues.length === 0) return <Note tone="good">고칠 곳이 없다. 실험에 쓸 수 있다.</Note>;
  return (
    <ul className="issues">
      {issues.slice(0, 40).map((i) => (
        <li key={`${i.code}-${i.nodeId ?? i.expectationId ?? ""}-${i.message}`}>
          <button
            type="button"
            className={`issue${i.severity === "error" ? " issue-error" : ""}`}
            onClick={() => i.nodeId && e.select(i.nodeId)}
          >
            <span className="issue-mark" />
            <span>{i.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Overview({ e }: { readonly e: ScenarioEditor }) {
  const errors = e.issues.filter((i) => i.severity === "error").length;
  return (
    <>
      <div className="builder-block stack">
        <h2 style={{ fontSize: 18 }}>{errors > 0 ? `고칠 곳 ${errors}건` : "점검"}</h2>
        <IssueList e={e} issues={e.issues} />
      </div>
      <div className="builder-block stack">
        <h3 style={{ marginBottom: 0 }}>미리 돌려 본 결과</h3>
        {!e.dryRun && (
          <p className="small muted">
            에이전트 없이 시나리오만 돌려서 세계에 무슨 일이 일어나는지 본다. 저장된 내용으로 돈다.
          </p>
        )}
        {e.dryRun && (
          <>
            {e.dryRun.agentTaskAt !== undefined && (
              <p className="small">
                에이전트는 시작 {Math.round(e.dryRun.agentTaskAt / 60)}분 뒤에 일을 받는다.
              </p>
            )}
            <Timeline entries={e.dryRun.timeline} limit={60} />
            <SeriesGrid series={e.dryRun.series} index={e.index} limit={3} />
          </>
        )}
      </div>
    </>
  );
}

function useEditorKeys(editor: ScenarioEditor) {
  const latest = useRef(editor);
  latest.current = editor;
  useEffect(() => {
    const down = (ev: KeyboardEvent) => {
      const e = latest.current;
      const el = ev.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || !(ev.ctrlKey || ev.metaKey))
        return;
      const key = ev.key.toLowerCase();
      if (key === "z") (ev.shiftKey ? e.redo : e.undo)();
      else if (key === "y") e.redo();
      else if (key === "s") void (e.mine ? e.save() : e.saveCopy());
      else return;
      ev.preventDefault();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);
}

function EditorScreen({
  scenario,
  world,
}: {
  readonly scenario: ScenarioRecord;
  readonly world: WorldRecord;
}) {
  const e = useScenario(scenario, world);
  usePageTitle(scenario.name);
  const [tab, setTab] = useState<Tab>("flow");
  useLeaveGuard(e.dirty ? "저장하지 않고 나가면 고친 것이 사라진다. 그래도 나갈까?" : undefined);
  useEditorKeys(e);
  return (
    <div className="page-wide">
      <Bar e={e} tab={tab} setTab={setTab} />
      {tab === "flow" ? (
        <div className="editor">
          <Palette e={e} />
          <Canvas e={e} />
          <aside className="builder-side builder-side-right" aria-label="고른 블록">
            {e.selected ? <NodeInspector e={e} nodeId={e.selected} /> : <Overview e={e} />}
          </aside>
        </div>
      ) : (
        <Sheet e={e} />
      )}
    </div>
  );
}

export default function ScenarioEditorPage({ id }: { readonly id: string }) {
  const { api } = useApp();
  const data = useAsync(
    async (signal) => {
      const scenario = await api.call("getScenario", { params: { id }, signal });
      const world = await api.call("getWorld", { params: { id: scenario.worldId }, signal });
      return { scenario, world };
    },
    [id],
  );
  if (data.error)
    return (
      <div className="page">
        <Failure error={data.error} retry={data.reload} />
      </div>
    );
  if (!data.data || data.data.scenario.id !== id)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  return <EditorScreen key={id} scenario={data.data.scenario} world={data.data.world} />;
}
