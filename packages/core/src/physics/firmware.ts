/**
 * Firmware updates in time (ADR-0101): a server whose staging is over goes down for its reboot, and when the reboot
 * is over the update either takes or fails. Each step is a world event so scoring can read it; a rack remembers the
 * most servers it had rebooting at once.
 */
import type { World, WorldEvent } from "@terrarium/core/world";

const CAUSE = "physics";

/** Move the running updates on to this moment; returns the events. */
export function advanceFirmware(world: World): WorldEvent[] {
  const running = world.updatingServers();
  if (running.size === 0) return [];
  const events: WorldEvent[] = [];
  const now = world.time();
  for (const id of [...running].sort()) {
    const server = world.stateAs(id, "server");
    const job = server.fw;
    if (!job) continue;
    if (!server.rebooting && now >= job.rebootAt) {
      events.push(world.apply({ type: "firmware.reboot", target: id }, CAUSE));
      notePeak(world, id);
    }
    if (now >= job.doneAt) {
      const type = job.fails ? "firmware.fail" : "firmware.finish";
      events.push(world.apply({ type, target: id }, CAUSE));
    }
  }
  return events;
}

/** The rack of a server that has just gone down: how many of its servers are down for firmware now. */
function notePeak(world: World, serverId: string): void {
  const rack = world.index.enclosing(serverId, "rack");
  if (!rack) return;
  const down = world.index
    .childrenOf(rack.id, "server")
    .filter((s) => world.stateAs(s.id, "server").rebooting).length;
  const state = world.stateAs(rack.id, "rack");
  if (down > state.rebootPeak) world.patch(rack.id, "rack", { rebootPeak: down });
}
