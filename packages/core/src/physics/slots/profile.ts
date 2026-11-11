/**
 * The physics profile (REQ-113, ADR-0137): which of a slot's numbers, tables and weather an experiment changed, on top of
 * the default physics of a version (`base`). It is data, checked before use, and it has a fingerprint: the hash of its
 * canonical content. Ranking and comparison only put runs with the same fingerprint side by side.
 */
import { hashValue } from "@terrarium/core/kernel";
import { curveProblems, type WeatherRow } from "./curve";
import { SLOTS, splitName } from "./registry";
import { type Point, SCOPE_KINDS, type ScopeKind } from "./types";

/** The versions of the default physics. A new default is a new version: old runs keep being graded on theirs. */
export const PHYSICS_BASES = ["v1"] as const;
export type PhysicsBase = (typeof PHYSICS_BASES)[number];

/** The fingerprint of the default physics: a profile that changes nothing. */
export const DEFAULT_FINGERPRINT = "v1";

export interface ScopedParam {
  /** `slot.param`. */
  readonly param: string;
  readonly value: number;
  /** Where it applies: a building, room or rack id, or an equipment model id. */
  readonly scope: { readonly kind: ScopeKind; readonly id: string };
}

export interface WeatherTable {
  readonly rows: readonly WeatherRow[];
  /** Repeat the table with this period (86400: a daily cycle); absent: held at the last row. */
  readonly repeatS?: number;
}

export interface PhysicsProfile {
  readonly base: PhysicsBase;
  /** World-wide numbers, by `slot.param`. */
  readonly params?: Readonly<Record<string, number>>;
  /** Numbers that apply to one building, room, rack or model only; the more specific scope wins. */
  readonly scoped?: readonly ScopedParam[];
  /** Tables by `slot.curve`. */
  readonly curves?: Readonly<Record<string, readonly Point[]>>;
  readonly weather?: WeatherTable;
}

export const DEFAULT_PROFILE: PhysicsProfile = { base: "v1" };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function paramProblems(name: string, value: unknown, where: string): string[] {
  const at = splitName(name);
  const spec = at && SLOTS[at.slot].params[at.name];
  if (!at || !spec)
    return [
      `${where}알 수 없는 숫자 '${name}'예요 (자리 이름.숫자 이름, 예: thermal.room.envelopeWPerKM2)`,
    ];
  if (typeof value !== "number" || !Number.isFinite(value))
    return [`${where}'${name}'은 유한한 숫자여야 해요`];
  if (value < spec.min || value > spec.max)
    return [
      `${where}'${name}'(${value})이 허용 범위 ${spec.min}~${spec.max} ${spec.unit}를 벗어나요. ${spec.ko}`,
    ];
  return [];
}

function scopedProblems(list: unknown): string[] {
  if (!Array.isArray(list)) return ["scoped는 목록이어야 해요"];
  const out: string[] = [];
  for (const [i, s] of list.entries()) {
    const where = `scoped[${i}] `;
    if (!isObject(s) || !isObject(s.scope)) {
      out.push(`${where}{param, value, scope:{kind, id}} 꼴이어야 해요`);
      continue;
    }
    const { kind, id } = s.scope;
    out.push(...paramProblems(String(s.param), s.value, where));
    if (!SCOPE_KINDS.includes(kind as ScopeKind))
      out.push(`${where}범위 종류 '${String(kind)}'는 ${SCOPE_KINDS.join("·")} 중 하나여야 해요`);
    else if (typeof id !== "string" || id === "") out.push(`${where}범위의 id가 비어 있어요`);
    const at = splitName(String(s.param));
    if (at && !SLOTS[at.slot].scopes.includes(kind as ScopeKind))
      out.push(
        `${where}'${at.slot}'은 ${kind} 범위로 바꿀 수 없어요 (가능: ${SLOTS[at.slot].scopes.join("·")})`,
      );
  }
  return out;
}

function curvesProblems(curves: unknown): string[] {
  if (!isObject(curves)) return ["curves는 {이름: [[x,y],…]} 꼴이어야 해요"];
  const out: string[] = [];
  for (const [name, points] of Object.entries(curves)) {
    const at = splitName(name);
    const spec = at && SLOTS[at.slot].curves[at.name];
    if (!at || !spec)
      out.push(
        `알 수 없는 곡선 '${name}'이에요 (자리 이름.곡선 이름, 예: power.protection.tripTimeCurve)`,
      );
    else out.push(...curveProblems(name, points, spec));
  }
  return out;
}

