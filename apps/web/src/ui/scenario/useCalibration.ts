/**
 * "시험지 점검" (REQ-070): the editor asks the server to score the saved scenario with three agents that need no
 * model, and keeps the answer until the scenario changes.
 */
import type { CalibrationView } from "@terrarium/core/contract";
import type { ScenarioRecord } from "@terrarium/core/experiments";
import { useCallback, useState } from "react";
import { messageOf, useApp } from "../context";

export interface Checked {
  readonly view: CalibrationView;
  /** The saved version that was checked. */
  readonly digest: string;
}

export function useCalibration(ensureSaved: () => Promise<ScenarioRecord | undefined>) {
  const { api, toast } = useApp();
  const [checked, setChecked] = useState<Checked>();
  const [checking, setChecking] = useState(false);
  const check = useCallback(async () => {
    setChecking(true);
    try {
      const saved = await ensureSaved();
      if (!saved) return;
      const view = await api.call("calibrateScenario", {
        params: { id: saved.id },
        body: { seed: 1 },
      });
      setChecked({ view, digest: saved.digest });
    } catch (err) {
      toast(messageOf(err), "bad");
    } finally {
      setChecking(false);
    }
  }, [api, ensureSaved, toast]);
  return { checked, checking, check };
}
