/** The editor's top bar (REQ-034): the name, flow or sheet, undo and redo, a dry run, and the one next step. */

import { hasErrors } from "@terrarium/core/scenario";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useState } from "react";
import { Go } from "../context";
import { Icon } from "../icons";
import { Button } from "../kit";
import type { ScenarioEditor } from "./useScenario";

export type Tab = "flow" | "sheet" | "runbook";

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
    ["runbook", `절차서${e.doc.runbook ? ` (${e.doc.runbook.steps.length})` : ""}`],
  ];
  // Arrow keys move between the tabs, as in every tab list; only the chosen one is a tab stop.
  const move = (ev: ReactKeyboardEvent<HTMLDivElement>) => {
    if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
    ev.preventDefault();
    const at = tabs.findIndex(([id]) => id === tab);
    const next = (at + (ev.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
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
        why="되돌릴 게 아직 없어요"
        onClick={e.undo}
      />
      <Button
        kind="quiet"
        icon="redo"
        aria-label="다시 하기"
        title="다시 하기 (Ctrl+Shift+Z)"
        disabled={!e.canRedo}
        why="다시 할 게 아직 없어요"
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
  // Saved and clean: the primary button is the next step (running an experiment), so this one is only a status.
  return (
    <Button
      kind={e.dirty ? "primary" : "quiet"}
      busy={e.saving}
      disabled={!e.dirty}
      why="고친 곳이 없어서 저장할 게 없어요"
      onClick={() => void e.save()}
    >
      {e.dirty ? "저장" : "저장됨"}
    </Button>
  );
}

/** One primary button: save while there is something to save, running an experiment once it is saved. */
export function Bar({
  e,
  tab,
  setTab,
  wide,
}: {
  readonly e: ScenarioEditor;
  readonly tab: Tab;
  readonly setTab: (t: Tab) => void;
  /** On a narrow screen there is no canvas to undo on. */
  readonly wide: boolean;
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
      {wide && <UndoRedo e={e} />}
      <Button
        kind="quiet"
        icon="play"
        busy={e.running}
        disabled={!e.mine && e.dirty}
        why="다른 사람의 시나리오예요. 내 사본으로 저장한 뒤에 미리 볼 수 있어요"
        onClick={() => void e.runDry()}
        title={errors > 0 ? "고칠 곳을 먼저 고쳐 주세요" : "에이전트 없이 시나리오만 미리 봐요"}
      >
        미리 보기
      </Button>
      <Go
        to={{ name: "newExperiment", scenarioId: e.record.id }}
        className={e.mine && !e.dirty ? "btn btn-primary" : "btn"}
        aria-disabled={hasErrors(e.issues)}
        title={hasErrors(e.issues) ? "고칠 곳을 먼저 고쳐 주세요" : undefined}
      >
        이 시나리오로 실험
      </Go>
      <SaveButton e={e} />
    </div>
  );
}
