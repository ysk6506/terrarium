/**
 * "사업장 그대로" (REQ-077, ADR-0083): a world is chosen by its result, not by fourteen numbers. A site and one of
 * three scales (small, medium, as it really is) give a campus spec; what the spec comes to is told in one sentence
 * before anything is built. The numbers that are left are folded under "더 정하기" in plain words, three groups.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { ServiceDraft, ShapedResult, ShapePlan } from "@terrarium/core/sources/worldgen";
import {
  buildOf,
  type CampusSize,
  type CampusSpec,
  campusProblems,
  campusSize,
  DEFAULT_CAMPUS,
  MAX_CAMPUS_RACKS,
  MAX_DETAILED_RACKS,
  SITE_CAMPUS_MIX,
  SITE_PRESETS,
  type SiteId,
  sitePreset,
} from "@terrarium/core/sources/worldgen";
import type { Layers } from "@terrarium/core/world";
import { count } from "./format";

export type ScaleId = "small" | "medium" | "real";

export const SCALE_LABELS: Readonly<Record<ScaleId, string>> = {
  small: "작게",
  medium: "보통",
  real: "실제 그대로",
};

/** The scale a form starts on: big enough to look like a site, small enough to open in seconds. */
export const DEFAULT_SCALE: ScaleId = "medium";

/** The site a form starts on. */
export const DEFAULT_SITE: SiteId = "hwaseong";

const half = (n: number) => (n > 0 ? Math.ceil(n / 2) : 0);

/** The campus a site is, at a scale. "As it really is" is the site's own mix of buildings. */
export function scaleSpec(site: SiteId, scale: ScaleId, seed = 1): CampusSpec {
  const real: CampusSpec = { ...DEFAULT_CAMPUS, ...SITE_CAMPUS_MIX[site], site, seed };
  if (scale === "real") return real;
  if (scale === "medium")
    return {
      ...real,
      buildings: half(real.buildings),
      fabs: half(real.fabs),
      labs: Math.min(real.labs, 1),
      floors: Math.max(1, Math.ceil(real.floors / 2)),
      podsPerHall: Math.max(4, Math.ceil(real.podsPerHall / 2)),
    };
  const dataCentre = real.buildings > 0;
  return {
    ...real,
    buildings: dataCentre ? 1 : 0,
    fabs: dataCentre ? 0 : 1,
    labs: 0,
    floors: 1,
    podsPerHall: Math.min(6, real.podsPerHall),
  };
}

let known: Catalog | undefined;
const catalogOnce = () => {
  known ??= new Catalog();
  return known;
};

/** What a spec would build: racks exactly, servers and power as round figures. */
export function sizeOf(spec: CampusSpec): CampusSize {
  return campusSize(spec, catalogOnce());
}

/** Two significant figures, so an estimate does not look more exact than it is: 185,568 reads as 190,000. */
export function roughly(n: number): number {
  if (n < 100) return Math.round(n);
  const digits = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / digits) * digits;
}

/** How long making it takes, in the words a person would use. */
export function waitText(racks: number): string {
  if (racks < 500) return "몇 초";
  if (racks < 3000) return "약 10초";
  if (racks < 8000) return "약 30초";
  return "약 1분";
}

/** "랙 15,464대 · 서버 약 190,000대 · 전력 약 140 MW" */
export function sizeText(size: CampusSize): string {
  const mw = size.mw >= 10 ? Math.round(size.mw / 5) * 5 : size.mw;
  return `랙 ${count(size.racks)}대 · 서버 약 ${count(roughly(size.servers))}대 · 전력 약 ${mw} MW`;
}

export interface ScaleChoice {
  readonly id: ScaleId;
  readonly label: string;
  readonly spec: CampusSpec;
  readonly size: CampusSize;
  /** What the person reads under the choice: racks and the wait. */
  readonly about: string;
  /** The result sentence once this one is chosen. */
  readonly result: string;
}

function resultText(site: SiteId, scale: ScaleId, size: CampusSize, realRacks: number): string {
  const name = siteName(site);
  const head = sizeText(size);
  if (scale === "real") return `${head} — 실제 ${name} 규모예요`;
  if (scale === "medium")
    return `${head} — 실제의 ${Math.max(1, Math.round((size.racks / realRacks) * 100))}%쯤이에요`;
  return `${head} — 가볍게 돌려 보기 좋아요`;
}

/**
 * The scales a site offers, each strictly bigger than the one before. A scale that comes to as many racks as a bigger
 * one (a site with a single fab is the same at every size) or more (the smallest start of a small site can be larger
 * than half of it) is left out, so the person never chooses between two things that are alike or out of order.
 */
