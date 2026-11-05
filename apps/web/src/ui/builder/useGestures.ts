/**
 * Turns pointing and dragging in the 3D view into builder actions: the ghost of what would be placed,
 * the hint line, and what happens on click, double-click and drag. The decisions live in
 * logic.builder (planFor, movePlan); this only keeps track of the pointer.
 */
import type { Entity } from "@terrarium/core/world";
import { useMemo, useState } from "react";
import { builder, hasLearned, learn, type world3d } from "../../logic";
import { browserStore } from "../browser-store";
import type { Ghost, PlanPoint, StageEvents } from "../world3d/stage-types";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";

interface Drag {
  readonly kind: "tool" | "move" | "handle";
  readonly from: PlanPoint;
  readonly to: PlanPoint;
  readonly id?: string;
  readonly handle?: builder.Handle;
}

/** Pointer positions are kept to 10 cm, so the screen redraws only when the ghost could move. */
const coarse = (p: PlanPoint): PlanPoint => ({
  x: Math.round(p.x * 10) / 10,
  y: Math.round(p.y * 10) / 10,
});
const samePoint = (a?: PlanPoint, b?: PlanPoint) => a?.x === b?.x && a?.y === b?.y;

const ENTERABLE = new Set(["building", "floor", "room"]);
const POINTING_TOOLS = new Set(["rack", "equipment", "buy", "plant"]);
/** Tools that act on one click, wherever the pointer went down: dragging does nothing for them. */
const CLICK_TOOLS = new Set(["equipment", "buy", "plant"]);

/** What the hint line says while the pointer is on a handle. */
const HANDLE_HINTS = {
  edge: "끌면 이 변이 움직여서 크기가 바뀌어요",
  attach: "바깥으로 끌어내면 조각이 붙어요",
} as const;

export interface Gestures {
  readonly ghost?: Ghost;
  /** The handles of the selected room or building, ready for the stage. */
  readonly handles: readonly world3d.PlanHandle[];
  readonly hint: string;
  readonly bad: boolean;
  readonly events: StageEvents;
}

/** The room or building whose sides can be dragged now: the one picked, else the one the level is inside. */
function handleTarget(b: Builder): Entity | undefined {
  const { index, level, selected, tool } = b.state;
  if (tool.kind !== "select" || selected.length > 1) return undefined;
  if (selected.length === 1) return index.find(selected[0] as string);
  if (level.kind === "room") return index.find(level.id);
  return level.kind === "floor" ? index.enclosing(level.id, "building") : undefined;
}

/** The handles of that room or building, as the builder has them and as the stage draws them. */
function useHandles(b: Builder) {
  const { index, level } = b.state;
  const target = handleTarget(b);
  const handles = useMemo(() => builder.handlesFor(index, level, target), [index, level, target]);
  const size = target ? builder.handleSize(target) : 1;
  const planHandles = useMemo<world3d.PlanHandle[]>(
    () => handles.map((h) => ({ x: h.at.x, z: h.at.y, size, kind: h.kind, side: h.side })),
    [handles, size],
  );
  return { handles, size, planHandles };
}

/** A click with the select tool: pick, add to the pick, or let go of it. */
function selectOnClick(b: Builder, hit: string | undefined, shift: boolean): void {
  const { selected } = b.state;
  if (!hit) b.setSelected([]);
  else if (!shift) b.setSelected([hit]);
  else
    b.setSelected(selected.includes(hit) ? selected.filter((s) => s !== hit) : [...selected, hit]);
}

/** What the hint line says: the plan's words or its reason, the handle under the pointer, or the tool's hint. */
function hintOf(
  b: Builder,
  plan: builder.Plan | undefined,
  over: builder.Handle | undefined,
  seen: { readonly hit: string | undefined; readonly dragged: boolean },
): string {
  if (plan) return plan.problem ?? plan.label;
  if (over) return HANDLE_HINTS[over.kind];
  const hint = builder.pointingHint(b.state.tool, seen.hit, b.state.index);
  // Said until the first drag of the picture, then gone: the person knows.
  return seen.dragged && hint === builder.DRAG_HINT ? "" : hint;
}

/** The plan of a gesture in progress, or of just pointing with a tool that shows where it would go. */
function planOf(
  where: builder.Where,
  b: Builder,
  d: Drag | undefined,
  at: PlanPoint | undefined,
): builder.Plan | undefined {
  const { tool, rotation } = b.state;
  if (d?.kind === "handle" && d.handle) return builder.handlePlan(where, d.handle, d.from, d.to);
  if (d?.kind === "move" && d.id) return builder.movePlan(where, d.id, d.from, d.to);
  if (d) return builder.planFor(where, tool, rotation, d.from, d.to);
  if (at && POINTING_TOOLS.has(tool.kind)) return builder.planFor(where, tool, rotation, at);
  return undefined;
}

