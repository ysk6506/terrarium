/**
 * The services a generated world carries (REQ-086, ADR-0091). What a building is for decides which ones:
 *
 *   HPC센터          설계 검증 큐 (batch), EDA 라이선스 서버 (stateful), 스토리지 게이트웨이 (stateful)
 *   fab (팹)         MES 연동 (request), 설비 로그 수집 (batch)
 *   anything else    사내 포털 (request), 로그 수집 (batch)
 *
 * Each service runs on a VM of the building (or on a server, where there are no VMs) and has a standby on another
 * rack, on another power feed where the building has one. The hourly harm figures are guesses, not measurements;
 * the document service-os-layer.md says so, and every service carries `harmEstimated`.
 * A building that holds only light (bulk) racks has no server to run on and gets no services.
 */
import {
  type Blueprint,
  BlueprintIndex,
  type Entity,
  type Link,
  type ServiceKind,
  serviceProps,
} from "@terrarium/core/world";

interface Template {
  readonly key: string;
  readonly name: string;
  readonly kind: ServiceKind;
  readonly process: string;
  readonly perHourKrw?: number;
  readonly delayHours?: number;
  readonly queue?: { perHour: number; unit: string };
  /** Also runs on the first storage array of the building. */
  readonly onStorage?: boolean;
}

const HPC: readonly Template[] = [
  {
    key: "verify",
    name: "설계 검증 큐",
    kind: "batch",
    process: "verifyd",
    delayHours: 4,
    queue: { perHour: 400, unit: "건" },
  },
  {
    key: "eda",
    name: "EDA 라이선스 서버",
    kind: "stateful",
    process: "lmgrd",
    perHourKrw: 50_000_000,
  },
  {
    key: "gateway",
    name: "스토리지 게이트웨이",
    kind: "stateful",
    process: "nfs-ganesha",
    perHourKrw: 20_000_000,
    onStorage: true,
  },
];

const FAB: readonly Template[] = [
  { key: "mes", name: "MES 연동", kind: "request", process: "mes-bridge", perHourKrw: 150_000_000 },
  {
    key: "eqlog",
    name: "설비 로그 수집",
    kind: "batch",
    process: "eqlogd",
    delayHours: 2,
    queue: { perHour: 20_000, unit: "건" },
  },
];

const OFFICE: readonly Template[] = [
  { key: "portal", name: "사내 포털", kind: "request", process: "portal", perHourKrw: 2_000_000 },
  {
    key: "logs",
    name: "로그 수집",
    kind: "batch",
    process: "logcollector",
    delayHours: 1,
    queue: { perHour: 3000, unit: "건" },
  },
];

function bundleOf(building: Entity): readonly Template[] {
  if (building.name.includes("HPC")) return HPC;
  return building.props.purpose === "fab" ? FAB : OFFICE;
}

/** Upstream power suppliers that more than one rack can share (panels and UPSes): two servers on different ones survive a feed loss. */
function feedsOf(index: BlueprintIndex, serverId: string): Set<string> {
  return new Set(
    index
      .upstream(serverId, "power")
      .filter((id) => ["power_panel", "ups", "generator"].includes(index.find(id)?.kind ?? "")),
  );
}

/** The standby server: another rack, and among those the one that shares the fewest feeds with the active server. */
function standbyFor(
  index: BlueprintIndex,
  active: Entity,
  pool: readonly Entity[],
): Entity | undefined {
  const mine = feedsOf(index, active.id);
  const shared = (e: Entity) => [...feedsOf(index, e.id)].filter((f) => mine.has(f)).length;
  return pool
    .filter((e) => e.parentId !== active.parentId)
    .sort((a, b) => shared(a) - shared(b) || a.id.localeCompare(b.id))[0];
}

/** Where a service runs on this server: its first VM, or the server itself. */
function placeOn(index: BlueprintIndex, server: Entity): string {
  return index.incoming(server.id, "runs_on")[0]?.from ?? server.id;
}

function addService(
  ctx: { entities: Entity[]; links: Link[] },
  index: BlueprintIndex,
  t: Template,
  id: string,
  name: string,
  places: { active: Entity; standby?: Entity; storage?: Entity },
): void {
  ctx.entities.push({
    id,
    kind: "service",
    name,
    props: serviceProps({
      kind: t.kind,
      process: t.process,
      ...(t.perHourKrw !== undefined ? { perHourKrw: t.perHourKrw } : {}),
      ...(t.delayHours !== undefined ? { delayHours: t.delayHours } : {}),
      ...(t.queue ? { queue: t.queue } : {}),
    }),
  });
  const on = (to: string, role: "active" | "standby") =>
    ctx.links.push({
      id: `${id}-${role}-${to}`,
      kind: "service_on",
      from: id,
      to,
      props: { role },
    });
  on(placeOn(index, places.active), "active");
  if (places.storage) on(places.storage.id, "active");
  if (places.standby) on(placeOn(index, places.standby), "standby");
  for (const l of index.outgoing(places.active.id, "network").slice(0, 2))
    ctx.links.push({ id: `${id}-via-${l.to}`, kind: "service_via", from: id, to: l.to, props: {} });
}

/** The blueprint with a bundle of services in each building that has servers to run them on. */
export function withServices(blueprint: Blueprint): Blueprint {
  const index = new BlueprintIndex(blueprint);
  const buildings = index.ofKind("building");
  const added = { entities: [] as Entity[], links: [] as Link[] };
  for (const building of buildings) {
    const servers = index.descendants(building.id).filter((e) => e.kind === "server");
    if (servers.length === 0) continue;
    const storage = index.descendants(building.id).find((e) => e.kind === "storage");
    const suffix = buildings.length > 1 ? ` (${building.name})` : "";
    bundleOf(building).forEach((t, i) => {
      const active = servers[(i * 7) % servers.length] as Entity;
      const standby = standbyFor(index, active, servers);
      addService(added, index, t, `${building.id}-svc-${t.key}`, `${t.name}${suffix}`, {
        active,
        ...(standby ? { standby } : {}),
        ...(t.onStorage && storage ? { storage } : {}),
      });
    });
  }
  if (added.entities.length === 0) return blueprint;
  return {
    ...blueprint,
    entities: [...blueprint.entities, ...added.entities],
    links: [...blueprint.links, ...added.links],
  };
}
