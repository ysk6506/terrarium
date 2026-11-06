/**
 * Which template cards cannot be solved with the tools a real operations team has (REQ-088, ADR-0091 item 4). The
 * answer comes from playing the template in the world with those tools (`commonReach`), which takes a short session
 * each, so a screen asks for one card at a time and only for a world small enough to play in the page.
 */
import type { ScenarioTemplate } from "@terrarium/core/scenario";
import { commonReach } from "@terrarium/core/session";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";

/** A bigger world is not played in the page; its cards say nothing about the tools. */
export const REACH_MAX_ENTITIES = 600;

export const canProbe = (blueprint: Blueprint): boolean =>
  blueprint.entities.length <= REACH_MAX_ENTITIES;

/** `false` when the common tools never get to the answer of this template in this world; `undefined` when not known. */
export function reachesAnswer(
  blueprint: Blueprint,
  template: ScenarioTemplate,
): boolean | undefined {
  if (!canProbe(blueprint)) return undefined;
  const index = new BlueprintIndex(blueprint);
  if (template.unavailable(index)) return undefined;
  const scenario = template.build(index, blueprint.id);
  return commonReach({ blueprint, scenario })?.reached;
}
