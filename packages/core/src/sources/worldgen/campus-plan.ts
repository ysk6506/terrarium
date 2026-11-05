/**
 * Deciding what a campus holds before anything is built: which halls each building has, how big each
 * is, how it is cooled, and which kinds of pod fill it. Pure: the same spec gives the same plan.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { SeededRng } from "@terrarium/core/kernel";
import type { Rect } from "@terrarium/core/spatial";
import { DLC_RACKS, FAMILIES, type Family, RDHX_RACK, TANKS } from "./campus-families";
import { fitPods } from "./campus-fit";
import { planLockedCentre } from "./campus-locked-plan";
import type { CampusProfile, CampusSpec } from "./campus-spec";
import type { SiteSlot } from "./sites";

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
  /** A hall on a floor plan (REQ-076): the room it stands in, and the columns of pods its width takes. */
  readonly room?: { readonly rect: Rect; readonly columns: number };
}

export interface BuildingPlan {
  /** Number among buildings of its kind: DC1, DC2, …, FAB1, FAB2, … */
  readonly index: number;
  readonly id: string;
  /** A data-centre building, a fab, or a research (DSR) tower. */
  readonly kind: "dc" | "fab" | "lab";
  readonly halls: readonly HallPlan[];
  /** Floors above the ground floor that this building has, lowest first (a fab has one more than its halls need). */
  readonly levels: readonly number[];
  /** The cleanroom bay of each fab floor, metres; fabs only. */
  readonly bay?: { readonly w: number; readonly d: number };
  /** The bay of the top floor, which has no server rooms and no plant beside it, so it fills the building; fabs only. */
  readonly topBay?: { readonly w: number; readonly d: number };
  /** Where a map shows this building standing on the site, when it does. */
  readonly slot?: SiteSlot;
  /** A building with the size of a real one (REQ-076): its fixed floor, and where every room stands on it. */
  readonly fixed?: {
    readonly size: { readonly w: number; readonly d: number };
    readonly rooms: Readonly<Record<string, Rect>>;
  };
}

