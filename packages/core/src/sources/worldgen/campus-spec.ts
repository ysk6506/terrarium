/**
 * What a campus is built from (REQ-043..047): a site preset plus a profile that says how its halls
 * are cooled, and a few size knobs. Rooms differ in size and purpose; the profile decides the mix of
 * air, rear-door, direct-liquid and immersion cooling, and every hall draws its equipment from several
 * makers.
 */
import { type SiteId, sitePreset } from "./spec";

export type CampusProfile = "air" | "hybrid" | "ai-liquid" | "mixed";

export const CAMPUS_PROFILE_LABELS: Readonly<
  Record<CampusProfile, { name: string; about: string }>
> = {
  air: {
    name: "공랭 전용",
    about: "모든 홀이 공조기(CRAH)와 컨테인먼트로 식힌다. 오래된 엔터프라이즈 센터.",
  },
  hybrid: {
    name: "공랭+수랭 혼합",
    about: "한 홀 안에 공랭 포드, 후면도어 포드, 직접수랭 포드가 같이 있다.",
  },
  "ai-liquid": {
    name: "AI 수랭·액침",
    about: "GPU 서버를 직접수랭(DLC)과 액침 탱크로 식힌다. 공조기는 남는 열만 맡는다.",
  },
  mixed: {
    name: "동별로 다른 구성",
    about: "건물마다 공랭, 혼합, 수랭, 액침이 돌아가며 들어간다. 가장 현실에 가깝다.",
  },
};

export interface CampusSpec {
  readonly site: SiteId;
  readonly seed: number;
  readonly name?: string;
  readonly profile: CampusProfile;
  readonly buildings: number;
  /** Floors of data halls per building (the ground floor holds power, network and the control room). */
  readonly floors: number;
  readonly hallsPerFloor: number;
  /** Containments (pods) in a typical hall; each hall is between half and twice this. */
  readonly podsPerHall: number;
  /** Share of each rack's units filled with servers (power permitting). */
  readonly fill: number;
  /**
   * Share of each hall's containments built server by server; the rest stand as light racks that
   * count their servers (REQ-049). 1 builds everything in detail; every hall keeps at least one
   * containment in detail so there is always something to act on.
   */
  readonly detail: number;
  /** Share of air-cooled servers that are GPU servers. */
  readonly gpuShare: number;
  readonly powerRedundancy: "N" | "2N";
  /** "mixed" draws from every maker; "single" keeps each hall to one maker. */
  readonly vendors: "mixed" | "single";
}

export const DEFAULT_CAMPUS: Omit<CampusSpec, "site" | "seed"> = {
  profile: "mixed",
  buildings: 2,
  floors: 1,
  hallsPerFloor: 2,
  podsPerHall: 6,
  fill: 0.5,
  detail: 1,
  gpuShare: 0.1,
  powerRedundancy: "2N",
  vendors: "mixed",
};

/** The numbers a campus form asks for, with the limits the generator accepts. */
export const CAMPUS_NUMBERS: ReadonlyArray<{
  readonly key:
    | "buildings"
    | "floors"
    | "hallsPerFloor"
    | "podsPerHall"
    | "fill"
    | "detail"
    | "gpuShare";
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly unit: string;
  readonly integer: boolean;
}> = [
  { key: "buildings", label: "데이터센터 건물", min: 1, max: 6, unit: "동", integer: true },
  { key: "floors", label: "건물당 데이터 홀 층", min: 1, max: 4, unit: "층", integer: true },
  { key: "hallsPerFloor", label: "층당 데이터 홀", min: 1, max: 4, unit: "개", integer: true },
  {
    key: "podsPerHall",
    label: "홀당 컨테인먼트(보통)",
    min: 1,
    max: 240,
    unit: "개",
    integer: true,
  },
  { key: "fill", label: "랙 채움 비율", min: 0.1, max: 0.9, unit: "비율", integer: false },
  { key: "detail", label: "상세 모델링 비율", min: 0, max: 1, unit: "비율", integer: false },
  { key: "gpuShare", label: "GPU 서버 비율", min: 0, max: 0.5, unit: "비율", integer: false },
];

/** Most racks a campus has, light or not; the cost of a run grows with what the world holds (see the capacity notes). */
export const MAX_CAMPUS_RACKS = 20_000;
/** Most racks built server by server; every one of them brings its servers, switches and PDUs. */
export const MAX_DETAILED_RACKS = 3000;

const CHOICES = {
  profile: Object.keys(CAMPUS_PROFILE_LABELS),
  powerRedundancy: ["N", "2N"],
  vendors: ["mixed", "single"],
} as const;

const CHOICE_NAMES = {
  profile: "구성",
  powerRedundancy: "전원 계통",
  vendors: "벤더 구성",
} as const;

function numberProblems(spec: CampusSpec): string[] {
  const out: string[] = [];
  for (const field of CAMPUS_NUMBERS) {
    const value = spec[field.key];
    const inRange = Number.isFinite(value) && value >= field.min && value <= field.max;
    if (!inRange || (field.integer && !Number.isInteger(value)))
      out.push(
        `${field.label}: ${field.min}~${field.max}${field.integer ? " 사이의 정수" : " 사이"}여야 한다 (지금 ${value})`,
      );
  }
  return out;
}

export function campusProblems(spec: CampusSpec): string[] {
  const out: string[] = [];
  if (!sitePreset(spec.site)) out.push(`알 수 없는 사업장 '${spec.site}'`);
  if (!Number.isInteger(spec.seed)) out.push("시드는 정수여야 한다");
  out.push(...numberProblems(spec));
  for (const key of Object.keys(CHOICES) as Array<keyof typeof CHOICES>)
    if (!(CHOICES[key] as readonly string[]).includes(spec[key]))
      out.push(`알 수 없는 ${CHOICE_NAMES[key]} '${spec[key]}'`);
  return out;
}
