/** The builder's top bar: the world's name, where we are, undo, "가동해 보기", save. */
import { useEffect, useState } from "react";
import { builder } from "../../logic";
import { Go } from "../context";
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

function SaveButton({ b }: { readonly b: Builder }) {
  const { mine, dirty, saving, issues } = b.state;
  const errors = issues.filter((i) => i.severity === "error").length;
  if (!mine)
    return (
      <Button
        kind="primary"
        busy={saving}
        onClick={() => void b.saveCopy()}
        title="이 세계는 다른 사람이 만들었다. 고친 것은 내 사본이 된다"
      >
        내 사본으로 저장
      </Button>
    );
  return (
    <Button
      kind="primary"
      busy={saving}
      disabled={!dirty}
      onClick={() => void b.save()}
      title={errors > 0 ? `고칠 곳 ${errors}건을 고쳐야 저장된다` : "Ctrl+S"}
    >
      {dirty ? "저장" : "저장됨"}
    </Button>
  );
}

export function BuilderBar({ b }: { readonly b: Builder }) {
  const { world, preview, previewing, canUndo, canRedo, mine } = b.state;
  return (
    <div className="toolbar">
      <Go to={{ name: "worlds" }} className="btn btn-quiet btn-small" aria-label="세계 목록으로">
        <Icon name="back" size={18} />
      </Go>
      <div className="toolbar-title">
        <WorldName b={b} />
        <div className="row tiny muted" style={{ gap: 10 }}>
          <Crumbs b={b} />
          {!mine && <span>{world.owner}의 세계, 보고 고쳐 볼 수 있다</span>}
        </div>
      </div>
      <Button
        kind="quiet"
        icon="undo"
        aria-label="되돌리기 (Ctrl+Z)"
        title="되돌리기 (Ctrl+Z)"
        disabled={!canUndo}
        onClick={b.undo}
      />
      <Button
        kind="quiet"
        icon="redo"
        aria-label="다시 하기 (Ctrl+Shift+Z)"
        title="다시 하기 (Ctrl+Shift+Z)"
        disabled={!canRedo}
        onClick={b.redo}
      />
      <Button
        icon="play"
        busy={previewing}
        aria-pressed={Boolean(preview)}
        onClick={b.runPreview}
        title="에이전트 없이 10분 가동해서 어디가 더운지 본다"
      >
        {preview ? "가동 결과 끄기" : "가동해 보기"}
      </Button>
      <Go to={{ name: "scenarios", worldId: world.id }} className="btn">
        이 세계의 시나리오
      </Go>
      <SaveButton b={b} />
    </div>
  );
}
