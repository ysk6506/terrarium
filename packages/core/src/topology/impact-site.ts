/**
 * How a lost site spreads (REQ-106, ADR-0129): a site is not equipment other equipment is cabled to, it is the place the
 * nodes of a service stand in. A service leans on the sites its nodes are in; when a site is gone, a service with half or
 * more of its nodes there is in the range, and one with all of them there is down.
 */

import type { BlueprintIndex } from "@terrarium/core/world";
import { drSites, siteOf } from "@terrarium/core/world";
import type { TopologySource } from "./types";

const cache = new WeakMap<BlueprintIndex, Map<string, ReadonlyMap<string, number>>>();

/** Per service, how many of its nodes stand in each site (worked out once per blueprint). */
function nodesBySite(index: BlueprintIndex): Map<string, ReadonlyMap<string, number>> {
  let known = cache.get(index);
  if (known) return known;
  known = new Map();
  if (drSites(index).length > 0)
    for (const svc of index.ofKind("service")) {
      const counts = new Map<string, number>();
      for (const l of index.outgoing(svc.id, "service_on")) {
        const site = siteOf(index, l.to);
        if (site) counts.set(site, (counts.get(site) ?? 0) + 1);
      }
      known.set(svc.id, counts);
    }
  cache.set(index, known);
  return known;
}

/** The sites a service has nodes in. */
export function sitesOfService(index: BlueprintIndex, serviceId: string): string[] {
  return [...(nodesBySite(index).get(serviceId)?.keys() ?? [])];
}

/** Put the services that lean on a lost site in the range, and down the ones that have nothing left. */
export function siteRollUp(
  source: TopologySource,
  lost: string,
  result: { readonly down: Set<string>; readonly affected: Set<string> },
  queue: string[],
): void {
  const { index } = source;
  if (index.find(lost)?.kind !== "dr_site") return;
  for (const [svc, counts] of nodesBySite(index)) {
    const here = counts.get(lost) ?? 0;
    if (here === 0) continue;
    const total = [...counts.values()].reduce((a, n) => a + n, 0);
    if (here * 2 >= total) result.affected.add(svc);
    if (here >= total && !result.down.has(svc)) {
      result.down.add(svc);
      queue.push(svc);
    }
  }
}
