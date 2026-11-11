/**
 * The bar at the foot of the stage, the single status line (ADR-0107 item 8, ADR-0123): where you are in building
 * (부지 › 건물 › 서버룸 › 랙), the sums of that step (money is here and nowhere else), what needs fixing, "?", and the
 * one button that moves on.
 */
import type { Entity } from "@terrarium/core/world";
import { builder } from "../../logic";
import { Go } from "../context";
import { Button } from "../kit";
import { IssuesLine } from "./CardParts";
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

export function StepBar({ b, topology }: { readonly b: Builder; readonly topology: boolean }) {
  const { index, level, world } = b.state;
  const rack = rackOfPick(b);
  const at = depth(b, rack);
  const crumbs = builder.crumbs(index, level);
  const site = level.kind === "site" ? builder.siteUse(b.state.blueprint, catalog) : undefined;
  const sum = builder.barSum(index, catalog, level, rack, site);
  const reach = (i: number) =>
    i === 0 ? crumbs[0]?.level : i === 1 || i === 2 ? crumbs[i]?.level : undefined;
  return (
    <nav className="stage-steps" data-bottom-bar aria-label="짓는 단계">
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
        {sum.map((part, i) => (
          <span key={part.label ?? "money"}>
            {i > 0 && " · "}
            {part.label && `${part.label} `}
            <b style={part.bad ? { color: "var(--bad)" } : undefined}>{part.value}</b>
            {part.note && <small className="step-note"> {part.note}</small>}
          </span>
        ))}
      </span>
      <IssuesLine b={b} />
      {at === 3 && (
        <Button size="small" onClick={() => b.setSelected([])}>
          서버룸으로
        </Button>
      )}
      {/* R·Delete·두 번 누르기는 3D 편집 키라 토폴로지에서는 뜻이 없어요 (ADR-0146) */}
      {!topology && <KeysHint picked={b.state.selected.length > 0} />}
      <Go to={{ name: "scenarios", worldId: world.id }} className="btn btn-small">
        다 지었어요
      </Go>
    </nav>
  );
}
