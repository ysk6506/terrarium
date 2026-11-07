/**
 * The state of the three "서비스부터" screens (ADR-0107, ADR-0108): which services, which choice on which ladder, how
 * many servers. What a person did not choose is worked out ("알아서"), so the spec at any moment is whole. Which layers
 * the person operates is kept in this browser until the experiment settings' "내 도메인" (ADR-0098) can say it.
 */
import { DEFAULT_SHAPE, type ServiceDraft, type ShapeSpec } from "@terrarium/core/sources/worldgen";
import { LAYER_IDS, type LayerId, type Layers } from "@terrarium/core/world";
import { useCallback, useMemo, useState } from "react";
import { type PresetId, presetLayers, resolveLayers, STEPS, type Step } from "../../logic";
import { shapedServices, useApart } from "./shape-apart";

export type { Step };
export { STEPS };

const OWN_KEY = "terrarium.ownLayers";

function loadOwn(): LayerId[] {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(OWN_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? LAYER_IDS.filter((l) => raw.includes(l)) : [];
  } catch {
    return [];
  }
}

function saveOwn(own: readonly LayerId[]): void {
  try {
    globalThis.localStorage?.setItem(OWN_KEY, JSON.stringify(own));
  } catch {
    // Without storage the choice lasts the visit.
  }
}

/** The layers the person chose themselves: the ones they operate start on "보통". */
const manualOf = (own: readonly LayerId[], from: Layers): Partial<Layers> =>
  Object.fromEntries(own.map((l) => [l, from[l]])) as Partial<Layers>;

/** What one screen of ladders reads and changes: the world's layers, or those of a service that chose its own. */
export interface LadderState {
  readonly manual: Partial<Layers>;
  readonly layers: Layers;
  readonly why: Readonly<Partial<Record<LayerId, string>>>;
  readonly preset: PresetId | undefined;
  choose(layer: LayerId, chip: string | undefined): void;
  applyPreset(preset: PresetId): void;
}

export interface Flow {
  readonly step: Step;
  readonly spec: ShapeSpec;
  /** Which service's ladders the second screen shows ("서비스 2 / 2"). */
  readonly ladder: number;
  setLadder(index: number): void;
  /** The ladders of a service other than the first: its own when it chose "따로 고르기", else nothing. */
  apartOf(service: ServiceDraft): LadderState | undefined;
  /** "따로 고르기" (starting from the world's shape) or back to "같은 모양". */
  setApart(service: ServiceDraft, apart: boolean): void;
  readonly manual: Partial<Layers>;
  readonly own: readonly LayerId[];
  readonly why: Readonly<Partial<Record<LayerId, string>>>;
  readonly preset: PresetId | undefined;
  go(step: Step): void;
  setServices(next: readonly ServiceDraft[]): void;
  setServers(n: number, real?: boolean): void;
  setName(name: string): void;
  /** Choose one layer, or give it back to "알아서" with `undefined`. */
  choose(layer: LayerId, chip: string | undefined): void;
  applyPreset(preset: PresetId): void;
  setOwn(own: readonly LayerId[]): void;
}

/** The spec to start from: a template's, or the example (IAP, "보통", 480 servers). */
export function useShapeFlow(
  start?: ShapeSpec,
  fromTemplate = false,
  startAt: Step = "services",
): Flow {
  const first = start ?? DEFAULT_SHAPE;
  const [step, setStep] = useState<Step>(startAt);
  const [own, setOwnState] = useState<readonly LayerId[]>(loadOwn);
  const [services, setServices] = useState<readonly ServiceDraft[]>(first.services);
  const [manual, setManual] = useState<Partial<Layers>>(() =>
    fromTemplate ? first.layers : manualOf(loadOwn(), first.layers),
  );
  const shapes = useApart(first.services);
  const [ladder, setLadder] = useState(0);
  const [size, setSize] = useState({ servers: first.servers, real: Boolean(first.real) });
  const [name, setName] = useState(first.name);
  const resolved = useMemo(() => resolveLayers(services, manual), [services, manual]);
  const shaped = useMemo(() => shapedServices(services, shapes.apart), [services, shapes.apart]);
  const spec = useMemo<ShapeSpec>(
    () => ({
      name: name.trim() || first.name,
      seed: first.seed,
      site: first.site,
      servers: size.servers,
      ...(size.real ? { real: true } : {}),
      layers: resolved.layers,
      services: shaped,
    }),
    [name, first, size, resolved, shaped],
  );
  const choose = useCallback((layer: LayerId, chip: string | undefined) => {
    setManual(({ [layer]: _gone, ...rest }) =>
      chip === undefined ? rest : { ...rest, [layer]: chip },
    );
  }, []);
  const applyPreset = useCallback(
    (preset: PresetId) => {
      const row = presetLayers(preset);
      // "알아서" hands the layers back, except the ones the person operates: those stay as chosen.
      setManual((m) =>
        row
          ? { ...row }
          : (Object.fromEntries(own.filter((l) => m[l]).map((l) => [l, m[l]])) as Partial<Layers>),
      );
    },
    [own],
  );
  const setOwn = useCallback((next: readonly LayerId[]) => {
    saveOwn(next);
    setOwnState(next);
  }, []);
  return {
    step,
    spec,
    ladder,
    setLadder,
    apartOf: (service) => shapes.stateOf(service, resolved.layers),
    setApart: (service, on) => shapes.toggle(service, on, resolved.layers),
    manual,
    own,
    why: resolved.why,
    preset: presetFor(manual, own),
    go: setStep,
    setServices: (next) => {
      setServices(next);
      setLadder((i) => Math.min(i, Math.max(0, next.length - 1)));
      // the service that comes first is the world's shape: if it had chosen its own, that is the world's now
      const mine = shapes.adopt(next[0]);
      if (mine) setManual((m) => ({ ...m, ...mine }));
    },
    setServers: (servers, real = false) => setSize({ servers, real }),
    setName,
    choose,
    applyPreset,
    setOwn,
  };
}

/** Which preset the manual choices are exactly: "알아서" when only the operated layers are chosen. */
function presetFor(manual: Partial<Layers>, own: readonly LayerId[]): PresetId | undefined {
  const chosen = Object.keys(manual) as LayerId[];
  if (chosen.every((l) => own.includes(l))) return "auto";
  if (chosen.length < LAYER_IDS.length) return undefined;
  for (const id of ["cheap", "middle", "steady"] as const) {
    const row = presetLayers(id);
    if (row && LAYER_IDS.every((l) => row[l] === manual[l])) return id;
  }
  return undefined;
}
