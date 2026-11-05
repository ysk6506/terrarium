/**
 * 3D 위 숫자 한 줄 (REQ-077, ADR-0083): only the numbers an experiment runs on — racks, servers, heat against
 * cooling, and how much power is left. Money is not here: in Terrarium it is seasoning, not the point, and it lives
 * in the folded "돈" section of the panel and in the hint when something is put down.
 */
import { count, watts } from "../format";
import { megawatts, type SiteUse } from "./power";
import type { LevelStats } from "./stats";

export interface HudItem {
  readonly label: string;
  readonly value: string;
  /** Heat above cooling, or power over its limit. */
  readonly bad?: true;
}

/** Watts left of the power that can be drawn (negative when it is over), and what that is measured against. */
export function powerHeadroomW(stats: LevelStats, site?: SiteUse): number | undefined {
  if (site) return site.capacity.mw * 1e6 - site.usedW;
  return stats.pduW > 0 ? stats.pduW - stats.itMaxW : undefined;
}

const signed = (w: number): string => (w < 0 ? `−${megawatts(-w)}` : megawatts(w));

/** The four numbers, in the order an experiment cares about them. `site` is given only where the whole site is seen. */
export function hudItems(stats: LevelStats, site?: SiteUse): HudItem[] {
  const heatKw = stats.itTypicalW / 1000;
  const short = stats.coolingKw > 0 && heatKw > stats.coolingKw;
  const left = powerHeadroomW(stats, site);
  return [
    { label: "랙", value: `${count(stats.racks)}대` },
    { label: "서버", value: `${count(stats.servers)}대` },
    {
      label: "발열 / 냉방",
      value: `${watts(stats.itTypicalW)} / ${count(stats.coolingKw)} kW`,
      ...(short ? { bad: true as const } : {}),
    },
    {
      label: "전원 여유",
      value: left === undefined ? "아직 없어요" : signed(left),
      ...(left !== undefined && left < 0 ? { bad: true as const } : {}),
    },
  ];
}
