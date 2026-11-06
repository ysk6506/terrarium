/**
 * Services in the builder (REQ-086, ADR-0091): which services a server or VM carries, adding one, and the line the
 * panel shows ("떠받치는 서비스 n개"). A service is an ordinary entity; this is only the least the builder needs.
 */
import type { Blueprint, Entity, Link } from "@terrarium/core/world";
import {
  BlueprintIndex,
  SERVICE_KIND_LABELS,
  type ServiceKind,
  serviceProps,
} from "@terrarium/core/world";
import { type Edit, nextId } from "./edit";

/** The services that run on a server, VM or storage by the design (the active ones first). */
export function servicesOnPlace(index: BlueprintIndex, placeId: string): Entity[] {
  return index
    .incoming(placeId, "service_on")
    .toSorted((a, b) => Number(b.props.role === "active") - Number(a.props.role === "active"))
    .flatMap((l) => {
      const e = index.find(l.from);
      return e ? [e] : [];
    });
}

/** The count of services that stand on a place, as a line: "떠받치는 서비스 2개". */
export function supportLine(index: BlueprintIndex, placeId: string): string {
  const n = servicesOnPlace(index, placeId).length;
  return n === 0 ? "떠받치는 서비스가 아직 없어요" : `떠받치는 서비스 ${n}개`;
}

const DEFAULT_PROCESS: Readonly<Record<ServiceKind, string>> = {
  request: "app",
  batch: "worker",
  stateful: "datad",
};

/** A new service that runs on `placeId`; its harm figure is a guess the panel says is a guess. */
export function addService(bp: Blueprint, placeId: string, kind: ServiceKind = "request"): Edit {
  const index = new BlueprintIndex(bp);
  const host = index.entity(placeId);
  const id = nextId(index, "service");
  const service: Entity = {
    id,
    kind: "service",
    name: `${host.name}의 ${SERVICE_KIND_LABELS[kind]} 서비스`,
    props: serviceProps({
      kind,
      process: DEFAULT_PROCESS[kind],
      ...(kind === "batch" ? { delayHours: 2 } : { perHourKrw: 1_000_000 }),
    }),
  };
  const on: Link = {
    id: nextId(index, "link"),
    kind: "service_on",
    from: id,
    to: placeId,
    props: { role: "active" },
  };
  return {
    blueprint: { ...bp, entities: [...bp.entities, service], links: [...bp.links, on] },
    select: [id],
  };
}
