/**
 * What a data-centre building of real size holds (REQ-076, ADR-0081): eleven storeys of server rooms on the
 * floor plan, each hall sized by the room it stands in. The building's floor is fixed (the size a map gives it),
 * so the pods of a hall are as many as its room takes, and the plan lists where every room stands.
 */
import type { SeededRng } from "@terrarium/core/kernel";
import type { Rect } from "@terrarium/core/spatial";
import { groundFloorPlan, hallsOnFloor, type Size, serverFloorPlan } from "./campus-floor";
import type { BuildingPlan, HallMode, HallPlan } from "./campus-plan";
import type { CampusProfile, CampusSpec } from "./campus-spec";

/** Air-cooled halls with a rear-door and liquid hall now and then: the mix a 108 MW HPC centre of air-cooled racks has. */
const MODE_ROTATION: readonly HallMode[] = ["air", "air", "air", "air", "hybrid"];

function modeOf(profile: CampusProfile, index: number): HallMode {
  if (profile === "air") return "air";
  if (profile === "hybrid") return "hybrid";
  if (profile === "ai-liquid") return "dlc";
  return MODE_ROTATION[index % MODE_ROTATION.length] as HallMode;
}

const LETTERS = "ABCD";

/** Plans one hall: its base (ids, names, mode), the room it stands in. */
export type MakeHall = (
  rng: SeededRng,
  base: Pick<HallPlan, "id" | "name" | "building" | "floorId" | "letter" | "mode">,
  room: Rect,
) => HallPlan;

export interface LockedInput {
  readonly spec: CampusSpec;
  readonly id: string;
  readonly index: number;
  readonly size: Size;
  readonly rng: SeededRng;
  readonly makeHall: MakeHall;
}

/** The rooms of a locked data centre by id, in the building's frame. */
export function lockedRooms(
  id: string,
  levels: readonly number[],
  size: Size,
): Record<string, Rect> {
  const ground = groundFloorPlan();
  const rooms: Record<string, Rect> = {
    [`${id}-f1-lobby`]: ground.lobby,
    [`${id}-f1-sto`]: ground.storage,
    [`${id}-f1-noc`]: ground.noc,
    [`${id}-f1-mmr`]: ground.mmr,
  };
  for (const level of levels) {
    const plan = serverFloorPlan(size, level);
    rooms[`${id}-f${level}-ele`] = plan.electrical;
    rooms[`${id}-f${level}-mech`] = plan.mechanical;
    rooms[`${id}-f${level}-sto`] = plan.storage;
    plan.halls.forEach((r, h) => {
      rooms[`${id}-f${level}-${(LETTERS[h] as string).toLowerCase()}`] = r;
    });
  }
  return rooms;
}

export function planLockedCentre(input: LockedInput): Omit<BuildingPlan, "slot"> {
  const { spec, id, index, size, rng, makeHall } = input;
  const levels = Array.from({ length: spec.floors }, (_, i) => i + 2);
  const rooms = lockedRooms(id, levels, size);
  const halls: HallPlan[] = [];
  for (const level of levels) {
    const count = hallsOnFloor(level);
    for (let h = 0; h < count; h++) {
      const letter = LETTERS[h] as string;
      const hallId = `${id}-f${level}-${letter.toLowerCase()}`;
      halls.push(
        makeHall(
          rng.fork(`${id}-${level}-${letter}`),
          {
            id: hallId,
            name: `${level}F-${letter} 서버룸`,
            building: index,
            floorId: `${id}-f${level}`,
            letter,
            mode: modeOf(spec.profile, halls.length),
          },
          rooms[hallId] as Rect,
        ),
      );
    }
  }
  return { index, id, kind: "dc", halls, levels, fixed: { size, rooms } };
}