/** Where a site's buildings stand on its map, in the order the campus fills them. */
export interface CampusSlots {
  readonly dcs: readonly SiteSlot[];
  readonly fabs: readonly SiteSlot[];
  readonly labs?: readonly SiteSlot[];
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
/** The server rooms inside a fab or a research tower are small next to a data-centre hall, yet hold a few dozen containments. */
const FAB_SIZE_FACTORS = [0.4, 0.55, 0.7, 0.85];
/** Racks in one row of such a room's containment: ten to twenty racks to a containment. */
const ROOM_ROW_LENGTHS = [5, 6, 7, 8, 9, 10];
/** Racks in one row of a pod in a hall of a real building: long rows, as big halls have, waste the least floor. */
const LOCKED_ROW_LENGTHS = [12];
/** The floor a fab keeps its server rooms on differs from fab to fab. */
const FAB_ROOM_FLOORS = [2, 3, 4];
/** Floors above the ground of a DSR tower (the 2014 article gives 27). */
const LAB_FLOORS = 27;
/**
 * The floors that hold server rooms in each DSR tower, as the owner described them: tower C has two
 * on 3F and tower B one on 5F. Tower A's single room on 4F is a guess.
 */
const LAB_ROOM_FLOORS: ReadonlyArray<readonly number[]> = [[4], [5], [3, 3]];
const LAB_NAMES = "ABC";
/** Cleanroom bays of a fab with no place on a map: long and wide floors, metres. */
const BAY_WIDTHS = [140, 170, 200, 240];
const BAY_DEPTHS = [60, 70, 80];
/** Walls and the strip beside the bay take this much of a fab's footprint, metres. */
const FAB_SHELL_M = 12;
/** A fab drawn from a map keeps to this size range, metres. */
const FAB_LIMITS = { minW: 90, maxW: 700, minD: 60, maxD: 200 } as const;
/** The floors below the top leave this share of the depth to the bay; server rooms stand in the rest. */
const LOWER_BAY_SHARE = 0.62;
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

/** A hall that is given its room: the catalogue to measure pods with, and the room's rectangle. */
interface HallRoom {
  readonly catalog: Catalog;
  readonly rect: Rect;
}

/** Fewest square metres one pod can take, which bounds how many pods a room may be asked to hold. */
const SMALLEST_POD_M2 = 20;

function planHall(
  spec: CampusSpec,
  rng: SeededRng,
  hall: HallBase,
  shape: { factors?: readonly number[]; rows?: readonly number[]; room?: HallRoom } = {},
): HallPlan {
  const { factors = SIZE_FACTORS, rows = ROW_LENGTHS, room } = shape;
  // A hall in a room is asked for the typical number of pods and keeps as many as its room takes (a smaller ask gives a smaller hall).
  const count = room
    ? Math.min(
        Math.ceil((room.rect.w * room.rect.d) / SMALLEST_POD_M2),
        Math.max(1, spec.podsPerHall),
      )
    : Math.max(1, Math.round(spec.podsPerHall * rng.pick(factors)));
  const single = rng.pick(FAMILIES);
  const containment = pickWeighted(rng, CONTAINMENT_MIX[hall.mode]);
  const airRow = rng.pick(rows);
  const pods = Array.from({ length: count }, (_, i) =>
    podPlan(rng, {
      kind: pickKind(rng, hall.mode),
      family: spec.vendors === "single" ? single : rng.pick(FAMILIES),
      airRow,
      aisle: podAisle(containment, i),
      light: isLightPod(i, spec.detail),
    }),
  );
  // A hall in a room keeps the pods the room takes.
  const fitted = room ? fitPods(room.catalog, pods, room.rect) : undefined;
  const kept = fitted ? pods.slice(0, fitted.pods) : pods;
  // A hall counts as having no containment when none of its pods ended up sealed (tanks never are).
  const sealed = kept.some((p) => p.aisle !== "open");
  return {
    ...hall,
    containment: sealed ? containment : "none",
    aspect: rng.pick(ASPECTS),
    pods: kept,
    ...(room && fitted ? { room: { rect: room.rect, columns: fitted.columns } } : {}),
  };
}

/** The cooling of a fab's server rooms: older rooms are mostly air, one may carry liquid. */
function fabHallMode(profile: CampusProfile, hall: number): HallMode {
  if (profile === "air") return "air";
  if (profile === "hybrid") return "hybrid";
  if (profile === "ai-liquid") return hall === 0 ? "dlc" : "air";
  return hall % 2 === 0 ? "air" : "hybrid";
}

interface Tally {
  racks: number;
  detailedRacks: number;
}

function count(tally: Tally, plan: HallPlan): void {
  tally.racks += plan.pods.reduce((n, p) => n + 2 * p.perRow, 0);
  tally.detailedRacks += plan.pods.reduce((n, p) => n + (p.light ? 0 : 2 * p.perRow), 0);
}

/** What planning a data-centre building needs besides the spec: the running tally, the map's place and the catalogue. */
interface CentreTools {
  readonly tally: Tally;
  readonly slot?: SiteSlot;
  readonly catalog?: Catalog;
}

function planDataCentre(
  spec: CampusSpec,
  code: string,
  rng: SeededRng,
  b: number,
  tools: CentreTools,
): BuildingPlan {
  const { tally, slot, catalog } = tools;
  const id = `${code}-dc${b}`;
  if (slot && catalog) {
    const centre = planLockedCentre({
      spec,
      id,
      index: b,
      size: { w: slot.w, d: slot.d },
      rng,
      makeHall: (hallRng, base, rect) =>
        planHall(spec, hallRng, base, { room: { catalog, rect }, rows: LOCKED_ROW_LENGTHS }),
    });
    for (const hall of centre.halls) count(tally, hall);
    return { ...centre, slot };
  }
  const halls: HallPlan[] = [];
  for (let level = 2; level <= spec.floors + 1; level++)
    for (let h = 0; h < spec.hallsPerFloor; h++) {
      const letter = HALL_LETTERS[h] as string;
      const index = (level - 2) * spec.hallsPerFloor + h;
      const total = spec.floors * spec.hallsPerFloor;
      const plan = planHall(spec, rng.fork(`${id}-${level}-${letter}`), {
        id: `${id}-f${level}-${letter.toLowerCase()}`,
        name: `${level}F-${letter} 서버룸`,
        building: b,
        floorId: `${id}-f${level}`,
        letter,
        mode: hallMode(spec.profile, b, index, total, spec.buildings),
      });
      count(tally, plan);
      halls.push(plan);
    }
  const levels = Array.from({ length: spec.floors }, (_, i) => i + 2);
  return { index: b, id, kind: "dc", halls, levels, ...(slot ? { slot } : {}) };
}

/** A fab: server rooms two to a floor, a cleanroom bay on every floor above the ground, one more floor of bay on top. */
function planFab(
  spec: CampusSpec,
  code: string,
  rng: SeededRng,
  f: number,
  tally: Tally,
  place?: SiteSlot,
): BuildingPlan {
  const id = `${code}-fab${f}`;
  const slot = spec.buildings + f;
  const halls: HallPlan[] = [];
  const first = rng.fork(`${id}-floor`).pick(FAB_ROOM_FLOORS);
  for (let h = 0; h < spec.hallsPerFab; h++) {
    const level = first + Math.floor(h / 2);
    const letter = HALL_LETTERS[h % 2] as string;
    const plan = planHall(
      spec,
      rng.fork(`${id}-${level}-${letter}`),
      {
        id: `${id}-f${level}-${letter.toLowerCase()}`,
        name: `${level}F-${letter} 서버룸`,
        building: slot,
        floorId: `${id}-f${level}`,
        letter,
        mode: fabHallMode(spec.profile, h),
      },
      { factors: FAB_SIZE_FACTORS, rows: ROOM_ROW_LENGTHS },
    );
    count(tally, plan);
    halls.push(plan);
  }
  const top = first + Math.ceil(spec.hallsPerFab / 2);
  const levels = Array.from({ length: top - 1 }, (_, i) => i + 2);
  const { bay, topBay } = fabBays(rng.fork(`${id}-bay`), place);
  return {
    index: f,
    id,
    kind: "fab",
    halls,
    levels,
    bay,
    topBay,
    ...(place ? { slot: place } : {}),
  };
}

/** A DSR tower: a tall office and lab tower with a few small server rooms on floors of their own. */
function planLab(
  spec: CampusSpec,
  code: string,
  rng: SeededRng,
  l: number,
  tally: Tally,
  place?: SiteSlot,
): BuildingPlan {
  const id = `${code}-lab${l}`;
  const building = spec.buildings + spec.fabs + l;
  const floors = LAB_ROOM_FLOORS[(l - 1) % LAB_ROOM_FLOORS.length] as readonly number[];
  const halls = floors.map((level, h) => {
    const letter = HALL_LETTERS[floors.slice(0, h).filter((x) => x === level).length] as string;
    const plan = planHall(
      spec,
      rng.fork(`${id}-${level}-${letter}`),
      {
        id: `${id}-f${level}-${letter.toLowerCase()}`,
        name: `${level}F-${letter} 서버룸`,
        building,
        floorId: `${id}-f${level}`,
        letter,
        mode: fabHallMode(spec.profile, h),
      },
      { factors: FAB_SIZE_FACTORS, rows: ROOM_ROW_LENGTHS },
    );
    count(tally, plan);
    return plan;
  });
  const levels = Array.from({ length: LAB_FLOORS - 1 }, (_, i) => i + 2);
  return { index: l, id, kind: "lab", halls, levels, ...(place ? { slot: place } : {}) };
}

/** The letter a research tower goes by: DSR A, B and C. */
export const labLetter = (index: number): string =>
  LAB_NAMES[(index - 1) % LAB_NAMES.length] as string;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The cleanroom bays of a fab. One drawn from a map is as big as the blue roof the map shows (within
 * limits): the top floor takes the whole depth, the lower floors leave the rest for server rooms.
 */
function fabBays(shape: SeededRng, slot?: SiteSlot) {
  if (!slot) {
    const bay = { w: shape.pick(BAY_WIDTHS), d: shape.pick(BAY_DEPTHS) };
    return { bay, topBay: { w: bay.w, d: Math.round(bay.d * 1.6) } };
  }
  const w = clamp(slot.w - FAB_SHELL_M, FAB_LIMITS.minW, FAB_LIMITS.maxW);
  const d = clamp(slot.d - FAB_SHELL_M, FAB_LIMITS.minD, FAB_LIMITS.maxD);
  return { bay: { w, d: Math.round(d * LOWER_BAY_SHARE) }, topBay: { w, d } };
}

export function planCampus(
  spec: CampusSpec,
  code: string,
  rng: SeededRng,
  slots: CampusSlots = { dcs: [], fabs: [] },
  catalog?: Catalog,
): CampusPlan {
  const tally: Tally = { racks: 0, detailedRacks: 0 };
  const buildings: BuildingPlan[] = [];
  for (let b = 1; b <= spec.buildings; b++) {
    const slot = slots.dcs[b - 1];
    buildings.push(
      planDataCentre(spec, code, rng, b, {
        tally,
        ...(slot ? { slot } : {}),
        ...(catalog ? { catalog } : {}),
      }),
    );
  }
  for (let f = 1; f <= spec.fabs; f++)
    buildings.push(planFab(spec, code, rng, f, tally, slots.fabs[f - 1]));
  for (let l = 1; l <= spec.labs; l++)
    buildings.push(planLab(spec, code, rng, l, tally, slots.labs?.[l - 1]));
  return { buildings, ...tally };
}
