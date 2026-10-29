/**
 * Turns pointing and dragging in the 3D view into builder actions: the ghost of what would be placed,
 * the hint line, and what happens on click, double-click and drag. The decisions live in
 * logic.builder (planFor, movePlan); this only keeps track of the pointer.
 */
import { useMemo, useState } from "react";
import { builder } from "../../logic";
import { useApp } from "../context";
import type { Ghost, PlanPoint, StageEvents } from "./Stage";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";

interface Drag {
  readonly kind: "tool" | "move";
  readonly from: PlanPoint;
  readonly to: PlanPoint;
  readonly id?: string;
}

/** Pointer positions are kept to 10 cm, so the screen redraws only when the ghost could move. */
const coarse = (p: PlanPoint): PlanPoint => ({
  x: Math.round(p.x * 10) / 10,
  y: Math.round(p.y * 10) / 10,
});
const samePoint = (a?: PlanPoint, b?: PlanPoint) => a?.x === b?.x && a?.y === b?.y;

const ENTERABLE = new Set(["building", "floor", "room"]);
const POINTING_TOOLS = new Set(["rack", "equipment"]);

export interface Gestures {
  readonly ghost?: Ghost;
  readonly hint: string;
  readonly bad: boolean;
  readonly events: StageEvents;
}

export function useGestures(b: Builder): Gestures {
  const { toast } = useApp();
  const { blueprint, index, level, tool, rotation, selected } = b.state;
  const [pointer, setPointer] = useState<{ at?: PlanPoint; hit?: string }>({});
  const [drag, setDrag] = useState<Drag>();
  const where: builder.Where = { bp: blueprint, index, catalog, level };

  const planOf = (d: Drag | undefined, at: PlanPoint | undefined) => {
    if (d?.kind === "move" && d.id) return builder.movePlan(where, d.id, d.from, d.to);
    if (d) return builder.planFor(where, tool, rotation, d.from, d.to);
    if (at && POINTING_TOOLS.has(tool.kind)) return builder.planFor(where, tool, rotation, at);
    return undefined;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: `where` is rebuilt from these each render
  const plan = useMemo(
    () => planOf(drag, pointer.at),
    [drag, pointer.at, blueprint, level, tool, rotation],
  );

  const commit = (p: builder.Plan | undefined) => {
    if (!p) return;
    if (p.edit) {
      const edit = p.edit;
      b.apply(() => edit);
    } else if (p.problem) toast(p.problem, "bad");
  };

  const events: StageEvents = {
    onHover(at, hit) {
      const next = at ? coarse(at) : undefined;
      if (!samePoint(next, pointer.at) || hit !== pointer.hit)
        setPointer({ ...(next ? { at: next } : {}), ...(hit ? { hit } : {}) });
    },
    onClick(at, hit, { shift }) {
      if (tool.kind !== "select") return commit(builder.planFor(where, tool, rotation, at));
      if (!hit) return b.setSelected([]);
      if (!shift) return b.setSelected([hit]);
      b.setSelected(
        selected.includes(hit) ? selected.filter((s) => s !== hit) : [...selected, hit],
      );
    },
    onDoubleClick(_at, hit) {
      const thing = hit ? index.find(hit) : undefined;
      if (thing && ENTERABLE.has(thing.kind)) b.go(builder.levelOf(index, thing.id));
    },
    onDrag(phase, from, to, hit) {
      if (phase === "start") {
        if (tool.kind === "select") {
          if (!hit || !index.find(hit)?.placement || index.find(hit)?.placement?.type === "unit")
            return false;
          b.setSelected([hit]);
          setDrag({ kind: "move", from, to, id: hit });
          return true;
        }
        if (tool.kind === "equipment") return false;
        setDrag({ kind: "tool", from, to });
        return true;
      }
      if (!drag) return false;
      const next = { ...drag, to };
      if (phase === "move") setDrag(next);
      else {
        setDrag(undefined);
        commit(planOf(next, undefined));
      }
      return true;
    },
  };

  const ghost: Ghost | undefined = plan
    ? { ...plan.rect, h: plan.height, ok: !plan.problem }
    : undefined;
  const hint = plan ? (plan.problem ?? plan.label) : builder.pointingHint(tool, pointer.hit, index);
  return { ...(ghost ? { ghost } : {}), hint, bad: Boolean(plan?.problem), events };
}
