/**
 * What worldgen can build (REQ-009, REQ-035): a site preset plus size parameters. There are no real
 * site maps, so a preset is a name and a plausible land size; everything inside comes from parameters.
 */

export type SiteId = "giheung" | "hwaseong" | "onyang" | "cheonan" | "suwon" | "pyeongtaek";

export interface SitePreset {
  readonly id: SiteId;
  /** Short code used in ids and host names. */
  readonly code: string;
  readonly name: string;
  /** Land size in metres. Illustrative: not taken from any map. */
  readonly land: { readonly w: number; readonly d: number };
}

export const SITE_PRESETS: readonly SitePreset[] = [
  { id: "giheung", code: "gh", name: "기흥사업장", land: { w: 1400, d: 1000 } },
  { id: "hwaseong", code: "hs", name: "화성사업장", land: { w: 1600, d: 1100 } },
  { id: "onyang", code: "oy", name: "온양사업장", land: { w: 800, d: 600 } },
  { id: "cheonan", code: "ca", name: "천안사업장", land: { w: 900, d: 700 } },
  { id: "suwon", code: "sw", name: "수원사업장", land: { w: 1300, d: 1300 } },
  { id: "pyeongtaek", code: "pt", name: "평택사업장", land: { w: 2000, d: 1450 } },
];

export function sitePreset(id: string): SitePreset | undefined {
  return SITE_PRESETS.find((p) => p.id === id);
}

export interface WorldgenSpec {
  readonly site: SiteId;
  readonly seed: number;
  readonly name?: string;
  readonly buildings: number;
  readonly floors: number;
  readonly roomsPerFloor: number;
  readonly rows: number;
  readonly racksPerRow: number;
  /** Share of each compute rack's units filled with servers (power permitting). */
  readonly fill: number;
  /** Share of servers that are GPU servers. */
  readonly gpuShare: number;
  readonly containment: "cold" | "hot" | "none";
  readonly coolingRedundancy: "N" | "N+1" | "2N";
  readonly powerRedundancy: "N" | "2N";
  /** VMs per virtualisation host; 0 builds no virtualisation layer. */
  readonly vmsPerHost: number;
}

export const DEFAULT_WORLDGEN: Omit<WorldgenSpec, "site" | "seed"> = {
  buildings: 1,
  floors: 1,
  roomsPerFloor: 1,
  rows: 4,
  racksPerRow: 8,
  fill: 0.5,
  gpuShare: 0.1,
  containment: "cold",
  coolingRedundancy: "N+1",
  powerRedundancy: "2N",
  vmsPerHost: 6,
};

type NumericKey = {
  [K in keyof WorldgenSpec]-?: WorldgenSpec[K] extends number ? K : never;
}[keyof WorldgenSpec];

export interface NumberField {
  readonly key: Exclude<NumericKey, "seed">;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly unit: string;
  readonly integer: boolean;
}

/** Form fields for the builder's "자동 생성" panel, with the limits worldgen accepts. */
export const WORLDGEN_FIELDS: readonly NumberField[] = [
  { key: "buildings", label: "건물 수", min: 1, max: 4, unit: "동", integer: true },
  { key: "floors", label: "건물당 층 수", min: 1, max: 8, unit: "층", integer: true },
  { key: "roomsPerFloor", label: "층당 서버룸", min: 1, max: 4, unit: "개", integer: true },
  { key: "rows", label: "서버룸당 랙 줄", min: 1, max: 12, unit: "줄", integer: true },
  { key: "racksPerRow", label: "줄당 랙", min: 1, max: 20, unit: "개", integer: true },
  { key: "fill", label: "랙 채움 비율", min: 0.1, max: 0.9, unit: "비율", integer: false },
  { key: "gpuShare", label: "GPU 서버 비율", min: 0, max: 0.5, unit: "비율", integer: false },
  { key: "vmsPerHost", label: "호스트당 VM", min: 0, max: 30, unit: "개", integer: true },
];

export const CHOICE_FIELD_LABELS = {
  containment: "컨테인먼트",
  coolingRedundancy: "냉방 이중화",
  powerRedundancy: "전원 계통",
} as const;

export const CHOICE_LABELS = {
  containment: { cold: "냉복도 컨테인먼트", hot: "열복도 컨테인먼트", none: "없음" },
  coolingRedundancy: { N: "N (여유 없음)", "N+1": "N+1", "2N": "2N" },
  powerRedundancy: { N: "단일 계통", "2N": "A/B 이중 계통" },
} as const;

/** Largest world worldgen builds; bigger worlds slow every run (capacity checked in REQ-032). */
export const MAX_RACKS = 2000;

export function rackCount(spec: WorldgenSpec): number {
  return spec.buildings * spec.floors * spec.roomsPerFloor * spec.rows * spec.racksPerRow;
}

function fieldProblem(field: NumberField, value: number): string | undefined {
  const inRange = Number.isFinite(value) && value >= field.min && value <= field.max;
  if (inRange && (!field.integer || Number.isInteger(value))) return undefined;
  const kind = field.integer ? " 사이의 정수" : " 사이";
  return `${field.label}: ${field.min}~${field.max}${kind}여야 한다 (지금 ${value})`;
}

function choiceProblems(spec: WorldgenSpec): string[] {
  return Object.entries(CHOICE_LABELS).flatMap(([key, labels]) => {
    const value = String(spec[key as keyof WorldgenSpec]);
    if (value in labels) return [];
    return [
      `${CHOICE_FIELD_LABELS[key as keyof typeof CHOICE_FIELD_LABELS]}: 알 수 없는 값 '${value}'`,
    ];
  });
}

/** Problems with a spec, in Korean; empty when it can be built. */
export function specProblems(spec: WorldgenSpec): string[] {
  const out: string[] = [];
  if (!sitePreset(spec.site)) out.push(`알 수 없는 사업장 '${spec.site}'`);
  if (!Number.isInteger(spec.seed)) out.push("시드는 정수여야 한다");
  for (const field of WORLDGEN_FIELDS) {
    const problem = fieldProblem(field, spec[field.key]);
    if (problem) out.push(problem);
  }
  out.push(...choiceProblems(spec));
  if (out.length === 0 && rackCount(spec) > MAX_RACKS)
    out.push(`랙이 ${rackCount(spec)}개다. 한 세계는 ${MAX_RACKS}개까지 만들 수 있다`);
  return out;
}
