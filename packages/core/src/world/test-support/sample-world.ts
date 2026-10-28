/** The sample hall as a live World with the built-in catalog, for units that may not import catalog. */
import { Catalog } from "@terrarium/core/catalog";
import type { Blueprint } from "../blueprint";
import { World } from "../world";
import { sampleBlueprint } from "./sample";

export function sampleWorld(blueprint: Blueprint = sampleBlueprint()): World {
  return World.fromBlueprint(blueprint, new Catalog());
}
