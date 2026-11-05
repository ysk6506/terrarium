/** The builder's top bar: the world's name, where we are, undo, "돌려 보기", and how the world stands (saved on its own). */
import { useEffect, useState } from "react";
import { builder } from "../../logic";
import { Go, useNow } from "../context";
import { Segmented } from "../fields";
import { Icon } from "../icons";
import { Button } from "../kit";
import type { Builder } from "./useBuilder";

function WorldName({ b }: { readonly b: Builder }) {
  const { world, mine } = b.state;
  const [name, setName] = useState(world.name);
  useEffect(() => setName(world.name), [world.name]);
  if (!mine) return <b>{world.name}</b>;
  return (
    <input
      className="title-input"
      aria-label="세계 이름"
      value={name}
      maxLength={80}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => void b.renameWorld(name.trim()).then(() => setName(world.name))}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function Crumbs({ b }: { readonly b: Builder }) {
  const { index, level } = b.state;
  const crumbs = builder.crumbs(index, level);
  return (
    <nav className="crumbs" aria-label="보고 있는 곳">
      {crumbs.map((c, i) =>
        i === crumbs.length - 1 ? (
          <span key={c.label} aria-current="location">
            {c.label}
          </span>
        ) : (
          <span key={c.label}>
            <button type="button" className="link-button" onClick={() => b.go(c.level)}>
              {c.label}
            </button>{" "}
            ›
          </span>
        ),
      )}
    </nav>
  );
}

/** How the world stands, in a word; a world made by someone else is saved as a copy by hand. */
function SaveState({ b }: { readonly b: Builder }) {
  const { world, mine, dirty, saving, issues } = b.state;
  const now = useNow();
  const errors = issues.filter((i) => i.severity === "error").length;
  const text = builder.saveStatus({ mine, dirty, saving, errors }, world.updatedAt, now);
  return (
    <>
      <output className="save-state" data-testid="save-state">
        {text}
      </output>
      {!mine && (
        <Button
          busy={saving}
          onClick={() => void b.saveCopy()}
          title="이 세계는 다른 사람이 만들었어요. 고친 것은 내 사본이 돼요"
        >
          내 사본으로 저장
        </Button>
      )}
    </>
  );
}

/** The map mode's bar: one way back and the one thing to do, "돌려 보기". */
function MapBar({ b, onLeave }: { readonly b: Builder; readonly onLeave: () => void }) {
  const { world, preview, previewing } = b.state;
  return (
    <div className="toolbar">
      <Button kind="quiet" icon="back" onClick={onLeave}>
        돌아가기
      </Button>
      <div className="toolbar-title">
        <h1 className="sr-only">{world.name}</h1>
        <b>{world.name}</b>
        <div className="row tiny muted" style={{ gap: 10 }}>
          <Crumbs b={b} />
        </div>
      </div>
      <Button
        kind={preview ? "plain" : "primary"}
        icon="play"
        busy={previewing}
        onClick={b.runPreview}
        title="에이전트 없이 10분 돌려서 어디가 더운지 봐요"
      >
        {preview ? "다시 돌려 보기" : "돌려 보기"}
      </Button>
    </div>
  );
}

/** The two eyes on one world: the 3D picture, or the topology of what leans on what (REQ-078). */
function ViewToggle(props: {
  readonly topology: boolean;
  readonly onChange: (on: boolean) => void;
  readonly warm: () => void;
}) {
  return (
    <Segmented
      label="보는 방법"
      value={props.topology ? "topology" : "3d"}
      options={[
        { value: "3d", label: "3D" },
        { value: "topology", label: "토폴로지" },
      ]}
      onChange={(v) => props.onChange(v === "topology")}
      onWarm={props.warm}
    />
  );
}

export function BuilderBar({
  b,
  map,
  onLeaveMap,
  topology,
  onTopology,
  warm,
}: {
  readonly b: Builder;
  readonly map: boolean;
  readonly onLeaveMap: () => void;
  readonly topology: boolean;
  readonly onTopology: (on: boolean) => void;
  readonly warm: () => void;
}) {
  if (map) return <MapBar b={b} onLeave={onLeaveMap} />;
  const { world, preview, previewing, canUndo, canRedo, mine } = b.state;
  return (
    <div className="toolbar">
      <Go to={{ name: "worlds" }} className="btn btn-quiet btn-small" aria-label="세계 목록으로">
        <Icon name="back" size={18} />
      </Go>
      <div className="toolbar-title">
        <h1 className="sr-only">{world.name}</h1>
        <WorldName b={b} />
        <div className="row tiny muted" style={{ gap: 10 }}>
          <Crumbs b={b} />
          {!mine && <span>{world.owner}의 세계예요. 보고 고쳐 볼 수 있어요</span>}
        </div>
      </div>
      <ViewToggle topology={topology} onChange={onTopology} warm={warm} />
      <Button
        kind="quiet"
        icon="undo"
        aria-label="되돌리기 (Ctrl+Z)"
        title="되돌리기 (Ctrl+Z)"
        disabled={!canUndo}
        why="되돌릴 게 아직 없어요"
        onClick={b.undo}
      />
      <Button
        kind="quiet"
        icon="redo"
        aria-label="다시 하기 (Ctrl+Shift+Z)"
        title="다시 하기 (Ctrl+Shift+Z)"
        disabled={!canRedo}
        why="다시 할 게 아직 없어요"
        onClick={b.redo}
      />
      <Button
        icon="play"
        busy={previewing}
        aria-pressed={Boolean(preview)}
        onClick={b.runPreview}
        title="에이전트 없이 10분 돌려서 어디가 더운지 봐요"
      >
        {preview ? "돌려 본 결과 끄기" : "돌려 보기"}
      </Button>
      <Go to={{ name: "scenarios", worldId: world.id }} className="btn btn-quiet">
        이 세계의 시나리오
      </Go>
      <SaveState b={b} />
    </div>
  );
}
