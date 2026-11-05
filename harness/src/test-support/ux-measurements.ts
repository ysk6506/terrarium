/** Measurements for the tests: a perfect run, and small changes to it. */
import { JOURNEY_BUDGETS, JOURNEY_IDS, type JourneyId, type Measurements } from "../ux/score";

const all = (n: number) => ({ tried: n, ok: n });

export function perfect(): Measurements {
  const journeys = Object.fromEntries(
    JOURNEY_IDS.map((id) => [id, { ok: true, actions: JOURNEY_BUDGETS[id] }]),
  ) as Record<JourneyId, { ok: boolean; actions: number }>;
  return {
    journeys,
    clean: all(20),
    invalid: all(4),
    colors: { literals: 40, offToken: 0 },
    progress: all(4),
    load: { kb: 300, ms: 900, sceneDrawn: true },
    reach: all(10),
    orientation: all(12),
    axe: { pages: 24, critical: 0, serious: 0, moderate: 0 },
    keyboard: all(5),
    focus: all(60),
    motion: { animated: 0 },
    failures: all(6),
    empties: all(4),
    provenance: all(14),
    value: all(6),
    voice: all(300),
    oneThing: all(13),
    buttons: all(60),
    targets: all(400),
    disabledWhy: all(10),
    units: all(80),
    hover: all(39),
  };
}

export function withChange(change: Partial<Measurements>): Measurements {
  return { ...perfect(), ...change };
}
