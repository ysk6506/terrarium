/**
 * The state of the three "서비스부터" screens (ADR-0107, ADR-0108): which services, which choice on which ladder, how
 * many servers. What a person did not choose is worked out ("알아서"), so the spec at any moment is whole. Which layers
 * the person operates is kept in this browser until the experiment settings' "내 도메인" (ADR-0098) can say it.
 */
import {
  askOf,
  DEFAULT_SHAPE,
  defaultSize,
  type ServiceDraft,
  type ShapeSpec,
  type SizeAsk,
  sizeFields,
  sizeFromServers,
} from "@terrarium/core/sources/worldgen";
import { LAYER_IDS, type LayerId, type Layers } from "@terrarium/core/world";
import { useCallback, useMemo, useState } from "react";
import {
  type PresetId,
  presetLayers,
  type ResolveOptions,
  resolveLayers,
  STEPS,
  type Step,
  type WorldDraft,
  worldNameFor,
} from "../../logic";
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
  /** The size as three numbers: what the person typed over what the services ask for (REQ-109). */
  readonly size: SizeAsk;
  readonly sizeDefault: SizeAsk;
  /** Which of the three the person typed (the rest follow the services). */
  readonly sizeTyped: Readonly<Partial<SizeAsk>>;
  setSize(patch: Partial<SizeAsk>): void;
  /** Give the three numbers back to what the services ask for. */
  resetSize(): void;
  /** The cost preset on "알아서": -1 one choice cheaper, 1 one choice steadier (REQ-109). */
  readonly cost: -1 | 0 | 1;
  setCost(cost: -1 | 0 | 1): void;
  setName(name: string): void;
  /** Choose one layer, or give it back to "알아서" with `undefined`. */
  choose(layer: LayerId, chip: string | undefined): void;
  applyPreset(preset: PresetId): void;
  setOwn(own: readonly LayerId[]): void;
  /** What the person has done so far, for the draft kept in the session. */
  draft(metas: WorldDraft["metas"]): WorldDraft;
  /** Back to the start (IAP, "알아서", the sizes the services ask for). */
  reset(): void;
}

/** The size a template or an older spec starts with: its three numbers, or the three an old `servers` stands for. */
function startSize(spec: ShapeSpec): Partial<SizeAsk> {
  return askOf(spec) ?? sizeFromServers(spec.servers);
}

/** The layers a person has chosen by hand, the ones they operate, and the ways to change them. */
function useLayerPicks(kept: Partial<Layers> | undefined, shape: Layers) {
  const [own, setOwnState] = useState<readonly LayerId[]>(loadOwn);
  const [manual, setManual] = useState<Partial<Layers>>(() => kept ?? manualOf(loadOwn(), shape));
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
  return { own, manual, setManual, choose, applyPreset, setOwn };
}

/** The spec the screens show: the world's name, the size (what the services ask for, over what was typed), the layers and the services. */
function useSpec(p: {
  readonly first: ShapeSpec;
  readonly fromTemplate: boolean;
  readonly name: string;
  readonly typed: Partial<SizeAsk>;
  readonly services: readonly ServiceDraft[];
  readonly resolved: { readonly layers: Layers };
  readonly shaped: readonly ServiceDraft[];
}) {
  const { first, fromTemplate, name, typed, services, resolved, shaped } = p;
  const sizeDefault = useMemo(() => defaultSize(services), [services]);
  const size = useMemo<SizeAsk>(() => ({ ...sizeDefault, ...typed }), [sizeDefault, typed]);
  const spec = useMemo<ShapeSpec>(
    () => ({
      name: worldNameFor(name.trim() || first.name, shaped),
      seed: first.seed,
      site: first.site,
      ...sizeFields(size),
      ...(first.real && fromTemplate ? { real: true } : {}),
      layers: resolved.layers,
      services: shaped,
    }),
    [name, first, size, resolved, shaped, fromTemplate],
  );
  return { spec, size, sizeDefault };
}

/** The state of a world in progress: what was kept or started from, and what the person changes. */
/**
 * The spec to start from: a template's, a draft kept in the session, or the example (IAP, "알아서", the sizes IAP asks
 * for). The kept draft is how a person finds their world again after another menu.
 */
function useShapeCore(
  start?: ShapeSpec,
  fromTemplate = false,
  startAt: Step = "services",
  kept?: WorldDraft,
) {
  const first = start ?? DEFAULT_SHAPE;
  const [step, setStep] = useState<Step>(startAt);
  const [services, setServices] = useState<readonly ServiceDraft[]>(
    kept?.services ?? first.services,
  );
  const picks = useLayerPicks(
    kept?.manual ?? (fromTemplate ? first.layers : undefined),
    first.layers,
  );
  const { manual } = picks;
  const [cost, setCost] = useState<-1 | 0 | 1>(kept?.cost ?? 0);
  const options = useMemo<ResolveOptions>(() => ({ cost }), [cost]);
  const shapes = useApart(first.services, kept?.apart, options);
  const [ladder, setLadder] = useState(0);
  const [typed, setTyped] = useState<Partial<SizeAsk>>(
    kept?.size ?? (fromTemplate ? startSize(first) : {}),
  );
  const [name, setName] = useState(kept?.name ?? first.name);
  const resolved = useMemo(
    () => resolveLayers(services, manual, options),
    [services, manual, options],
  );
  const shaped = useMemo(
    () => shapedServices(services, shapes.apart, options),
    [services, shapes.apart, options],
  );
  const { spec, size, sizeDefault } = useSpec({
    first,
    fromTemplate,
    name,
    typed,
    services,
    resolved,
    shaped,
  });
  return {
    step,
    setStep,
    services,
    setServices,
    picks,
    cost,
    setCost,
    shapes,
    ladder,
    setLadder,
    typed,
    setTyped,
    name,
    setName,
    resolved,
    spec,
    size,
    sizeDefault,
  };
}

type Core = ReturnType<typeof useShapeCore>;

/**
 * The spec to start from: a template's, a draft kept in the session, or the example (IAP, "알아서", the sizes IAP asks
 * for). The kept draft is how a person finds their world again after another menu.
 */
export function useShapeFlow(
  start?: ShapeSpec,
  fromTemplate = false,
  startAt: Step = "services",
  kept?: WorldDraft,
): Flow {
  return flowOf(useShapeCore(start, fromTemplate, startAt, kept));
}

/** What the screens get: the state of the core, with the ways to change it. */
function flowOf(c: Core): Flow {
  const { step, setStep, services, setServices, picks, cost, setCost, shapes, ladder, setLadder } =
    c;
  const { typed, setTyped, name, setName, resolved, spec, size, sizeDefault } = c;
  const { own, manual, setManual } = picks;
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
    size,
    sizeDefault,
    sizeTyped: typed,
    setSize: (patch) => setTyped((t) => ({ ...t, ...patch })),
    resetSize: () => setTyped({}),
    cost,
    setCost,
    setName,
    choose: picks.choose,
    applyPreset: picks.applyPreset,
    setOwn: picks.setOwn,
    draft: (metas) => ({
      v: 1,
      services,
      manual,
      apart: shapes.apart,
      size: typed,
      name,
      step,
      ladder,
      metas,
      cost,
    }),
    reset: () => {
      setServices(DEFAULT_SHAPE.services);
      setManual(manualOf(loadOwn(), DEFAULT_SHAPE.layers));
      shapes.reset();
      setTyped({});
      setCost(0);
      setName(DEFAULT_SHAPE.name);
      setLadder(0);
      setStep("services");
    },
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
