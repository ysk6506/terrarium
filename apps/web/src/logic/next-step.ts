/**
 * "다음 할 일" 칩 (REQ-077, ADR-0083): what to do next is not a guide to read but a function of the world. The chip
 * walks the same road every time: no land, no building, no server room, an empty one, not run yet, done. It says the
 * next thing in one line and knows where that thing is, so pressing it takes the person there.
 */
import { type BlueprintIndex, type Entity, roomPurposeOf } from "@terrarium/core/world";
import type { Tool } from "./builder/gesture";
import { floorsOf, type Level, levelOf } from "./builder/levels";

export type StepId = "land" | "building" | "room" | "fill" | "run" | "done";

/** Where a step is: the place to go to, a thing to hold or pick there, or an act to do. */
export type Aim =
  | {
      readonly kind: "go";
      readonly level: Level;
      readonly tool?: Tool;
      readonly select?: readonly string[];
    }
  | { readonly kind: "run" }
  | { readonly kind: "scenarios" };

export interface NextStep {
  readonly id: StepId;
  /** The chip's words, "다음: 서버룸 채우기". */
  readonly label: string;
  readonly aim: Aim;
}

const SITE: Level = { kind: "site" };

const serverRooms = (index: BlueprintIndex): Entity[] =>
  index.ofKind("room").filter((r) => roomPurposeOf(r) === "data_hall");

/** Whether anything stands in the room that is a rack. */
export const hasRacks = (index: BlueprintIndex, roomId: string): boolean =>
  index.descendants(roomId).some((e) => e.kind === "rack");

/** The floor a first server room would be made on: the first building's lowest floor. */
function firstFloor(index: BlueprintIndex): Level {
  const building = index.ofKind("building")[0];
  const floor = building ? floorsOf(index, building.id)[0] : undefined;
  return floor ? { kind: "floor", id: floor.id } : SITE;
}

/**
 * The next thing to do in a world. `ran` is whether the person has run it yet ("시운전" this visit), which is
 * the only thing about a visit the world itself does not hold.
 */
export function nextStep(index: BlueprintIndex, ran: boolean): NextStep {
  if (index.ofKind("site").length === 0)
    return { id: "land", label: "다음: 땅 마련하기", aim: { kind: "go", level: SITE } };
  if (index.ofKind("building").length === 0)
    return {
      id: "building",
      label: "다음: 건물 올리기",
      aim: { kind: "go", level: SITE, tool: { kind: "building", purpose: "data_center" } },
    };
  const rooms = serverRooms(index);
  if (rooms.length === 0)
    return {
      id: "room",
      label: "다음: 서버룸 만들기",
      aim: {
        kind: "go",
        level: firstFloor(index),
        tool: { kind: "room", purpose: "data_hall" },
      },
    };
  const bare = rooms.find((r) => !hasRacks(index, r.id));
  if (bare)
    return {
      id: "fill",
      label: "다음: 서버룸 채우기",
      aim: { kind: "go", level: levelOf(index, bare.id), select: [bare.id] },
    };
  if (!ran) return { id: "run", label: "다음: 시운전", aim: { kind: "run" } };
  return { id: "done", label: "다음: 시나리오 만들기", aim: { kind: "scenarios" } };
}

// ── 둘러보기: the same chip, pointing at five places in turn ──────────────────────────────────

export interface TourStep {
  readonly label: string;
  readonly aim: (index: BlueprintIndex) => Aim;
}

/** The tour: the land, the building, the server room, filling it, running it. */
export const TOUR_STEPS: readonly TourStep[] = [
  { label: "사업장 둘러보기", aim: () => ({ kind: "go", level: SITE }) },
  { label: "건물 안으로 들어가기", aim: (index) => ({ kind: "go", level: firstFloor(index) }) },
  {
    label: "서버룸으로 들어가기",
    aim: (index) => {
      const room = serverRooms(index)[0];
      return room
        ? { kind: "go", level: levelOf(index, room.id) }
        : { kind: "go", level: firstFloor(index) };
    },
  },
  {
    label: "서버룸 채우기",
    aim: (index) => {
      const room = serverRooms(index).find((r) => !hasRacks(index, r.id)) ?? serverRooms(index)[0];
      return room
        ? { kind: "go", level: levelOf(index, room.id), select: [room.id] }
        : { kind: "go", level: firstFloor(index) };
    },
  },
  { label: "시운전", aim: () => ({ kind: "run" }) },
];

/** The chip's words in the tour: "둘러보기 2/5 · 건물 안으로 들어가기". */
export const tourLabel = (step: number): string =>
  `둘러보기 ${step + 1}/${TOUR_STEPS.length} · ${TOUR_STEPS[step]?.label ?? ""}`;
