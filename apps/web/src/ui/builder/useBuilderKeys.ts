/**
 * The builder's keys: R turns, Delete removes, Esc steps back (tool, then selection, then level),
 * Ctrl+Z / Ctrl+Shift+Z undo and redo, Ctrl+S saves. Typing in a field is left alone.
 */
import { useEffect, useRef } from "react";
import { builder } from "../../logic";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";

const typing = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

function turn(b: Builder): void {
  const { tool, rotation, selected, index, level } = b.state;
  if (tool.kind === "rack" || tool.kind === "equipment") {
    b.setRotation(builder.nextRotation(rotation));
    return;
  }
  const one = selected.length === 1 ? index.find(selected[0] as string) : undefined;
  if (one?.placement?.type === "spot") b.apply((bp) => builder.rotate(bp, catalog, level, one.id));
}

function back(b: Builder): void {
  const { tool, selected, index, level } = b.state;
  if (tool.kind !== "select") b.setTool({ kind: "select" });
  else if (selected.length > 0) b.setSelected([]);
  else up(b, index, level);
}

function up(b: Builder, index: Builder["state"]["index"], level: Builder["state"]["level"]): void {
  const up = builder.crumbs(index, level).at(-2);
  if (up) b.go(up.level);
}

function withCtrl(b: Builder, e: KeyboardEvent): boolean {
  const key = e.key.toLowerCase();
  if (key === "z" && !e.shiftKey) b.undo();
  else if ((key === "z" && e.shiftKey) || key === "y") b.redo();
  else if (key === "s") {
    if (b.state.mine) void b.save();
    else void b.saveCopy();
  } else return false;
  return true;
}

export function useBuilderKeys(b: Builder): void {
  const latest = useRef(b);
  latest.current = b;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.altKey) return;
      const now = latest.current;
      let handled = true;
      if (e.ctrlKey || e.metaKey) handled = withCtrl(now, e);
      else if (e.key === "r" || e.key === "R") turn(now);
      else if (e.key === "Delete" || e.key === "Backspace") {
        if (now.state.selected.length > 0)
          now.apply((bp) => builder.remove(bp, now.state.selected));
      } else if (e.key === "Escape") back(now);
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);
}