/** Apply a plan when the gesture ends, or say why it cannot be. */
function commit(b: Builder, p: builder.Plan | undefined): void {
  if (!p) return;
  if (p.edit) {
    const edit = p.edit;
    // A drag that stopped at the limit of the floor is applied as far as it went, and says why it went no further.
    if (b.apply(() => edit) && p.stopped) b.refuse(p.stopped.message, p.stopped.way);
  } else if (p.problem) b.refuse(p.problem, p.way);
}

/** What a pointer-down with the select tool takes hold of: a handle, or a thing to move. */
function grab(
  b: Builder,
  handles: readonly builder.Handle[],
  reach: number,
  at: { readonly from: PlanPoint; readonly to: PlanPoint; readonly hit: string | undefined },
): Drag | undefined {
  const { from, to, hit } = at;
  const handle = builder.handleAt(handles, from, reach);
  if (handle) return { kind: "handle", from, to, handle };
  const thing = hit ? b.state.index.find(hit) : undefined;
  // Land is bought, not moved.
  if (!thing?.placement || thing.placement.type === "unit" || thing.kind === "parcel")
    return undefined;
  b.setSelected([thing.id]);
  return { kind: "move", from, to, id: thing.id };
}

export function useGestures(b: Builder): Gestures {
  const { blueprint, index, level, tool, rotation, selected } = b.state;
  const { handles, size, planHandles } = useHandles(b);
  const [pointer, setPointer] = useState<{ at?: PlanPoint; hit?: string }>({});
  const [drag, setDrag] = useState<Drag>();
  const [dragged, setDragged] = useState(() => hasLearned(browserStore(), "drag"));
  const where: builder.Where = { bp: blueprint, index, catalog, level };
  // biome-ignore lint/correctness/useExhaustiveDependencies: `where` is rebuilt from these each render
  const plan = useMemo(
    () => planOf(where, b, drag, pointer.at),
    [drag, pointer.at, blueprint, level, tool, rotation],
  );

  const events: StageEvents = {
    onHover(at, hit) {
      const next = at ? coarse(at) : undefined;
      if (!samePoint(next, pointer.at) || hit !== pointer.hit)
        setPointer({ ...(next ? { at: next } : {}), ...(hit ? { hit } : {}) });
    },
    onClick(at, hit, { shift }) {
      if (tool.kind !== "select") return commit(b, builder.planFor(where, tool, rotation, at));
      if (builder.handleAt(handles, at, size * 1.2)) return;
      const room =
        hit && selected.length === 1 && selected[0] === hit ? index.find(hit) : undefined;
      // Pressing a room that is already picked chooses the piece under the pointer.
      if (room?.kind === "room") return b.setPiece(builder.pieceAt(index, level, room, at));
      selectOnClick(b, hit, shift);
    },
    onDoubleClick(_at, hit) {
      const thing = hit ? index.find(hit) : undefined;
      if (thing && ENTERABLE.has(thing.kind)) b.go(builder.levelOf(index, thing.id));
    },
    onDrag(phase, from, to, hit) {
      if (phase === "start") {
        if (tool.kind === "select") {
          const grabbed = grab(b, handles, size * 1.2, { from, to, hit });
          if (grabbed) setDrag(grabbed);
          else if (!dragged) {
            learn(browserStore(), "drag");
            setDragged(true);
          }
          return grabbed !== undefined;
        }
        if (CLICK_TOOLS.has(tool.kind)) return false;
        setDrag({ kind: "tool", from, to });
        return true;
      }
      if (!drag) return false;
      const next = { ...drag, to };
      if (phase === "move") setDrag(next);
      else {
        setDrag(undefined);
        commit(b, planOf(where, b, next, undefined));
      }
      return true;
    },
  };

  const ghost: Ghost | undefined = plan
    ? { ...plan.rect, h: plan.height, ok: !plan.problem }
    : undefined;
  const over = pointer.at ? builder.handleAt(handles, pointer.at, size * 1.2) : undefined;
  return {
    ...(ghost ? { ghost } : {}),
    handles: planHandles,
    hint: hintOf(b, plan, over, { hit: pointer.hit, dragged }),
    bad: Boolean(plan?.problem),
    events,
  };
}
