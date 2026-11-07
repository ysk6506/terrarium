/**
 * "알아서" (ADR-0107 item 4): the layers a person does not operate are chosen for them, from the kind of service and
 * from the other layers, and each says in one line how. A layer the person operates is theirs to choose: it starts on
 * the "보통" choice and stays unless they press another. A person who has not said what they operate gets all eight
 * chosen for them.
 */

import { withJosa } from "@terrarium/core/kernel";
import type { ServiceDraft, ServiceLayers } from "@terrarium/core/sources/worldgen";
import { MIDDLE_LAYERS, SERVICE_LAYERS } from "@terrarium/core/sources/worldgen";
import {
  type ChipMech,
  cheapestWay,
  LADDER,
  LAYER_IDS,
  type LayerId,
  type Layers,
  placeOf,
  unmetNeeds,
  unmetOf,
} from "@terrarium/core/world";
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

/** The right-most choice the core can imitate. */
const lastModeled = (layer: LayerId): string =>
  ([...LADDER[layer]].reverse().find((c) => c.modeled) ?? (LADDER[layer].at(-1) as { id: string }))
    .id;

const eachLayer = (pick: (layer: LayerId) => string): Layers =>
  Object.fromEntries(Object.keys(LADDER).map((l) => [l, pick(l as LayerId)])) as Layers;

/** The cheap row: `싸게`. The left-most choice the core can imitate, on bare metal. */
export const CHEAP_LAYERS: Layers = { ...eachLayer(firstModeled), compute: "cmp-bare" };

export const STEADY_LAYERS: Layers = eachLayer(lastModeled);

/** What a service asks of the layers: how big it is and how much a stop costs. */
interface Need {
  readonly nodes: number;
  readonly perHour: number;
  readonly kind: ServiceDraft["kind"];
  readonly name: string;
  /** The service is a Kubernetes built on its VMs (its card has a control plane among its nodes). */
  readonly k8s: boolean;
}

const isCluster = (s: ServiceDraft): boolean =>
  s.parts.some((p) => p.role === "node" && p.label.includes("컨트롤 플레인"));

function needOf(services: readonly ServiceDraft[]): Need {
  const top = services.reduce<Need | undefined>((best, s) => {
    const perHour = s.harm.reduce((m, t) => Math.max(m, t.perHourKrw), 0);
    return !best || perHour > best.perHour
      ? { nodes: s.nodes, perHour, kind: s.kind, name: s.name, k8s: isCluster(s) }
      : best;
  }, undefined);
  return top ?? { nodes: 1, perHour: 0, kind: "request", name: "서비스", k8s: false };
}

const label = (id: string): string => cardOf(id)?.label ?? id;

interface Autoed {
  readonly id: string;
  readonly why: string;
}

const man = (perHour: number): string =>
  `${Math.round(perHour / 10_000).toLocaleString("ko-KR")}만 원`;

type Chooser = (need: Need, chosen: Layers) => Autoed;

