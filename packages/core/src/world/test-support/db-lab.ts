/**
 * The sample hall with a database under two services (REQ-095), for tests of the database and storage-HA layers:
 *
 *   svc-web      request   on vm-web   leans on db-main
 *   svc-license  stateful  on srv-a2   leans on db-main
 *
 * The cluster `db-main` is built in the shape asked for, on VMs of the three servers (db-1 on srv-a1, db-2 on srv-a2,
 * db-3 on srv-b1). Its data lives in a storage pool when the storage is asked for: `dual` (two controllers, the hosts
 * switch paths by hand), `multipath` (two controllers, the hosts switch by themselves) or `distributed` (four nodes,
 * three copies).
 */
import type { Blueprint, Entity, Link } from "../blueprint";
import { type DbShape, dbClusterProps, poolProps } from "../db";
import { serviceProps } from "../service";
import { sampleBlueprint } from "./sample";

export type LabStorage = "none" | "dual" | "multipath" | "distributed";

export interface DbLabOptions {
  readonly shape: DbShape;
  readonly storage?: LabStorage;
  /** Seconds the cluster waits before it promotes by itself (auto failover only). */
  readonly detectS?: number;
}

const INSTANCES: Readonly<Record<DbShape, ReadonlyArray<readonly [string, string]>>> = {
  single: [["db-1", "primary"]],
  active_passive: [
    ["db-1", "primary"],
    ["db-2", "standby"],
  ],
  shared_aa: [
    ["db-1", "primary"],
    ["db-2", "primary"],
    ["db-3", "primary"],
  ],
  replicated: [
    ["db-1", "primary"],
    ["db-2", "secondary"],
  ],
  auto_failover: [
    ["db-1", "primary"],
    ["db-2", "secondary"],
    ["db-3", "secondary"],
  ],
};

const HOSTS = ["srv-a1", "srv-a2", "srv-b1"] as const;

const link = (id: string, kind: Link["kind"], from: string, to: string, props = {}): Link => ({
  id,
  kind,
  from,
  to,
  props,
});

function storageParts(storage: LabStorage): { entities: Entity[]; links: Link[] } {
  if (storage === "none") return { entities: [], links: [] };
  const entities: Entity[] = [];
  const links: Link[] = [];
  const distributed = storage === "distributed";
  entities.push({
    id: "pool-db",
    kind: "storage_pool",
    name: "풀-DB",
    props: poolProps(
      distributed
        ? { mode: "distributed", copies: 3, rebuildS: 900 }
        : { mode: "dual", multipath: storage === "multipath" },
    ),
  });
  links.push(link("pool-backed-b", "backed_by", "pool-db", "stor-b"));
  if (distributed) {
    for (const [i, u] of [22, 24, 26].entries()) {
      const id = `stor-c${i + 1}`;
      entities.push({
        id,
        kind: "storage",
        name: id,
        parentId: "rack-b",
        modelId: "stor-2u-24bay",
        placement: { type: "unit", u },
        props: {},
      });
      links.push(
        link(`pw-${id}`, "power", id, "pdu-b"),
        link(`nw-${id}`, "network", id, "tor-a", {
          fromPort: "eth0",
          toPort: `Ethernet${i + 8}/1`,
        }),
        link(`pool-backed-${id}`, "backed_by", "pool-db", id),
      );
    }
    return { entities, links };
  }
  for (const c of ["ctl-a", "ctl-b"]) {
    entities.push({ id: c, kind: "storage_controller", name: c, props: {} });
    links.push(
      link(`${c}-on`, "hosted_on", c, "stor-b"),
      link(`${c}-in`, "member_of", c, "pool-db"),
    );
  }
  return { entities, links };
}

export function dbLab(options: DbLabOptions): Blueprint {
  const base = sampleBlueprint();
  const { shape } = options;
  const storage = options.storage ?? "none";
  const members = INSTANCES[shape];
  const entities: Entity[] = [
    {
      id: "db-main",
      kind: "db_cluster",
      name: "DB 클러스터",
      props: dbClusterProps({
        shape,
        failover: shape === "auto_failover" || shape === "active_passive" ? "auto" : "manual",
        ...(options.detectS ? { detectS: options.detectS } : {}),
      }),
    },
    ...members.map(
      ([id, role]): Entity => ({
        id,
        kind: "db_instance",
        name: id,
        props: { role },
      }),
    ),
    ...members.map(
      ([id]): Entity => ({
        id: `vm-${id}`,
        kind: "vm",
        name: `vm-${id}`,
        props: { cpuCount: 8, memoryGiB: 32, cpuDemand: 0.2 },
      }),
    ),
    ...(["svc-web", "svc-license"] as const).map(
      (id): Entity => ({
        id,
        kind: "service",
        name: id === "svc-web" ? "사내 포털" : "EDA 라이선스 서버",
        props: serviceProps({
          kind: id === "svc-web" ? "request" : "stateful",
          process: id === "svc-web" ? "portal" : "licd",
          perHourKrw: 2_000_000,
        }),
      }),
    ),
  ];
  const parts = storageParts(storage);
  const links: Link[] = [
    ...members.flatMap(([id], i): Link[] => [
      link(`${id}-in`, "member_of", id, "db-main"),
      link(`${id}-on`, "hosted_on", id, `vm-${id}`),
      link(`vm-${id}-run`, "runs_on", `vm-${id}`, HOSTS[i] as string),
      link(`vm-${id}-ds`, "stored_on", `vm-${id}`, "ds1"),
      ...(storage === "none" ? [] : [link(`${id}-pool`, "stored_on", id, "pool-db")]),
    ]),
    link("web-on", "service_on", "svc-web", "vm-web", { role: "active" }),
    link("lic-on", "service_on", "svc-license", "srv-a2", { role: "active" }),
    link("web-db", "depends_on", "svc-web", "db-main"),
    link("lic-db", "depends_on", "svc-license", "db-main"),
    link("web-via", "service_via", "svc-web", "tor-a"),
    link("lic-via", "service_via", "svc-license", "tor-a"),
    ...parts.links,
  ];
  return {
    ...base,
    id: "db-lab",
    entities: [...base.entities, ...entities, ...parts.entities],
    links: [...base.links, ...links],
  };
}
