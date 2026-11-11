/**
 * Every number screen ③ and the card after it say about the size (REQ-111, ADR-0134), worked out once from the same
 * sizing calculation (`planShape` and `worldTotals`) that the generator follows. The screen only prints these.
 */
import {
  askTotal,
  loadOf,
  type ServiceDraft,
  type ShapePlan,
  type SizeAsk,
  serversForLoad,
  sizingNotes,
  worldTotals,
} from "@terrarium/core/sources/worldgen";
import { count, rackParts } from "../format";

export interface SizeView {
  readonly totals: ReturnType<typeof worldTotals>;
  /** "서버 120대 · 랙 7대 (서버 랙 6 + 기반 랙 1) · 서버룸 1곳" */
  readonly totalLine: string;
  /** What the shape adds on top of the three numbers, one clause each. */
  readonly notes: readonly string[];
  /** "서비스가 필요로 하는 서버는 모두 30대쯤이에요. …" */
  readonly startLine: string;
  /** Switches, PDUs, cooling units and kilowatts, counted from the same plan. */
  readonly partsLine: string;
}

/** The racks as every screen says them: all of them, and of what kind when some hold the network and the storage. */
export const racksText = (racks: number, base: number): string =>
  `랙 ${count(racks)}대${base > 0 ? ` ${rackParts(racks, base)}` : ""}`;

export function sizeView(input: {
  readonly services: readonly ServiceDraft[];
  readonly size: SizeAsk;
  readonly start: SizeAsk;
  readonly plan: ShapePlan;
}): SizeView {
  const { services, size, start, plan } = input;
  const totals = worldTotals(plan);
  const need = services.reduce((n, s) => n + serversForLoad(loadOf(s)), 0);
  return {
    totals,
    totalLine: `서버 ${count(totals.servers)}대 · ${racksText(totals.racks, totals.baseRacks)} · 서버룸 ${count(totals.rooms)}곳`,
    notes: sizingNotes(size, plan),
    startLine: `선택한 서비스가 필요로 하는 서버는 모두 ${count(need)}대쯤이에요. 찾을 곳이 되도록 배경 서버를 더해 ${count(askTotal(start))}대로 시작해요.`,
    partsLine: `스위치 ${count(plan.switches)}대 · PDU ${count(plan.pdus)}대 · 냉방기 ${count(plan.coolers)}대 · ${count(plan.kw)} kW는 이 모양에 맞춰 세요. 토폴로지는 접어서 보여 줘요.`,
  };
}