function humidityProblems(rows: readonly WeatherRow[]): string[] {
  const out: string[] = [];
  for (const [i, r] of rows.entries()) {
    const h = r?.humidityPct;
    if (h !== undefined && !(typeof h === "number" && h >= 0 && h <= 100))
      out.push(`날씨 표: ${i + 1}번째 줄의 습도(${String(h)})는 0~100 %여야 해요`);
  }
  return out;
}

function weatherProblems(w: unknown): string[] {
  if (!isObject(w) || !Array.isArray(w.rows))
    return ["weather는 {rows:[{timeS, outdoorC, humidityPct?}], repeatS?} 꼴이어야 해요"];
  const out = curveProblems(
    "날씨 표",
    w.rows.map((r: unknown) => [(r as WeatherRow)?.timeS, (r as WeatherRow)?.outdoorC]),
    {
      xMin: 0,
      xMax: 1e9,
      yMin: -50,
      yMax: 70,
    },
  );
  out.push(...humidityProblems(w.rows as WeatherRow[]));
  const last = (w.rows as WeatherRow[]).at(-1)?.timeS ?? 0;
  if (
    w.repeatS !== undefined &&
    !(typeof w.repeatS === "number" && w.repeatS > 0 && w.repeatS >= last)
  )
    out.push("날씨 표: repeatS는 마지막 시각 이상인 양수여야 해요");
  return out;
}

/** Problems with a profile, in Korean (each says what is wrong and, where there is a range, what it may be); empty when it can be used. */
export function profileProblems(profile: unknown): string[] {
  if (!isObject(profile))
    return ["물리 프로필은 {base, params?, scoped?, curves?, weather?} 꼴이어야 해요"];
  const out: string[] = [];
  if (!PHYSICS_BASES.includes(profile.base as PhysicsBase))
    out.push(
      `기본 물리 판 '${String(profile.base)}'은 없어요 (있는 판: ${PHYSICS_BASES.join(", ")})`,
    );
  for (const key of Object.keys(profile))
    if (!["base", "params", "scoped", "curves", "weather"].includes(key))
      out.push(`알 수 없는 항목 '${key}'이에요`);
  if (profile.params !== undefined) {
    if (!isObject(profile.params)) out.push("params는 {이름: 숫자} 꼴이어야 해요");
    else for (const [k, v] of Object.entries(profile.params)) out.push(...paramProblems(k, v, ""));
  }
  if (profile.scoped !== undefined) out.push(...scopedProblems(profile.scoped));
  if (profile.curves !== undefined) out.push(...curvesProblems(profile.curves));
  if (profile.weather !== undefined) out.push(...weatherProblems(profile.weather));
  return out;
}

/** What a profile amounts to: numbers equal to the default dropped, empty parts removed, lists in a fixed order. */
export function canonicalProfile(profile: PhysicsProfile): PhysicsProfile {
  const params = Object.entries(profile.params ?? {}).filter(([k, v]) => {
    const at = splitName(k);
    return !(at && SLOTS[at.slot].params[at.name]?.default === v);
  });
  const scoped = [...(profile.scoped ?? [])].sort(
    (a, b) =>
      a.param.localeCompare(b.param) ||
      a.scope.kind.localeCompare(b.scope.kind) ||
      a.scope.id.localeCompare(b.scope.id),
  );
  const curves = Object.entries(profile.curves ?? {});
  return {
    base: profile.base,
    ...(params.length > 0 ? { params: Object.fromEntries(params) } : {}),
    ...(scoped.length > 0 ? { scoped } : {}),
    ...(curves.length > 0 ? { curves: Object.fromEntries(curves) } : {}),
    ...(profile.weather && profile.weather.rows.length > 0 ? { weather: profile.weather } : {}),
  };
}

/** The profile's fingerprint: `v1` for the default physics, else the version and a hash of the canonical content. */
export function fingerprintOf(profile: PhysicsProfile | undefined): string {
  if (!profile) return DEFAULT_FINGERPRINT;
  const canon = canonicalProfile(profile);
  if (Object.keys(canon).length === 1) return canon.base;
  return `${canon.base}+${hashValue(canon).slice(0, 12)}`;
}

/** Whether a profile changes nothing. */
export const isDefaultProfile = (profile: PhysicsProfile | undefined): boolean =>
  fingerprintOf(profile) === DEFAULT_FINGERPRINT;
