/**
 * The services after the first that chose their own shape (ADR-0108 item 5, ADR-0112): what the person pressed for
 * each, by service key, over the four layers a service chooses. The first service's shape is the world's.
 */
import { SERVICE_LAYERS, type ServiceDraft } from "@terrarium/core/sources/worldgen";
import type { LayerId, Layers } from "@terrarium/core/world";
import { useCallback, useState } from "react";
import { type PresetId, presetLayers, resolveServiceLayers } from "../../logic";
import type { LadderState } from "./shape-flow";

export type ApartMap = Readonly<Record<string, Partial<Layers>>>;

/** The services as the spec carries them: a later one that chose its own has four layers of its own, the rest none. */
export function shapedServices(services: readonly ServiceDraft[], apart: ApartMap): ServiceDraft[] {
  return services.map((s, i) => {
    const { layers: _own, ...rest } = s;
    const mine = i > 0 ? apart[s.key] : undefined;
    return mine ? { ...rest, layers: resolveServiceLayers(rest, mine).layers } : rest;
  });
}

/** Which preset a service's own choices are exactly, over the four layers it chooses. */
function apartPreset(mine: Partial<Layers>): PresetId | undefined {
  if (SERVICE_LAYERS.every((l) => mine[l] === undefined)) return "auto";
  for (const id of ["cheap", "middle", "steady"] as const) {
    const row = presetLayers(id);
    if (row && SERVICE_LAYERS.every((l) => row[l] === mine[l])) return id;
  }
  return undefined;
}

const fromRow = (row: Layers): Partial<Layers> =>
  Object.fromEntries(SERVICE_LAYERS.map((l) => [l, row[l]]));

export function useApart(services: readonly ServiceDraft[]) {
  const [apart, setApart] = useState<ApartMap>(() =>
    Object.fromEntries(services.slice(1).flatMap((s) => (s.layers ? [[s.key, s.layers]] : []))),
  );
  const choose = useCallback((key: string, layer: LayerId, chip: string | undefined) => {
    setApart((all) => {
      const { [layer]: _gone, ...rest } = all[key] ?? {};
      return { ...all, [key]: chip === undefined ? rest : { ...rest, [layer]: chip } };
    });
  }, []);
  /** What a screen of ladders reads and changes for a service that chose its own. */
  const stateOf = (service: ServiceDraft, world: Layers): LadderState | undefined => {
    const mine = apart[service.key];
    if (!mine) return undefined;
    const own = resolveServiceLayers(service, mine);
    return {
      manual: mine,
      layers: { ...world, ...own.layers },
      why: own.why,
      preset: apartPreset(mine),
      choose: (layer, chip) => choose(service.key, layer, chip),
      applyPreset: (p) => {
        const row = presetLayers(p);
        setApart((all) => ({ ...all, [service.key]: row ? fromRow(row) : {} }));
      },
    };
  };
  /** "따로 고르기" starts as the world's shape, so it changes only what the person presses; off, it goes back to "같은 모양". */
  const toggle = (service: ServiceDraft, on: boolean, world: Layers) =>
    setApart(({ [service.key]: _gone, ...rest }) =>
      on ? { ...rest, [service.key]: fromRow(world) } : rest,
    );
  /** The service that comes first is the world's shape: if it had chosen its own, that is taken out and handed back. */
  const adopt = (head: ServiceDraft | undefined): Partial<Layers> | undefined => {
    const mine = head ? apart[head.key] : undefined;
    if (head && mine) setApart(({ [head.key]: _taken, ...rest }) => rest);
    return mine;
  };
  return { apart, stateOf, toggle, adopt };
}
