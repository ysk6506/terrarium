/**
 * The power a site has (REQ-076, ADR-0081): a build that takes the design load of the site past the capacity of its
 * grid connection is refused with how much is in use. A site without a capacity (a world drawn by hand) has no limit.
 */
import type { Catalog } from "@terrarium/core/catalog";
import {
  type Blueprint,
  BlueprintIndex,
  type PowerCapacity,
  powerCapacityOf,
  siteDrawW,
} from "@terrarium/core/world";
import { watts } from "../format";
import { EditError } from "./edit-error";

const cache = new WeakMap<Blueprint, number>();

function drawOf(bp: Blueprint, catalog: Catalog): number {
  const known = cache.get(bp);
  if (known !== undefined) return known;
  const draw = siteDrawW(new BlueprintIndex(bp), catalog);
  cache.set(bp, draw);
  return draw;
}

/** "108 MW", "107.5 MW" for a site's power; a small amount in the unit that reads best ("2.0 kW"). */
export const megawatts = (w: number): string => {
  if (Math.abs(w) < 1e6) return watts(w);
  const mw = Math.round(w / 1e5) / 10;
  return `${Number.isInteger(mw) ? mw : mw.toFixed(1)} MW`;
};

export interface SiteUse {
  readonly capacity: PowerCapacity;
  readonly usedW: number;
}

/** What the site draws against what its connection gives, or undefined for a site with no capacity. */
export function siteUse(bp: Blueprint, catalog: Catalog): SiteUse | undefined {
  const site = new BlueprintIndex(bp).ofKind("site")[0];
  const capacity = powerCapacityOf(site);
  return capacity ? { capacity, usedW: drawOf(bp, catalog) } : undefined;
}

/** "108 MW 중 81.2 MW" ("추정" when the capacity is a guess). */
export function siteUseText(use: SiteUse): string {
  const cap = `${megawatts(use.capacity.mw * 1e6)}${use.capacity.estimated ? "(추정)" : ""}`;
  return `${cap} 중 ${megawatts(use.usedW)}`;
}

/** Throws "전력이 모자라요" when the change takes the site past its capacity (and draws more than before). */
export function assertPower(before: Blueprint, after: Blueprint, catalog: Catalog): void {
  const use = siteUse(after, catalog);
  if (!use || use.usedW <= use.capacity.mw * 1e6) return;
  const was = drawOf(before, catalog);
  if (use.usedW <= was) return;
  throw new EditError(
    `전력이 모자라요. ${siteUseText({ ...use, usedW: was })}를 쓰고 있어요 (이 변경은 ${watts(use.usedW - was)}를 더 써요)`,
  );
}