/** One chooser per layer: it reads the service and the layers chosen before it. Each says one short cause. */
const CHOOSERS: Readonly<Record<LayerId, Chooser>> = {
  network: (_, chosen) =>
    isVirtual(chosen)
      ? { id: "net-leaf-spine", why: "랙 사이를 오가는 길이 여럿이라서" }
      : { id: "net-three-tier", why: "서버가 랙 사이를 두 줄로 오가면 충분해서" },
  compute: (need) =>
    need.k8s
      ? { id: "cmp-containers", why: `${need.name} 카드에 컨트롤 플레인 VM이 있어서` }
      : need.nodes >= 3
        ? { id: "cmp-virt-ha", why: "노드가 여럿이라 호스트 몇 대에 나눠 올려서" }
        : { id: "cmp-bare-spare", why: "노드가 하나뿐이라 서버째 두고 예비 한 대만 둬서" },
  storage: (_, chosen) =>
    isVirtual(chosen)
      ? { id: "sto-shared", why: "VM을 옮기려면 공유 저장소가 있어야 해서" }
      : { id: "sto-raid-backup", why: "서버 안 디스크를 묶고 백업을 따로 둬서" },
  database: (need) =>
    need.kind === "batch"
      ? { id: "db-single", why: "쌓아 두고 돌리는 일이라 백업이면 충분해서" }
      : {
          id: "db-primary-secondary",
          why:
            need.perHour > 0
              ? `멈추면 시간당 ${man(need.perHour)}이라서`
              : "복제본 하나는 있어야 해서",
        },
  app: (need) =>
    need.nodes >= 2
      ? { id: "app-lb-sticky", why: "한 대를 잃어도 나머지가 받게" }
      : { id: "app-single", why: "노드가 하나뿐이라서" },
  power: (need) =>
    need.perHour >= 5_000_000
      ? { id: "pwr-2n-gen", why: "멈추면 피해가 커서 긴 정전도 버티게" }
      : { id: "pwr-ab", why: "한 줄이 꺼져도 돌아야 해서" },
  cooling: () => ({ id: "cool-n1", why: "냉방기 하나는 쉬어도 되게" }),
  site: (need) =>
    need.perHour >= 20_000_000
      ? { id: "site-two-rooms", why: "멈추면 피해가 커서 방 하나가 막혀도 돌게" }
      : { id: "site-one-room", why: "서버룸 하나로 충분해서" },
};

const isVirtual = (chosen: Layers): boolean =>
  chosen.compute !== "cmp-bare" && chosen.compute !== "cmp-bare-spare";

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

/** The nearest choice to the left of `id` whose needs the layers meet; the left-most when none does. */
function leftOf(layers: Layers, layer: LayerId, id: string): string {
  const chips = LADDER[layer];
  for (let i = placeOf(layer, id) - 1; i > 0; i--) {
    const chip = chips[i] as ChipMech;
    if (unmetNeeds({ ...layers, [layer]: chip.id }, layer, chip.id).length === 0) return chip.id;
  }
  return (chips[0] as ChipMech).id;
}

/**
 * Makes the "알아서" layers whole (REQ-102): a layer the person chose is never touched. Where an unmet need stands, the
 * layer on "알아서" gives way: the choice that needs moves left, or the layer it leans on is raised to what it needs.
 */
function mend(
  layers: Record<string, string>,
  auto: ReadonlySet<LayerId>,
  why: Partial<Record<LayerId, string>>,
): void {
  for (let round = 0; round < LAYER_IDS.length * 2; round++) {
    const open = unmetOf(layers as Layers)[0];
    if (!open) return;
    const way = cheapestWay(open.need);
    if (auto.has(way.layer)) {
      layers[way.layer] = way.atLeast;
      why[way.layer] = `${label(open.chip)}에 필요해서`;
    } else if (auto.has(open.layer)) {
      layers[open.layer] = leftOf(layers as Layers, open.layer, open.chip);
      why[open.layer] = `${withJosa(label(way.atLeast), "이")} 아니라서 낮춰서`;
    } else {
      return;
    }
  }
}

export interface Resolved {
  readonly layers: Layers;
  /** Layer → the one short cause it was chosen for them ("VM을 옮기려면 공유 저장소가 있어야 해서"), for the layers on "알아서". */
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
  const auto = new Set<LayerId>();
  for (const layer of ORDER) {
    const chosen = manual[layer];
    if (chosen !== undefined) {
      layers[layer] = chosen;
      continue;
    }
    const picked = CHOOSERS[layer](need, { ...MIDDLE_LAYERS, ...layers } as Layers);
    layers[layer] = picked.id;
    why[layer] = picked.why;
    auto.add(layer);
  }
  mend(layers, auto, why);
  return { layers: layers as Layers, why };
}

/**
 * The four layers a service chooses for itself (ADR-0108 item 5): what the person pressed stays, and the rest is worked
 * out for this service alone. Each one that is "알아서" says why.
 */
export function resolveServiceLayers(
  service: ServiceDraft,
  manual: Partial<Layers>,
): { readonly layers: ServiceLayers; readonly why: Resolved["why"] } {
  const { layers, why } = resolveLayers([service], manual);
  return {
    layers: Object.fromEntries(SERVICE_LAYERS.map((l) => [l, layers[l]])) as ServiceLayers,
    why,
  };
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
