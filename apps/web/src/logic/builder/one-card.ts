/**
 * The words of the builder's one card and of the bar at the foot (REQ-102, ADR-0123): one fact line for the thing that is
 * picked, the rack's front as a strip, the sums of the step being looked at, and the line a trial run leaves. The
 * numbers are read off the blueprint and the catalog; nothing is kept here.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { BlueprintIndex, Entity } from "@terrarium/core/world";
import { count, rackParts, watts, won } from "../format";
import { powerHeadroomW } from "./hud";
import type { Level } from "./levels";
import type { SiteUse } from "./power";
import { PREVIEW_SECONDS, type Preview } from "./preview";
import { elevation } from "./rack";
import { stepSum } from "./server-card";
import { costOf, levelStats } from "./stats";

/** One run of units in a rack, bottom first: a device or a free run. */
export interface StripCell {
  readonly u: number;
  readonly height: number;
  readonly device?: Entity;
}

/** The rack's front as the card draws it: left is the bottom unit, the free top is at the right. */
export function stripOf(index: BlueprintIndex, catalog: Catalog, rackId: string): StripCell[] {
  return elevation(index, catalog, rackId)
    .slots.map((s) => ({ u: s.u, height: s.height, ...(s.device ? { device: s.device } : {}) }))
    .reverse();
}

const model = (catalog: Catalog, e: Entity) =>
  e.modelId && catalog.has(e.modelId) ? catalog.get(e.modelId) : undefined;

function rackFact(index: BlueprintIndex, catalog: Catalog, rack: Entity): string {
  const ev = elevation(index, catalog, rack.id);
  const servers = index.childrenOf(rack.id).filter((d) => d.kind === "server").length;
  const supply = ev.supplyW > 0 ? watts(ev.supplyW) : "PDU 없음";
  return `서버 ${count(servers)}대 · 빈 곳 ${ev.freeUnits}U · ${watts(ev.demandW)} / ${supply}`;
}

function placeFact(index: BlueprintIndex, catalog: Catalog, e: Entity): string {
  const inside = [e, ...index.descendants(e.id)];
  const racks = inside.filter((x) => x.kind === "rack").length;
  const servers = inside.filter((x) => x.kind === "server").length;
  const base = inside.filter((x) => x.kind === "rack" && x.props.infra === true).length;
  const racksText = `랙 ${count(racks)}대${base > 0 ? ` ${rackParts(racks, base)}` : ""}`;
  if (e.kind === "room") {
    const s = levelStats(index, catalog, { kind: "room", id: e.id });
    return `${racksText} · 서버 ${count(servers)}대 · 발열 ${watts(s.itTypicalW)} / 냉방 ${count(s.coolingKw)} kW`;
  }
  const rooms = inside.filter((x) => x.kind === "room").length;
  return `서버룸 ${count(rooms)}개 · ${racksText} · 서버 ${count(servers)}대`;
}

/** The one line under the name: how the picked thing stands, with its air when a trial run has been made. */
export function factLine(
  index: BlueprintIndex,
  catalog: Catalog,
  entity: Entity,
  preview?: Preview,
): string {
  const base =
    entity.kind === "rack"
      ? rackFact(index, catalog, entity)
      : entity.kind === "room" || entity.kind === "building"
        ? placeFact(index, catalog, entity)
        : (model(catalog, entity)?.name ?? "");
  const heat = preview?.heat.get(entity.id);
  return heat === undefined ? base : `${base} · 흡기 ${heat.toFixed(1)}°C`;
}

/** A sum of the bar at the foot: a label and the number, or the number alone (money). */
export interface BarPart {
  readonly label?: string;
  readonly value: string;
  /** What the number is made of, in small type after it. */
  readonly note?: string;
  readonly bad?: true;
}

/** "랙 26대 · 서버 514대 · 전원 여유 579 kW · 113억 원", or at a rack "이 랙 20대 · 4.2억 원 · 서비스 0개". */
export function barSum(
  index: BlueprintIndex,
  catalog: Catalog,
  level: Level,
  rack: Entity | undefined,
  site?: SiteUse,
): BarPart[] {
  if (rack) {
    const s = stepSum(index, catalog, level, rack);
    return [
      { label: "이 랙", value: `${count(s.servers)}대` },
      { value: won(costOf(index, catalog, rack)) },
      { label: "서비스", value: `${s.services}개` },
    ];
  }
  const stats = levelStats(index, catalog, level);
  const left = powerHeadroomW(stats, site);
  return [
    {
      label: "랙",
      value: `${count(stats.racks)}대`,
      ...(stats.baseRacks > 0 ? { note: rackParts(stats.racks, stats.baseRacks) } : {}),
    },
    { label: "서버", value: `${count(stats.servers)}대` },
    {
      label: "전원 여유",
      value: left === undefined ? "아직 없어요" : `${left < 0 ? "−" : ""}${watts(Math.abs(left))}`,
      ...(left !== undefined && left < 0 ? { bad: true as const } : {}),
    },
    { value: won(stats.costM) },
  ];
}

/** "시운전 10분 · 알람 0건 · 가장 더운 곳 27°C · 전원 여유 579 kW": what a trial run left, in one line. */
export function trialLine(
  preview: Preview,
  index: BlueprintIndex,
  catalog: Catalog,
  level: Level,
  site?: SiteUse,
): { readonly head: string; readonly alarms: string; readonly rest: string } {
  const stats = levelStats(index, catalog, level);
  const left = powerHeadroomW(stats, site);
  const rest = [
    ...(preview.hottest ? [`가장 더운 곳 ${Math.round(preview.hottest.inletC)}°C`] : []),
    ...(left === undefined ? [] : [`전원 여유 ${left < 0 ? "−" : ""}${watts(Math.abs(left))}`]),
  ];
  return {
    head: `시운전 ${Math.round(preview.seconds / 60)}분`,
    alarms: `알람 ${preview.alarms.length}건`,
    rest: rest.join(" · "),
  };
}

/** The trial-run button: "시운전 10분", "시운전 중 3/10분" while it goes, "다시 시운전" once there is a result. */
export function trialLabel(run: {
  readonly previewing: boolean;
  readonly minutes: number;
  readonly done: boolean;
}): string {
  const total = Math.round(PREVIEW_SECONDS / 60);
  if (run.previewing) return `시운전 중 ${Math.min(run.minutes, total)}/${total}분`;
  return run.done ? "다시 시운전" : `시운전 ${total}분`;
}
