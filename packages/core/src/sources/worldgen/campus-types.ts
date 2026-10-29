/** Shared shapes of the campus generator: drafts of racks, pods and halls before they are assembled. */
import type { Catalog } from "@terrarium/core/catalog";
import type { SeededRng } from "@terrarium/core/kernel";
import type { BlueprintAssembler, DeviceSpec } from "@terrarium/core/sources";
import type { BulkLoad } from "@terrarium/core/world";
import type { HallPlan, PodKind, PodPlan } from "./campus-plan";
import type { CampusSpec } from "./campus-spec";

/** Expected utilisation used to size cooling and power. */
export const SIZING_UTIL = 0.6;

export interface CampusCtx {
  readonly asm: BlueprintAssembler;
  readonly catalog: Catalog;
  readonly spec: CampusSpec;
  readonly siteId: string;
  /** Short code used in host names, e.g. "gh". */
  readonly code: string;
}

export interface RackDraft {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly kind: PodKind;
  /** 0 or 1: which of the pod's two rows the rack stands in. */
  readonly row: 0 | 1;
  /** Position along the row, from 0. */
  readonly col: number;
  readonly devices: DeviceSpec[];
  /** Devices that take power from the rack's PDUs. */
  readonly powered: string[];
  readonly pdus: { readonly a: string[]; readonly b: string[] };
  /** Set for a light rack (REQ-049): what it stands for instead of devices. */
  light?: BulkLoad;
  /** Expected load, W: electric, and the share the air and the liquid loop carry away. */
  loadW: number;
  airW: number;
  liquidW: number;
}

export interface PodDraft {
  readonly id: string;
  readonly name: string;
  readonly plan: PodPlan;
  readonly racks: RackDraft[];
  /** The pod's two aggregation switches. */
  readonly spines: string[];
  /** Power block (UPS pair) this pod hangs on, from 1. */
  block: number;
  loadW: number;
}

export interface HallDraft {
  readonly plan: HallPlan;
  readonly rng: SeededRng;
  readonly pods: PodDraft[];
  /** Blocks in this hall: ids `${hall}-b1`.. */
  blocks: number;
  loadW: number;
  airW: number;
  liquidW: number;
}

export const blockId = (hall: HallDraft, n: number) => `${hall.plan.id}-b${n}`;
