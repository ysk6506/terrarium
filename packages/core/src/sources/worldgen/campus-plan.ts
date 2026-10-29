/**
 * Deciding what a campus holds before anything is built: which halls each building has, how big each
 * is, how it is cooled, and which kinds of pod fill it. Pure: the same spec gives the same plan.
 */
import type { SeededRng } from "@terrarium/core/kernel";
import { DLC_RACKS, FAMILIES, type Family, RDHX_RACK, TANKS } from "./campus-families";
import type { CampusProfile, CampusSpec } from "./campus-spec";

export type HallMode = "air" | "hybrid" | "dlc" | "immersion";
export type PodKind = "air" | "rdhx" | "dlc" | "tank";
/** How a hall's containments are built: sealed cold aisles, sealed hot aisles, some of each, or none (older halls). */
export type HallContainment = "cold" | "hot" | "partial" | "none";
/** How one pod's aisle is closed: cold or hot sealed, or open (no containment around it). */
export type PodAisle = "cold" | "hot" | "open";

export const CONTAINMENT_LABELS: Readonly<Record<HallContainment, string>> = {
  cold: "냉복도 밀폐",
  hot: "열복도 밀폐",
  partial: "일부만 밀폐",
  none: "컨테인먼트 없음",
};

export const HALL_MODE_LABELS: Readonly<Record<HallMode, string>> = {
  air: "공랭",
  hybrid: "공랭+수랭",
  dlc: "직접수랭",
  immersion: "액침",
};

export interface PodPlan {
  readonly kind: PodKind;
  readonly rackModel: string;
  /** Racks per row; a pod is two rows facing each other. */
  readonly perRow: number;
  readonly family: Family;
  readonly aisle: PodAisle;
  /** Racks of this pod are light racks (REQ-049): servers counted, not built one by one. */
  readonly light: boolean;
}

export interface HallPlan {
  readonly id: string;
  readonly name: string;
  readonly building: number;
  readonly floorId: string;
  readonly letter: string;
  readonly mode: HallMode;
  readonly containment: HallContainment;
  /** Width over depth the hall's pods are arranged to: long and thin halls and squarish ones both exist. */
  readonly aspect: number;
  readonly pods: readonly PodPlan[];
}

export interface BuildingPlan {
  readonly index: number;
  readonly id: string;
  readonly halls: readonly HallPlan[];
}

export interface CampusPlan {
  readonly buildings: readonly BuildingPlan[];
  readonly racks: number;
  /** Racks built server by server. */
  readonly detailedRacks: number;
}

const HALL_LETTERS = "ABCD";
/** Hall size relative to the typical one: halls are never all the same size. */
const SIZE_FACTORS = [0.5, 0.75, 1, 1, 1.5, 2];
const MODE_ROTATION: readonly HallMode[] = ["air", "hybrid", "dlc", "immersion"];

function hallMode(
  profile: CampusProfile,
  building: number,
  hall: number,
  halls: number,
  buildings: number,
): HallMode {
  if (profile === "air") return "air";
  if (profile === "hybrid") return "hybrid";
  if (profile === "ai-liquid")
    return building === buildings && hall === halls - 1 && halls > 1 ? "immersion" : "dlc";
  return MODE_ROTATION[(building - 1 + hall) % MODE_ROTATION.length] as HallMode;
}

/** Pod kinds a hall of this mode is made of, with how likely each is. */
const POD_MIX: Readonly<Record<HallMode, ReadonlyArray<readonly [PodKind, number]>>> = {
  air: [["air", 1]],
  hybrid: [
    ["air", 0.55],
    ["rdhx", 0.15],
    ["dlc", 0.3],
  ],
  dlc: [
    ["dlc", 0.88],
    ["air", 0.12],
  ],
  immersion: [
    ["tank", 0.85],
    ["air", 0.15],
  ],
};

function pickKind(rng: SeededRng, mode: HallMode): PodKind {
  return pickWeighted(rng, POD_MIX[mode]);
}

/** Containment by hall mode: old air halls often have none; liquid halls seal the hot aisle. */
const CONTAINMENT_MIX: Readonly<
  Record<HallMode, ReadonlyArray<readonly [HallContainment, number]>>
> = {
  air: [
    ["none", 0.25],
    ["partial", 0.2],
    ["cold", 0.35],
    ["hot", 0.2],
  ],
  hybrid: [
    ["cold", 0.4],
    ["hot", 0.4],
    ["partial", 0.2],
  ],
  dlc: [
    ["hot", 0.5],
    ["cold", 0.3],
    ["partial", 0.2],
  ],
  immersion: [
    ["cold", 0.5],
    ["none", 0.5],
  ],
};

