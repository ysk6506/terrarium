/** The crew of a room, loaded on its own when the camera first goes into a room (REQ-074): the home screen does not carry it. */
import { hallCrew, world3d } from "../../logic";
import { buildCrewLayer } from "./crew-layer";
import type { CrewKit } from "./crew-stage";

export const kit: CrewKit = { build: buildCrewLayer, lineFor: world3d.lineFor };
export const { crewOf, troubleOf } = hallCrew;
