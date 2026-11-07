/**
 * A site without power (REQ-106, `site_power_loss`): the servers, switches, storage arrays and light racks that stand in the
 * site's building lose their power after the power chain has been worked out, so the existing rules (hosts that are off,
 * VMs that stop, services that stop) follow by themselves. The site's own chain of feeds is not simulated further.
 */
import { buildingOf, type StateOf, type World } from "@terrarium/core/world";
import type { SupplyResolver } from "./power-supply";

/** The buildings whose power is cut by a `site_power_loss` fault. */
function darkBuildings(world: World): ReadonlySet<string> | undefined {
  const faults = world.faults().filter((f) => f.type === "site_power_loss");
  if (faults.length === 0) return undefined;
  const dark = new Set<string>();
  for (const f of faults) {
    const b = world.index.find(f.target)?.props.building;
    if (typeof b === "string") dark.add(b);
  }
  return dark;
}

const KINDS = new Set(["server", "switch", "storage", "rack"]);

/** Cut the power of everything in a dark building. */
export function cutDarkSites(world: World, supply: SupplyResolver): void {
  const dark = darkBuildings(world);
  if (!dark) return;
  const { plan, states } = supply;
  for (const i of plan.active) {
    const ent = plan.ents[i];
    if (!ent || !KINDS.has(ent.kind)) continue;
    const b = buildingOf(world.index, ent.id);
    if (!b || !dark.has(b)) continue;
    const s = states[i] as
      | StateOf<"server">
      | StateOf<"switch">
      | StateOf<"storage">
      | StateOf<"rack">;
    s.powered = false;
    s.powerW = 0;
  }
}