const ROW_LENGTHS = [4, 6, 8, 10, 12];
const ASPECTS = [0.9, 1.3, 1.6, 2.4, 3.2];

function pickWeighted<T>(rng: SeededRng, items: ReadonlyArray<readonly [T, number]>): T {
  let roll = rng.random();
  for (const [item, weight] of items) {
    roll -= weight;
    if (roll <= 0) return item;
  }
  return (items.at(-1) as readonly [T, number])[0];
}

/** The aisle a pod gets: all pods of a sealed hall, every other pod of a partly sealed one, none of an open one. */
function podAisle(containment: HallContainment, index: number): PodAisle {
  if (containment === "none") return "open";
  if (containment === "partial") return index % 2 === 0 ? "cold" : "open";
  return containment;
}

interface PodShapeChoice {
  readonly kind: PodKind;
  readonly family: Family;
  readonly airRow: number;
  readonly aisle: PodAisle;
  readonly light: boolean;
}

/**
 * Whether the pod at `index` of a hall is a light one. The pods built in detail are spread evenly
 * along the hall, and the first one always is, so a hall never lacks equipment to act on.
 */
export function isLightPod(index: number, detail: number): boolean {
  if (index === 0 || detail >= 1) return false;
  return Math.floor((index + 1) * detail) === Math.floor(index * detail);
}

function podPlan(rng: SeededRng, c: PodShapeChoice): PodPlan {
  const { kind, family, aisle, light } = c;
  if (kind === "air")
    return { kind, rackModel: family.rack, perRow: c.airRow, family, aisle, light };
  if (kind === "rdhx") return { kind, rackModel: RDHX_RACK, perRow: 5, family, aisle, light };
  if (kind === "dlc")
    return { kind, rackModel: rng.pick(DLC_RACKS), perRow: 4, family, aisle, light };
  return { kind, rackModel: rng.pick(TANKS), perRow: 4, family, aisle: "open", light };
}

type HallBase = Omit<HallPlan, "pods" | "containment" | "aspect">;

function planHall(spec: CampusSpec, rng: SeededRng, hall: HallBase): HallPlan {
  const count = Math.max(1, Math.round(spec.podsPerHall * rng.pick(SIZE_FACTORS)));
  const single = rng.pick(FAMILIES);
  const containment = pickWeighted(rng, CONTAINMENT_MIX[hall.mode]);
  const airRow = rng.pick(ROW_LENGTHS);
  const pods = Array.from({ length: count }, (_, i) =>
    podPlan(rng, {
      kind: pickKind(rng, hall.mode),
      family: spec.vendors === "single" ? single : rng.pick(FAMILIES),
      airRow,
      aisle: podAisle(containment, i),
      light: isLightPod(i, spec.detail),
    }),
  );
  // A hall counts as having no containment when none of its pods ended up sealed (tanks never are).
  const sealed = pods.some((p) => p.aisle !== "open");
  return { ...hall, containment: sealed ? containment : "none", aspect: rng.pick(ASPECTS), pods };
}

export function planCampus(spec: CampusSpec, code: string, rng: SeededRng): CampusPlan {
  let racks = 0;
  let detailedRacks = 0;
  const buildings: BuildingPlan[] = [];
  for (let b = 1; b <= spec.buildings; b++) {
    const id = `${code}-dc${b}`;
    const halls: HallPlan[] = [];
    for (let level = 2; level <= spec.floors + 1; level++)
      for (let h = 0; h < spec.hallsPerFloor; h++) {
        const letter = HALL_LETTERS[h] as string;
        const index = (level - 2) * spec.hallsPerFloor + h;
        const total = spec.floors * spec.hallsPerFloor;
        const mode = hallMode(spec.profile, b, index, total, spec.buildings);
        const plan = planHall(spec, rng.fork(`${id}-${level}-${letter}`), {
          id: `${id}-f${level}-${letter.toLowerCase()}`,
          name: `${level}F-${letter} 데이터 홀`,
          building: b,
          floorId: `${id}-f${level}`,
          letter,
          mode,
        });
        racks += plan.pods.reduce((n, p) => n + 2 * p.perRow, 0);
        detailedRacks += plan.pods.reduce((n, p) => n + (p.light ? 0 : 2 * p.perRow), 0);
        halls.push(plan);
      }
    buildings.push({ index: b, id, halls });
  }
  return { buildings, racks, detailedRacks };
}
