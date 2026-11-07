/**
 * Pieces the builder's cards share (REQ-077, ADR-0083, ADR-0123): the editable name, the main button the state of a pick
 * chooses (fill, widen, run, go in), and "고칠 곳 n건", the problems of the world, each a way to where it is.
 */
import type { Entity } from "@terrarium/core/world";
import { useEffect, useState } from "react";
import { builder, nextStep } from "../../logic";
import { Button } from "../kit";
import { FillChoices, fillWith, useFillChoice } from "./FillPanel";
import { follow } from "./NextChip";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";
import { widenRoom } from "./widen";

export function NameBox({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const [name, setName] = useState(entity.name);
  useEffect(() => setName(entity.name), [entity.name]);
  const commit = () => name !== entity.name && b.apply((bp) => builder.rename(bp, entity.id, name));
  return (
    <input
      className="input ocard-name"
      aria-label="이름"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** Do what the main button says. */
function act(
  b: Builder,
  primary: builder.PickPrimary,
  card: builder.PickCard,
  fill: ReturnType<typeof useFillChoice>["choice"],
): void {
  const { index } = b.state;
  const target = card.entityId;
  if (primary.id === "fill" && target) fillWith(b, target, fill);
  else if (primary.id === "widen") widenRoom(b);
  else if (primary.id === "run") b.runPreview();
  else if (primary.id === "enter" && target) b.go(builder.levelOf(index, target));
  else if (primary.id === "build") b.setTool({ kind: "building", purpose: "data_center" });
  else if (primary.id === "make-room") b.setTool({ kind: "room", purpose: "data_hall" });
  else if (primary.id === "next") follow(b, nextStep(index, b.state.ran).aim, () => undefined);
}

/** The one main button of a picked thing, with how to fill under it when that is the button. */
export function PrimaryAction({ b, entity }: { readonly b: Builder; readonly entity: Entity }) {
  const { blueprint, index, level, ran } = b.state;
  const card = builder.describePick(blueprint, index, catalog, level, entity, ran);
  const { choice, setChoice } = useFillChoice();
  const primary = card.primary;
  if (!primary) return null;
  return (
    <>
      <Button
        kind="primary"
        size="small"
        icon={primary.id === "run" ? "play" : primary.id === "fill" ? "wand" : undefined}
        disabled={primary.why !== undefined}
        {...(primary.why ? { why: primary.why } : {})}
        onClick={() => act(b, primary, card, choice)}
      >
        {primary.label}
      </Button>
      {primary.id === "fill" && !primary.why && (
        <details className="fold" style={{ flexBasis: "100%" }}>
          <summary>채우는 방법</summary>
          <div style={{ marginTop: 8 }}>
            <FillChoices choice={choice} onChange={setChoice} />
          </div>
        </details>
      )}
    </>
  );
}

/** "고칠 곳 2건 ▸": the problems of the world, each a way to where it is. Sits in the bar at the foot. */
export function IssuesLine({ b }: { readonly b: Builder }) {
  const { issues, index } = b.state;
  if (issues.length === 0) return null;
  const errors = issues.filter((i) => i.severity === "error");
  const shown = [...errors, ...issues.filter((i) => i.severity === "warning")].slice(0, 30);
  return (
    <details className="issues-line issues-up">
      <summary>고칠 곳 {issues.length}건</summary>
      <ul className="issues">
        {shown.map((i, n) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: issues have no ids of their own
          <li key={n}>
            <button
              type="button"
              className={`issue${i.severity === "error" ? " issue-error" : ""}`}
              onClick={() => {
                if (!i.entityId || !index.find(i.entityId)) return;
                b.go(builder.levelOf(index, i.entityId));
                setTimeout(() => b.setSelected([i.entityId as string]), 0);
              }}
            >
              <span className="issue-mark" />
              <span>
                {i.message}
                <br />
                <span className="muted">{i.fix}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