export function scaleChoices(site: SiteId, seed = 1): ScaleChoice[] {
  const real = sizeOf(scaleSpec(site, "real", seed));
  const all = (["small", "medium", "real"] as const).map((id): ScaleChoice => {
    const spec = scaleSpec(site, id, seed);
    const size = id === "real" ? real : sizeOf(spec);
    return {
      id,
      label: SCALE_LABELS[id],
      spec,
      size,
      about: `랙 ${count(size.racks)}대 · ${waitText(size.racks)}`,
      result: resultText(site, id, size, real.racks),
    };
  });
  const kept: ScaleChoice[] = [];
  for (const choice of [...all].reverse())
    if (
      choice.id === "real" ||
      choice.size.racks < (kept[0]?.size.racks ?? Number.POSITIVE_INFINITY)
    )
      kept.unshift(choice);
  return kept;
}

/** Why this spec cannot be built, or undefined when it can. */
export function specProblem(spec: CampusSpec): string | undefined {
  const [first] = campusProblems(spec);
  if (first) return first;
  const size = sizeOf(spec);
  if (size.racks > MAX_CAMPUS_RACKS)
    return `랙이 ${count(size.racks)}대예요. 한 세계는 ${count(MAX_CAMPUS_RACKS)}대까지 만들어요. 건물을 줄여요`;
  if (size.detailedRacks > MAX_DETAILED_RACKS)
    return `서버까지 만드는 랙이 ${count(size.detailedRacks)}대예요. ${count(MAX_DETAILED_RACKS)}대까지 만들어요. 건물을 줄여요`;
  return undefined;
}

/** The button: what comes out of pressing it. */
export function makeLabel(site: SiteId): string {
  return `${siteName(site)} 만들기`;
}

export const SITE_OPTIONS = SITE_PRESETS.map((p) => ({ value: p.id, label: p.name }));

// ── the numbers under "더 정하기" ─────────────────────────────────────────────────────────────

export type DetailKey =
  | "buildings"
  | "fabs"
  | "labs"
  | "hallsPerFab"
  | "floors"
  | "hallsPerFloor"
  | "podsPerHall"
  | "fill"
  | "gpuShare";

export interface DetailField {
  readonly key: DetailKey;
  readonly label: string;
  readonly unit: string;
  readonly help: string;
  readonly min: number;
  readonly max: number;
  /** A share is kept as 0.5 in the spec and shown as 50. */
  readonly percent?: boolean;
}

export interface DetailGroup {
  readonly title: string;
  readonly fields: readonly DetailField[];
}

/** Three groups, one easy line each: buildings, server rooms, servers. */
export const DETAIL_GROUPS: readonly DetailGroup[] = [
  {
    title: "건물",
    fields: [
      {
        key: "buildings",
        label: "데이터센터",
        unit: "동",
        min: 0,
        max: 6,
        help: "서버룸만 모아 둔 건물이에요.",
      },
      {
        key: "fabs",
        label: "반도체 팹",
        unit: "동",
        min: 0,
        max: 10,
        help: "반도체 공장이에요. 작은 서버룸이 안에 있어요.",
      },
      {
        key: "labs",
        label: "연구동",
        unit: "동",
        min: 0,
        max: 3,
        help: "연구원이 쓰는 타워예요. 서버룸이 몇 개 들어 있어요.",
      },
    ],
  },
  {
    title: "서버룸",
    fields: [
      {
        key: "hallsPerFab",
        label: "팹 한 동의 서버룸",
        unit: "개",
        min: 1,
        max: 6,
        help: "팹 안에 둘 서버룸 수예요.",
      },
      {
        key: "floors",
        label: "건물 한 동의 서버룸 층",
        unit: "층",
        min: 1,
        max: 12,
        help: "데이터센터에서 서버룸이 있는 층 수예요.",
      },
      {
        key: "hallsPerFloor",
        label: "한 층의 서버룸",
        unit: "개",
        min: 1,
        max: 4,
        help: "한 층에 나란히 둘 서버룸 수예요.",
      },
      {
        key: "podsPerHall",
        label: "서버룸 하나의 컨테인먼트",
        unit: "개",
        min: 1,
        max: 240,
        help: "컨테인먼트는 랙 줄을 덮는 칸이에요. 많을수록 서버룸이 커요.",
      },
    ],
  },
  {
    title: "서버",
    fields: [
      {
        key: "fill",
        label: "랙에 채우는 서버",
        unit: "%",
        min: 10,
        max: 90,
        percent: true,
        help: "랙 한 대에 서버를 얼마나 채울지예요. 높을수록 전기를 많이 써요.",
      },
      {
        key: "gpuShare",
        label: "GPU 서버",
        unit: "%",
        min: 0,
        max: 50,
        percent: true,
        help: "전체 서버 가운데 GPU 서버의 몫이에요.",
      },
    ],
  },
];

