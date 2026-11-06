/**
 * Services (REQ-086, ADR-0091): what the datacentre is for. A service is a name, what it runs on (VMs, servers,
 * storage), the switches its traffic needs, how good it must be (SLO) and what it costs when it is not. Its health
 * is never simulated on its own: it is computed from the equipment below (service-health.ts).
 *
 * A service is an ordinary entity of kind `service`. Its settings live in `props`, its places in links:
 * `service_on` (role `active` or `standby`) and `service_via` (a switch on its path).
 */
import type { Entity, PropValue } from "./blueprint";

export type ServiceKind = "request" | "batch" | "stateful";
export type ServiceStatus = "healthy" | "degraded" | "down";

export const SERVICE_KINDS: readonly ServiceKind[] = ["request", "batch", "stateful"];

/** A slow service loses this share of what a stopped one loses (physics adds it up, scoring reads it back). */
export const SLOW_HARM_SHARE = 0.3;

export const SERVICE_KIND_LABELS: Readonly<Record<ServiceKind, string>> = {
  request: "요청 처리",
  batch: "배치",
  stateful: "상태 유지",
};

export const SERVICE_STATUS_LABELS: Readonly<Record<ServiceStatus, string>> = {
  healthy: "정상",
  degraded: "느려짐",
  down: "멈춤",
};

/** What counts as normal for a service; each kind has defaults and a service can override them. */
export interface ServiceConditions {
  /** A server inlet at or above this makes the service slow, °C. */
  readonly maxInletC: number;
  /** A host busier than this makes it slow, 0..1. */
  readonly maxCpuUtil: number;
  /** Memory of a host above this makes it slow, %. */
  readonly maxMemPct: number;
  /** Disk of a host above this makes it slow, %. */
  readonly maxDiskPct: number;
}

export interface ServiceDef {
  readonly kind: ServiceKind;
  /** The process that does the work, as `systemctl` names it. */
  readonly process: string;
  readonly slo: { readonly availability: number; readonly latencyMs?: number };
  /** What a stopped service costs: money each hour (request, stateful) or hours of delay (batch). */
  readonly harm: { readonly perHourKrw?: number; readonly delayHours?: number };
  /** Whether the harm figure is a guess (all generated ones are; see service-os-layer.md). */
  readonly harmEstimated: boolean;
  /** For a batch service: the work that piles up each hour while it is not running, and what one piece is called. */
  readonly queue?: { readonly perHour: number; readonly unit: string };
  readonly conditions: ServiceConditions;
}

const DEFAULTS: Readonly<Record<ServiceKind, ServiceConditions>> = {
  request: { maxInletC: 32, maxCpuUtil: 0.9, maxMemPct: 90, maxDiskPct: 90 },
  batch: { maxInletC: 32, maxCpuUtil: 0.98, maxMemPct: 92, maxDiskPct: 92 },
  stateful: { maxInletC: 32, maxCpuUtil: 0.9, maxMemPct: 88, maxDiskPct: 85 },
};

const num = (props: Entity["props"], key: string): number | undefined =>
  typeof props[key] === "number" ? (props[key] as number) : undefined;

const kindOf = (value: PropValue | undefined): ServiceKind =>
  SERVICE_KINDS.find((k) => k === value) ?? "request";

const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

function conditionsOf(p: Entity["props"], base: ServiceConditions): ServiceConditions {
  return {
    maxInletC: num(p, "maxInletC") ?? base.maxInletC,
    maxCpuUtil: num(p, "maxCpuUtil") ?? base.maxCpuUtil,
    maxMemPct: num(p, "maxMemPct") ?? base.maxMemPct,
    maxDiskPct: num(p, "maxDiskPct") ?? base.maxDiskPct,
  };
}

/** Read a service's settings from its entity. */
export function serviceDef(entity: Entity): ServiceDef {
  const p = entity.props;
  const kind = kindOf(p.serviceKind);
  const perHour = num(p, "queuePerHour");
  const latencyMs = num(p, "sloLatencyMs");
  return {
    kind,
    process: typeof p.process === "string" && p.process !== "" ? p.process : entity.id,
    slo: { availability: num(p, "sloAvailability") ?? 0.99, ...(latencyMs ? { latencyMs } : {}) },
    harm: defined({ perHourKrw: num(p, "harmPerHourKrw"), delayHours: num(p, "delayHours") }),
    harmEstimated: p.harmEstimated !== false,
    ...(perHour
      ? { queue: { perHour, unit: typeof p.queueUnit === "string" ? p.queueUnit : "건" } }
      : {}),
    conditions: conditionsOf(p, DEFAULTS[kind]),
  };
}

/** The props of a service entity for the given settings (the inverse of `serviceDef`, for generators and the builder). */
export function serviceProps(def: {
  kind: ServiceKind;
  process: string;
  availability?: number;
  latencyMs?: number;
  perHourKrw?: number;
  delayHours?: number;
  queue?: { perHour: number; unit: string };
}): Record<string, PropValue> {
  return {
    serviceKind: def.kind,
    process: def.process,
    sloAvailability: def.availability ?? 0.99,
    ...(def.latencyMs ? { sloLatencyMs: def.latencyMs } : {}),
    ...(def.perHourKrw !== undefined ? { harmPerHourKrw: def.perHourKrw } : {}),
    ...(def.delayHours !== undefined ? { delayHours: def.delayHours } : {}),
    harmEstimated: true,
    ...(def.queue ? { queuePerHour: def.queue.perHour, queueUnit: def.queue.unit } : {}),
  };
}
