/**
 * The editor palette for one world (REQ-034): every block, each fault as its own block, and for each
 * whether it can be used here, or why not. Two reasons exist: the simulator does not support it yet,
 * or this world has nothing it could act on.
 */
import {
  type BlueprintIndex,
  type EntityKind,
  FAULT_SPECS,
  type FaultSpec,
  kindList,
} from "@terrarium/core/world";
import { BLOCK_SPECS, type BlockCategory, type BlockSpec } from "./blocks";
import type { ParamValue } from "./model";

export interface PaletteItem {
  /** Unique within the palette, e.g. "wait" or "inject_fault:breaker_trip". */
  readonly key: string;
  readonly type: string;
  readonly category: BlockCategory;
  /** Sub-heading inside the category, e.g. fault domain "설비". */
  readonly group?: string;
  readonly label: string;
  readonly description: string;
  /** Parameters a new block starts with. */
  readonly params: Readonly<Record<string, ParamValue>>;
  readonly available: boolean;
  readonly reason?: string;
  /** How many things in this world the block could act on, when it acts on something. */
  readonly candidates?: number;
}

export const FAULT_DOMAIN_LABELS: Readonly<Record<FaultSpec["domain"], string>> = {
  facility: "설비",
  server: "서버",
  network: "네트워크",
  storage: "스토리지",
  virtual: "가상화",
};

/** Default values for a block's parameters (those that have one). */
export function defaultParams(spec: BlockSpec): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const param of spec.params)
    if ("default" in param && param.default !== undefined) out[param.name] = param.default;
  return out;
}

function countOf(index: BlueprintIndex, kinds: readonly (EntityKind | "link")[]): number {
  return kinds.reduce(
    (sum, kind) =>
      sum +
      (kind === "link"
        ? index.allLinks().filter((l) => l.kind === "network").length
        : index.ofKind(kind).length),
    0,
  );
}

const missing = (kinds: readonly (EntityKind | "link")[]) =>
  `이 세계에는 대상으로 쓸 장비(${kindList(kinds)})가 없어요`;

function blockItem(spec: BlockSpec, index: BlueprintIndex): PaletteItem {
  const base = {
    key: spec.type,
    type: spec.type,
    category: spec.category,
    label: spec.label,
    description: spec.description,
    params: defaultParams(spec),
  };
  if (spec.status === "planned")
    return {
      ...base,
      available: false,
      reason: `아직 시뮬레이터가 지원하지 않아요: ${spec.plannedReason}`,
    };
  if (!spec.needsAnyOf) return { ...base, available: true };
  const candidates = countOf(index, spec.needsAnyOf);
  return candidates > 0
    ? { ...base, available: true, candidates }
    : { ...base, available: false, reason: missing(spec.needsAnyOf), candidates };
}

function faultItem(fault: FaultSpec, inject: BlockSpec, index: BlueprintIndex): PaletteItem {
  const candidates = countOf(index, fault.targets);
  const base = {
    key: `inject_fault:${fault.type}`,
    type: "inject_fault",
    category: "fault" as const,
    group: FAULT_DOMAIN_LABELS[fault.domain],
    label: fault.label,
    description: fault.description,
    params: { ...defaultParams(inject), faultType: fault.type },
    candidates,
  };
  if (fault.status === "planned")
    return {
      ...base,
      available: false,
      reason: "아직 시뮬레이터가 이 고장의 효과를 계산하지 않아요",
    };
  return candidates > 0
    ? { ...base, available: true }
    : { ...base, available: false, reason: missing(fault.targets) };
}

export function paletteFor(
  index: BlueprintIndex,
  faults: readonly FaultSpec[] = FAULT_SPECS,
): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const spec of BLOCK_SPECS) {
    if (spec.type === "inject_fault") out.push(...faults.map((f) => faultItem(f, spec, index)));
    else out.push(blockItem(spec, index));
  }
  return out;
}
