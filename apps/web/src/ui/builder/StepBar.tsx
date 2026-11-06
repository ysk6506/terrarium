/**
 * The bar at the foot of the stage (ADR-0107 item 8): where you are in building (부지 › 건물 › 서버룸 › 랙) and the sums of
 * that step only, with the one button that moves on. Everything else the old panel said lives on the cards.
 */
import type { Entity } from "@terrarium/core/world";
import { builder, won } from "../../logic";
import { Go } from "../context";
import { Button } from "../kit";
import { KeysHint } from "./KeysHint";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";

const STEPS = ["부지", "건물", "서버룸", "랙"] as const;

/** The rack the picks stand in: the rack itself, or the one holding the picked device. */
export function rackOfPick(b: Builder): Entity | undefined {
  const { selected, index } = b.state;
  const one = selected.length === 1 ? index.find(selected[0] as string) : undefined;
  if (one?.kind === "rack") return one;
  const parent = one?.parentId ? index.find(one.parentId) : undefined;
  return parent?.kind === "rack" ? parent : undefined;
}

/** How deep the building has got: 0 the land, 1 a building's floor, 2 a server room, 3 a rack. */
function depth(b: Builder, rack: Entity | undefined): number {
  const { level } = b.state;
  if (rack) return 3;
  if (level.kind === "room") return 2;
  return level.kind === "floor" ? 1 : 0;
}

export function StepBar({ b }: { readonly b: Builder }) {
  const { index, level, world } = b.state;
  const rack = rackOfPick(b);
  const at = depth(b, rack);
  const crumbs = builder.crumbs(index, level);
  const sum = builder.stepSum(index, catalog, level, rack);
  const reach = (i: number) =>
    i === 0 ? crumbs[0]?.level : i === 1 || i === 2 ? crumbs[i]?.level : undefined;
  return (
    <nav className="stage-steps" aria-label="짓는 단계">
      <ol className="steps">
        {STEPS.map((label, i) => {
          const go = reach(i);
          const state = i < at ? "done" : i === at ? "on" : "";
          return (
            <li
              key={label}
              className={`step-chip ${state}`}
              aria-current={i === at ? "step" : undefined}
            >
              {go && i !== at ? (
                <button type="button" className="step-go" onClick={() => b.go(go)}>
                  {label}
                </button>
              ) : (
                label
              )}
              {i < STEPS.length - 1 && <span className="step-sep">›</span>}
            </li>
          );
        })}
      </ol>
      <span className="step-spacer" />
      <span className="step-sum">
        {sum.label}{" "}
        <b>
          {sum.servers}대 · {won(sum.costM)}
        </b>{" "}
        · 서비스 {sum.services}개
      </span>
      {at === 3 && (
        <Button size="small" onClick={() => b.setSelected([])}>
          서버룸으로
        </Button>
      )}
      <KeysHint />
      <Go to={{ name: "scenarios", worldId: world.id }} className="btn btn-primary btn-small">
        다 지었어요
      </Go>
    </nav>
  );
}