/** What the box shows for a field, and what the spec keeps when it is typed. */
export const shownValue = (f: DetailField, spec: CampusSpec): number =>
  f.percent ? Math.round(spec[f.key] * 100) : spec[f.key];
export const keptValue = (f: DetailField, shown: number): number =>
  f.percent ? shown / 100 : Math.round(shown);

export const POWER_CHOICES = [
  { value: "2N", label: "두 갈래 (A/B)" },
  { value: "N", label: "한 갈래" },
] as const;

/** The sentences a person reads while the world is made; each stage names what is being done. */
export const STAGES = ["사업장 짓는 중", "서버룸 채우는 중", "거의 다 됐어요"] as const;

/** About how long making takes, ms: a few seconds for a small one, close to a minute for the real Hwaseong. */
export function expectedMs(racks: number): number {
  return Math.min(60_000, Math.max(3000, racks * 4));
}

/** Which stage of making it is, from the time passed. A server that says nothing of its progress still moves the words. */
export function stageAt(elapsedMs: number, racks: number): (typeof STAGES)[number] {
  const share = elapsedMs / expectedMs(racks);
  return share < 0.25 ? STAGES[0] : share < 0.85 ? STAGES[1] : STAGES[2];
}

/** "화성사업장" */
export const siteName = (site: SiteId): string => sitePreset(site)?.name ?? "사업장";

// ── "서비스부터": the server count and what comes of it (REQ-094, ADR-0107 item 7) ───────────────

/** The quick choices of the server count; the last one is the site as it really is. */
export const SERVER_QUICK: readonly number[] = [48, 480, 4800];

/** The figures under the number, in the order the screen shows them: racks, rooms, switches, PDUs, cooling units, kW. */
export function planFigures(
  plan: ShapePlan,
  layers: Layers,
): ReadonlyArray<{
  readonly value: string;
  readonly unit: string;
}> {
  const build = buildOf(layers);
  const sides = build.feeds === 1 ? "한 줄" : "A+B";
  const cooling = build.cooling ?? "N+1";
  const leaves = plan.leaves;
  const power = build.power;
  const upsNote = [
    power?.upsSpare ? "UPS N+1" : "",
    power?.rackBattery ? "랙 BBU" : "",
    power?.substation ? "자체 변전소" : "",
  ]
    .filter((t) => t !== "")
    .join(" · ");
  // REQ-107: the accelerator, liquid and power choices add what they bring (GPUs, CDUs) and move the kW
  const gpu =
    plan.gpus > 0
      ? [{ value: count(plan.gpus), unit: `GPU · 서버 ${count(plan.gpuServers)}대` }]
      : [];
  const cdus = plan.cdus > 0 ? [{ value: count(plan.cdus), unit: "CDU · 액체 냉각" }] : [];
  return [
    { value: count(plan.racks), unit: `랙 · ${plan.perRack}대씩` },
    { value: count(plan.rooms), unit: "서버룸" },
    ...(plan.buildings > 1
      ? [{ value: count(plan.buildings), unit: build.site ? "건물 · 사이트 둘" : "건물" }]
      : []),
    { value: count(plan.switches), unit: `스위치 · 리프 ${count(leaves)} + 스파인 ${plan.spines}` },
    { value: count(plan.pdus), unit: `PDU · ${sides}${upsNote ? ` · ${upsNote}` : ""}` },
    { value: count(plan.coolers), unit: `냉방기 · ${cooling}` },
    ...gpu,
    ...cdus,
    {
      value: count(plan.kw),
      unit: plan.gpuKw > 0 ? `kW · GPU ${count(plan.gpuKw)} kW 포함` : "kW",
    },
  ];
}

/** "세계를 다 지었어요 — 서버룸 1 · 랙 24 · 서버 480 · IAP(호스트 3 · VM 9) · 시나리오 14개" */
export function doneLine(
  counts: ShapedResult["counts"],
  services: readonly ServiceDraft[],
  scenarios: number,
): string {
  const names = services.map((s) => (counts.serviceVms > 0 ? s.name : s.name)).join(" · ");
  const own =
    counts.serviceVms > 0
      ? `호스트 ${counts.serviceHosts} · VM ${counts.serviceVms}`
      : `서버 ${counts.serviceHosts}`;
  const where =
    counts.sites > 0
      ? `사이트 ${count(counts.sites)} · `
      : counts.buildings > 1
        ? `건물 ${count(counts.buildings)} · `
        : "";
  return `세계를 다 지었어요 — ${where}서버룸 ${count(counts.rooms)} · 랙 ${count(counts.racks)} · 서버 ${count(counts.servers)} · ${names}(${own}) · 시나리오 ${scenarios}개`;
}
