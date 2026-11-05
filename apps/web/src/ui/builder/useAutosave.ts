import type { Blueprint } from "@terrarium/core/world";
import { useEffect, useRef } from "react";
import { builder } from "../../logic";
import type { Builder } from "./useBuilder";

/**
 * 저장은 자동 (REQ-077): a change is saved a moment after the last edit, by the owner of the world, once it has no
 * errors. A save that fails is not tried again until the next edit (a conflict would only repeat itself).
 */
export function useAutosave(b: Builder): void {
  const { blueprint, dirty, mine, saving, issues } = b.state;
  const errors = issues.filter((i) => i.severity === "error").length;
  const latest = useRef(b);
  latest.current = b;
  const tried = useRef<Blueprint | undefined>(undefined);
  const ready = builder.shouldAutosave({ mine, dirty, saving, errors });
  useEffect(() => {
    if (!ready || tried.current === blueprint) return;
    const timer = setTimeout(() => {
      tried.current = blueprint;
      void latest.current.save();
    }, builder.AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [ready, blueprint]);
}
