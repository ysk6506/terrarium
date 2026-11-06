/**
 * The sample hall with three services on it (ADR-0091), for tests of the service and operating-system layers:
 *
 *   svc-web      request   on the VM vm-web (standby: server srv-b1), through tor-a
 *   svc-license  stateful  on the server srv-a2 (standby: srv-b1), through tor-a
 *   svc-queue    batch     on the VM vm-db (standby: srv-b1), 600 items an hour pile up while it does not run
 */
import type { Blueprint, Entity, Link } from "../blueprint";
import { type ServiceKind, serviceProps } from "../service";
import { sampleBlueprint } from "./sample";

interface Spec {
  readonly id: string;
  readonly name: string;
  readonly kind: ServiceKind;
  readonly process: string;
  readonly on: string;
  readonly standby: string;
  readonly perHourKrw?: number;
  readonly queue?: { perHour: number; unit: string };
}

const SPECS: readonly Spec[] = [
  {
    id: "svc-web",
    name: "사내 포털",
    kind: "request",
    process: "portal",
    on: "vm-web",
    standby: "srv-b1",
    perHourKrw: 2_000_000,
  },
  {
    id: "svc-license",
    name: "EDA 라이선스 서버",
    kind: "stateful",
    process: "licd",
    on: "srv-a2",
    standby: "srv-b1",
    perHourKrw: 50_000_000,
  },
  {
    id: "svc-queue",
    name: "설계 검증 큐",
    kind: "batch",
    process: "verifyd",
    on: "vm-db",
    standby: "srv-b1",
    queue: { perHour: 600, unit: "건" },
  },
];

export function serviceLab(): Blueprint {
  const base = sampleBlueprint();
  const entities: Entity[] = SPECS.map((s) => ({
    id: s.id,
    kind: "service",
    name: s.name,
    props: serviceProps({
      kind: s.kind,
      process: s.process,
      ...(s.perHourKrw !== undefined ? { perHourKrw: s.perHourKrw } : {}),
      ...(s.queue ? { queue: s.queue } : {}),
    }),
  }));
  const links: Link[] = SPECS.flatMap((s): Link[] => [
    { id: `on-${s.id}`, kind: "service_on", from: s.id, to: s.on, props: { role: "active" } },
    { id: `sb-${s.id}`, kind: "service_on", from: s.id, to: s.standby, props: { role: "standby" } },
    { id: `via-${s.id}`, kind: "service_via", from: s.id, to: "tor-a", props: {} as Link["props"] },
  ]);
  return {
    ...base,
    id: "service-lab",
    entities: [...base.entities, ...entities],
    links: [...base.links, ...links],
  };
}
