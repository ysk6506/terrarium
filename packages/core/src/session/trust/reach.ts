/**
 * Whether a change reaches a service that is well now (the approval rule `service_reach`, REQ-124, ADR-0203). The reach
 * of the equipment is the one `get_impact` answers with: `dependents` is the very function that tool calls, so the set
 * of equipment the rule judges and the set the agent sees are one. Nothing new is worked out about it.
 *
 * One thing is added on top, and it is the known gap between the two: `get_impact` never lists a service (a service
 * stands on its host through `service_on`, which `dependents` does not follow), so the services are found from the
 * equipment of that set with the helper the operating-system layer already uses (`servicesOnHost`, by the service's own
 * state, so a failover is followed). It is kept in this one function: when `get_impact` learns to list services, this
 * is the only place that changes (TD-0016).
 */
import { dependents, type ToolContext } from "@terrarium/core/tools";
import { servicesOnHost } from "@terrarium/core/world";

/** `touches`: a healthy service is in the reach. `clear`: none is. `unknown`: the target is not equipment of this world. */
export type Reach = "touches" | "clear" | "unknown";

type Ctx = Pick<ToolContext, "world">;

/** The services standing on this equipment now, or this equipment itself when it is a service. */
function servicesAt(ctx: Ctx, id: string): string[] {
  if (ctx.world.index.find(id)?.kind === "service") return [id];
  return servicesOnHost(ctx.world, id).map((s) => s.id);
}

/** The reach of a change on `target`, judged against the services as they are now. */
export function serviceReach(ctx: Ctx, target: string): Reach {
  if (target === "" || !ctx.world.index.find(target)) return "unknown";
  const equipment = [target, ...dependents(ctx, target)];
  const services = new Set(equipment.flatMap((id) => servicesAt(ctx, id)));
  const well = [...services].some((id) => ctx.world.stateAs(id, "service").status === "healthy");
  return well ? "touches" : "clear";
}
