/**
 * The built-in worlds the physics laws and the physics profile are tried on (REQ-113): the same twelve as
 * `physics-golden.test.ts` (rooms, halls, a campus with a plant, light racks and liquid halls, SDN, containers, the application
 * layer, the site and DR labs, the accelerator, power and cooling ladders).
 */
import {
  DEFAULT_CAMPUS,
  DEFAULT_WORLDGEN,
  generateCampus,
  generateWorld,
} from "@terrarium/core/sources/worldgen";
import type { Blueprint } from "@terrarium/core/world";
import { appLab } from "../../../packages/core/src/world/test-support/app-lab";
import { k8sLab } from "../../../packages/core/src/world/test-support/k8s-lab";
import { sampleBlueprint } from "../../../packages/core/src/world/test-support/sample";
import { sdnLab } from "../../../packages/core/src/world/test-support/sdn-lab";
import { siteBlueprint } from "../site-support";
import { accelLab, coolingLab, powerLab } from "./ladder-labs";

export const PHYSICS_WORLDS: ReadonlyArray<readonly [string, () => Blueprint]> = [
  ["sample room", () => sampleBlueprint()],
  [
    "generated hall",
    () =>
      generateWorld({ ...DEFAULT_WORLDGEN, rows: 2, racksPerRow: 4, site: "hwaseong", seed: 3 })
        .blueprint,
  ],
  [
    "campus with plant",
    () =>
      generateCampus({
        ...DEFAULT_CAMPUS,
        site: "cheonan",
        seed: 1,
        buildings: 1,
        fabs: 0,
        podsPerHall: 3,
      }).blueprint,
  ],
  [
    "light racks and liquid halls",
    () =>
      generateCampus({
        ...DEFAULT_CAMPUS,
        site: "pyeongtaek",
        seed: 3,
        buildings: 2,
        hallsPerFloor: 2,
        podsPerHall: 2,
        detail: 0.3,
      }).blueprint,
  ],
  ["sdn overlay", () => sdnLab({ cloudNative: true })],
  ["container cluster", () => k8sLab({ second: true })],
  ["app layer lab", () => appLab({ level: "multiregion" })],
  ["site dr lab", () => siteBlueprint("warm")],
  ["distributed db lab", () => siteBlueprint("db")],
  ["gpu training lab", () => accelLab("gpu-training-cluster", { network: "net-leaf-spine" })],
  ["power ladder lab", () => powerLab("pwr-substation")],
  ["cooling ladder lab", () => coolingLab("cool-immersion")],
];
