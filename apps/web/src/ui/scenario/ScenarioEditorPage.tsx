/**
 * The no-code scenario editor (REQ-033, REQ-034): blocks on a canvas, the scoring sheet, problems shown
 * where they are, and a dry run with no agent. Opened lazily: React Flow loads here.
 */
import type { ScenarioRecord, WorldRecord } from "@terrarium/core/experiments";
import type { ScenarioIssue } from "@terrarium/core/scenario";
import { useEffect, useRef, useState } from "react";
import { scenario } from "../../logic";
import { useApp, useAsync, useLeaveGuard, usePageTitle } from "../context";
import { useMediaQuery } from "../hooks";
import { Button, Failure, Loading, Note } from "../kit";
import { SeriesGrid, Timeline } from "../results";
import { Calibration } from "./Calibration";
import { Canvas } from "./Canvas";
import { NodeInspector } from "./NodeInspector";
import { Palette, paletteItem } from "./Palette";
import { RunbookTab } from "./Runbook";
import { Sheet } from "./Sheet";
import { Bar, type Tab } from "./Toolbar";
import { type ScenarioEditor, useScenario } from "./useScenario";

/** What one press can do about a problem, when the answer is obvious: add the missing block, open the sheet. */
function fixOf(
  e: ScenarioEditor,
  issue: ScenarioIssue,
  openSheet: () => void,
): { readonly label: string; readonly run: () => void } | undefined {
  if (issue.code === "SC005" && issue.message.includes("에이전트 투입"))
    return {
      label: "블록 더하기",
      run: () => {
        const item = paletteItem(e, "agent_task");
        let added: string | undefined;
        if (item)
          e.change((d) => {
            const r = scenario.appendBlock(d, item);
            added = r.nodeId;
            return r.doc;
          });
        if (added) e.select(added);
      },
    };
  if (issue.code === "SC017") return { label: "채점표 열기", run: openSheet };
  return undefined;
}

function IssueList({
  e,
  issues,
  openSheet,
}: {
  readonly e: ScenarioEditor;
  readonly issues: readonly ScenarioIssue[];
  readonly openSheet: () => void;
}) {
  if (issues.length === 0) return <Note tone="good">고칠 곳이 없어요. 실험에 쓸 수 있어요.</Note>;
  return (
    <ul className="issues">
      {issues.slice(0, 40).map((i) => {
        const fix = fixOf(e, i, openSheet);
        return (
          <li
            key={`${i.code}-${i.nodeId ?? i.expectationId ?? ""}-${i.message}`}
            className="issue-row"
          >
            <button
              type="button"
              className={`issue${i.severity === "error" ? " issue-error" : ""}`}
              onClick={() => i.nodeId && e.select(i.nodeId)}
            >
              <span className="issue-mark" />
              <span>{i.message}</span>
            </button>
            {fix && (
              <Button kind="quiet" size="small" onClick={fix.run}>
                {fix.label}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Overview({
  e,
  openSheet,
}: {
  readonly e: ScenarioEditor;
  readonly openSheet: () => void;
}) {
  const errors = e.issues.filter((i) => i.severity === "error").length;
  return (
    <>
      <div className="builder-block stack">
        <h2 style={{ fontSize: 18 }}>{errors > 0 ? `고칠 곳 ${errors}건` : "점검"}</h2>
        <IssueList e={e} issues={e.issues} openSheet={openSheet} />
      </div>
      <Calibration e={e} openSheet={openSheet} />
      <div className="builder-block stack">
        <h3 style={{ marginBottom: 0 }}>미리 돌려 본 결과</h3>
        {!e.dryRun && (
          <p className="small muted">
            에이전트 없이 시나리오만 돌려서 세계에 무슨 일이 일어나는지 봐요. 저장된 내용으로
            돌아요.
          </p>
        )}
        {e.dryRun && (
          <>
            {e.dryRun.agentTaskAt !== undefined && (
              <p className="small">
                에이전트는 시작 {Math.round(e.dryRun.agentTaskAt / 60)}분 뒤에 일을 받아요.
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

const WIDE = `(min-width: ${scenario.EDITOR_MIN_WIDTH}px)`;

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
  const wide = useMediaQuery(WIDE);
  useLeaveGuard(e.dirty ? "저장하지 않고 나가면 고친 것이 사라져요. 그래도 나갈까요?" : undefined);
  useEditorKeys(e);
  return (
    <div className="page-wide">
      <Bar e={e} tab={tab} setTab={setTab} wide={wide} />
      {tab === "flow" && !wide && (
        <div className="editor-narrow">
          <Note>
            시나리오 편집은 넓은 화면에서 해 주세요. 여기서는 채점표와 점검만 볼 수 있어요.
          </Note>
          <Overview e={e} openSheet={() => setTab("sheet")} />
        </div>
      )}
      {tab === "flow" && wide && (
        <div className="editor">
          <Palette e={e} />
          <Canvas e={e} />
          <aside className="builder-side builder-side-right" aria-label="고른 블록">
            {e.selected ? (
              <NodeInspector e={e} nodeId={e.selected} />
            ) : (
              <Overview e={e} openSheet={() => setTab("sheet")} />
            )}
          </aside>
        </div>
      )}
      {tab === "sheet" && <Sheet e={e} />}
      {tab === "runbook" && <RunbookTab e={e} />}
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
