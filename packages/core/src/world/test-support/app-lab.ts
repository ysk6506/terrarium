/**
 * The two-rack network lab with an application layer on it (REQ-100), for tests of the balancer, the breakers, the mesh and
 * the regions:
 *
 *   svc-portal   request   on vm-web, vm-web3 (srv-a1) and vm-web2, vm-web4 (srv-b1)   calls svc-license (critical)
 *   svc-license  stateful  on srv-a2
 *
 * `level` is how far the application choice goes, each keeping what the one before it had: `lb` a replica for each place of
 * the portal and a balancer; `stateless` adds a session store; `microservices` a circuit breaker on the call; `mesh` a sidecar
 * next to every replica and a control plane; `multiregion` two regions (A: the replicas on srv-a1, B: on srv-b1) behind a
 * global balancer.
 */
import type { Blueprint, Entity, Link } from "../blueprint";
import { serviceProps } from "../service";
import { networkLab } from "./net-lab";

export type AppLevel = "lb" | "stateless" | "microservices" | "mesh" | "multiregion";

export interface AppLabOptions {
  readonly level?: AppLevel;
}

const ORDER: readonly AppLevel[] = ["lb", "stateless", "microservices", "mesh", "multiregion"];

const link = (id: string, kind: Link["kind"], from: string, to: string, props = {}): Link => ({
  id,
  kind,
  from,
  to,
  props,
});

const ent = (id: string, kind: Entity["kind"], name: string, props = {}): Entity => ({
  id,
  kind,
  name,
  props,
});

const VMS: ReadonlyArray<readonly [string, string, "a" | "b"]> = [
  ["vm-web", "srv-a1", "a"],
  ["vm-web2", "srv-b1", "b"],
  ["vm-web3", "srv-a1", "a"],
  ["vm-web4", "srv-b1", "b"],
];

export function appLab(options: AppLabOptions = {}): Blueprint {
  const level = ORDER.indexOf(options.level ?? "lb");
  const base = networkLab();
  const regions = level >= 4;
  const entities: Entity[] = [
    ...VMS.slice(1).map(([id]) =>
      ent(id, "vm", id, { cpuCount: 8, memoryGiB: 32, cpuDemand: 0.2 }),
    ),
    ent(
      "svc-portal",
      "service",
      "사내 포털",
      serviceProps({ kind: "request", process: "portal", perHourKrw: 2_000_000 }),
    ),
    ent(
      "svc-license",
      "service",
      "EDA 라이선스 서버",
      serviceProps({ kind: "stateful", process: "licd", perHourKrw: 3_000_000 }),
    ),
    ent("lb-portal", "load_balancer", "포털 로드 밸런서", {
      scope: regions ? "global" : "service",
    }),
  ];
  const links: Link[] = [
    ...VMS.slice(1).map(([id, host]) => link(`${id}-run`, "runs_on", id, host)),
    ...VMS.map(([id], i) =>
      link(`portal-on-${i + 1}`, "service_on", "svc-portal", id, { role: "active" }),
    ),
    link("license-on", "service_on", "svc-license", "srv-a2", { role: "active" }),
    link("lb-on", "hosted_on", "lb-portal", "vm-web"),
    link("portal-lb", "depends_on", "svc-portal", "lb-portal"),
    link("call-portal-license", "calls", "svc-portal", "svc-license", { critical: true }),
  ];
  VMS.forEach(([vm, , region], i) => {
    const id = `app-portal-${i + 1}`;
    entities.push(ent(id, "app_instance", `포털 인스턴스 ${i + 1}`));
    links.push(
      link(`${id}-on`, "hosted_on", id, vm),
      link(`${id}-svc`, "member_of", id, "svc-portal"),
    );
    if (regions) links.push(link(`${id}-reg`, "member_of", id, `region-${region}`));
    if (level >= 3) {
      entities.push(ent(`sc-${i + 1}`, "mesh_sidecar", `포털 사이드카 ${i + 1}`));
      links.push(
        link(`sc-${i + 1}-on`, "hosted_on", `sc-${i + 1}`, id),
        link(`sc-${i + 1}-ctl`, "member_of", `sc-${i + 1}`, "mesh-control"),
      );
    }
  });
  if (level >= 1) {
    entities.push(ent("sess-portal", "session_store", "포털 세션 저장소"));
    links.push(
      link("sess-on", "hosted_on", "sess-portal", "vm-web3"),
      link("portal-sess", "depends_on", "svc-portal", "sess-portal"),
    );
  }
  if (level >= 2)
    entities.push(
      ent("cb-portal-license", "circuit_breaker", "서킷 브레이커 포털→라이선스", {
        link: "call-portal-license",
      }),
    );
  if (level >= 3) {
    entities.push(ent("mesh-control", "mesh_control", "메시 컨트롤 플레인"));
    links.push(link("mesh-on", "hosted_on", "mesh-control", "vm-web3"));
  }
  if (regions) {
    entities.push(
      ent("region-a", "region", "리전 A", { primary: true }),
      ent("region-b", "region", "리전 B", { primary: false }),
    );
    links.push(
      link("reg-a-lb", "member_of", "region-a", "lb-portal"),
      link("reg-b-lb", "member_of", "region-b", "lb-portal"),
    );
  }
  return {
    ...base,
    id: "app-lab",
    entities: [...base.entities, ...entities],
    links: [...base.links, ...links],
  };
}
