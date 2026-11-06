/**
 * "알아서" (ADR-0107 item 4): the layers a person does not operate are chosen for them, from the kind of service and
 * from the other layers, and each says in one line how. A layer the person operates is theirs to choose: it starts on
 * the "보통" choice and stays unless they press another. A person who has not said what they operate gets all eight
 * chosen for them.
 */

import type { ServiceDraft } from "@terrarium/core/sources/worldgen";
import { MIDDLE_LAYERS } from "@terrarium/core/sources/worldgen";
import { LADDER, type LayerId, type Layers } from "@terrarium/core/world";
import { cardOf } from "./ladders";

export type PresetId = "auto" | "cheap" | "middle" | "steady";

export const PRESET_LABELS: Readonly<Record<PresetId, string>> = {
  auto: "알아서",
  cheap: "싸게",
  middle: "보통",
  steady: "멈추지 않게",
};

/** The left-most choice of every layer that the core can imitate: cheap and often down. */
const firstModeled = (layer: LayerId): string =>
  (LADDER[layer].find((c) => c.modeled) ?? (LADDER[layer][0] as { id: string })).id;

/** The right-most choice the core can imitate (a database has none, so its right-most that exists). */
const lastModeled = (layer: LayerId): string =>
  ([...LADDER[layer]].reverse().find((c) => c.modeled) ?? (LADDER[layer].at(-1) as { id: string }))
    .id;

const eachLayer = (pick: (layer: LayerId) => string): Layers =>
  Object.fromEntries(Object.keys(LADDER).map((l) => [l, pick(l as LayerId)])) as Layers;

/** The cheap row: `싸게`. The first choice, except the database, which has only dotted ones and starts on its first. */
export const CHEAP_LAYERS: Layers = {
  ...eachLayer(firstModeled),
  database: "db-single",
  compute: "cmp-bare",
};

export const STEADY_LAYERS: Layers = { ...eachLayer(lastModeled), database: "db-auto-failover" };

/** What a service asks of the layers: how big it is and how much a stop costs. */
interface Need {
  readonly nodes: number;
  readonly perHour: number;
  readonly kind: ServiceDraft["kind"];
  readonly name: string;
}

function needOf(services: readonly ServiceDraft[]): Need {
  const top = services.reduce<Need | undefined>((best, s) => {
    const perHour = s.harm.reduce((m, t) => Math.max(m, t.perHourKrw), 0);
    return !best || perHour > best.perHour
      ? { nodes: s.nodes, perHour, kind: s.kind, name: s.name }
      : best;
  }, undefined);
  return top ?? { nodes: 1, perHour: 0, kind: "request", name: "서비스" };
}

const label = (id: string): string => cardOf(id)?.label ?? id;

interface Autoed {
  readonly id: string;
  readonly why: string;
}

const man = (perHour: number): string =>
  `${Math.round(perHour / 10_000).toLocaleString("ko-KR")}만 원`;

type Chooser = (need: Need, chosen: Layers, given: string) => Autoed;

/** One chooser per layer: it reads the service and the layers chosen before it. */
const CHOOSERS: Readonly<Record<LayerId, Chooser>> = {
  network: (_, chosen, given) => ({
    id: isVirtual(chosen) ? "net-leaf-spine" : "net-three-tier",
    why: `${given}가 랙 사이를 오가서 길이 여럿인 모양으로`,
  }),
  compute: (need, _, given) =>
    need.nodes >= 3
      ? { id: "cmp-virt-ha", why: `${given}를 호스트 몇 대에 나눠 올릴 수 있어서` }
      : { id: "cmp-bare-spare", why: `${given}라 서버째 두고 예비 한 대만 두려고` },
  storage: (_, chosen) =>
    isVirtual(chosen)
      ? { id: "sto-shared", why: "VM을 호스트 사이로 옮기려면 공유 저장소가 있어야 해서" }
      : { id: "sto-raid-backup", why: "서버 안 디스크를 묶고 백업을 따로 두려고" },
  database: (need) =>
    need.kind === "batch"
      ? { id: "db-single", why: "쌓아 두고 돌리는 일이라 백업만으로 충분해서" }
      : {
          id: "db-primary-secondary",
          why: `멈추면 시간당 ${man(need.perHour)}이라 복제본을 두려고`,
        },
  app: (need, _, given) =>
    need.nodes >= 2
      ? { id: "app-lb-sticky", why: `${given}를 한 대 잃어도 나머지가 받게` }
      : { id: "app-single", why: "노드가 하나뿐이라" },
  power: (need) =>
    need.perHour >= 5_000_000
      ? { id: "pwr-2n-gen", why: "멈추면 피해가 커서 긴 정전도 버티게" }
      : { id: "pwr-ab", why: "한 줄이 꺼져도 돌아야 해서" },
  cooling: () => ({ id: "cool-n1", why: "냉방기 하나는 쉬어도 되게" }),
  site: (need, _, given) =>
    need.perHour >= 20_000_000
      ? { id: "site-two-rooms", why: "멈추면 피해가 커서 방 하나가 막혀도 돌게" }
      : { id: "site-one-room", why: `${given}와 다른 층에 맞춰서` },
};

const isVirtual = (chosen: Layers): boolean =>
  chosen.compute !== "cmp-bare" && chosen.compute !== "cmp-bare-spare";

/** One layer's "알아서" choice given what is already chosen in the layers it leans on. */
function autoFor(layer: LayerId, need: Need, chosen: Layers): Autoed {
  return CHOOSERS[layer](need, chosen, `${need.name}(${need.nodes}개 노드)`);
}

const ORDER: readonly LayerId[] = [
  "compute",
  "network",
  "storage",
  "database",
  "app",
  "power",
  "cooling",
  "site",
];

export interface Resolved {
  readonly layers: Layers;
  /** Layer → why it was chosen for them, for the layers on "알아서". */
  readonly why: Readonly<Partial<Record<LayerId, string>>>;
}

/**
 * The eight choices: a layer the person chose (`manual`) stays as chosen; every other layer is on "알아서" and is
 * worked out from the service and from the layers before it.
 */
export function resolveLayers(
  services: readonly ServiceDraft[],
  manual: Partial<Layers>,
): Resolved {
  const need = needOf(services);
  const layers: Record<string, string> = {};
  const why: Partial<Record<LayerId, string>> = {};
  for (const layer of ORDER) {
    const chosen = manual[layer];
    if (chosen !== undefined) {
      layers[layer] = chosen;
      continue;
    }
    const picked = autoFor(layer, need, { ...MIDDLE_LAYERS, ...layers } as Layers);
    layers[layer] = picked.id;
    why[layer] = `알아서 ${label(picked.id)}로 골랐어요 — ${picked.why}`;
  }
  return { layers: layers as Layers, why };
}

/** The layers of a preset. "알아서" is `resolveAuto`; the others are fixed rows that the person may then change one by one. */
export function presetLayers(preset: PresetId): Layers | undefined {
  if (preset === "cheap") return CHEAP_LAYERS;
  if (preset === "middle") return MIDDLE_LAYERS;
  if (preset === "steady") return STEADY_LAYERS;
  return undefined;
}

/** Which preset the layers are exactly, or undefined when they are mixed. */
export function presetOf(layers: Layers): PresetId | undefined {
  return (["cheap", "middle", "steady"] as const).find((p) => {
    const row = presetLayers(p);
    return (
      row !== undefined && Object.keys(row).every((l) => row[l as LayerId] === layers[l as LayerId])
    );
  });
}
