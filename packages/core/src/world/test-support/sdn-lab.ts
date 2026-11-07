/**
 * The two-rack network lab with an SDN overlay on it (REQ-097), for tests of the overlay and the cloud-native layer:
 *
 *   svc-portal   request   on vm-web (srv-a1, rack a) and vm-web2 (srv-b1, rack b)   segment seg-portal, firewall nfv-fw
 *   svc-license  stateful  on srv-a2 (rack a)                                          segment seg-license
 *
 * Leaves tor-a and tor-b each have a VTEP; both uplink to sp1 and sp2. Controllers stand on srv-a2 and srv-b1 (`controllers: 1`
 * keeps only the active one). With `cloudNative` the nodes get a CNI plug-in, svc-license a policy that lets svc-portal
 * call it, and svc-portal an ingress.
 */
import type { Blueprint, Entity, Link } from "../blueprint";
import { serviceProps } from "../service";
import { networkLab } from "./net-lab";

export interface SdnLabOptions {
  readonly controllers?: 1 | 2;
  readonly cloudNative?: boolean;
  /** The portal calls the license server (REQ-100): a policy that guards the license server then reaches the portal. */
  readonly calls?: boolean;
}

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

function overlay(controllers: number): { entities: Entity[]; links: Link[] } {
  const entities: Entity[] = [
    ent("vtep-tor-a", "vtep", "VTEP tor-a"),
    ent("vtep-tor-b", "vtep", "VTEP tor-b"),
    ent("seg-portal", "overlay_segment", "포털 세그먼트", { vni: 20000 }),
    ent("seg-license", "overlay_segment", "라이선스 세그먼트", { vni: 20001 }),
    ent("nfv-fw", "nfv_function", "포털 방화벽"),
  ];
  const links: Link[] = [
    link("vtep-a-on", "hosted_on", "vtep-tor-a", "tor-a"),
    link("vtep-b-on", "hosted_on", "vtep-tor-b", "tor-b"),
    link("pa-seg", "member_of", "vtep-tor-a", "seg-portal"),
    link("pb-seg", "member_of", "vtep-tor-b", "seg-portal"),
    link("la-seg", "member_of", "vtep-tor-a", "seg-license"),
    link("portal-seg", "depends_on", "svc-portal", "seg-portal"),
    link("license-seg", "depends_on", "svc-license", "seg-license"),
    link("fw-on", "hosted_on", "nfv-fw", "vm-web"),
    link("portal-fw", "depends_on", "svc-portal", "nfv-fw"),
  ];
  const hosts = ["srv-a2", "srv-b1"].slice(0, controllers);
  hosts.forEach((host, i) => {
    const id = `sdn-ctl-${i + 1}`;
    entities.push(
      ent(id, "sdn_controller", `SDN 컨트롤러 ${i + 1}`, { role: i === 0 ? "active" : "standby" }),
    );
    links.push(link(`${id}-on`, "hosted_on", id, host));
    for (const leaf of ["tor-a", "tor-b"])
      links.push(link(`${id}-ctl-${leaf}`, "controls", id, leaf));
  });
  return { entities, links };
}

function cloudNative(): { entities: Entity[]; links: Link[] } {
  return {
    entities: [
      ent("cni-1", "cni", "CNI vm-web"),
      ent("cni-2", "cni", "CNI vm-web2"),
      ent("np-license", "network_policy", "라이선스 정책", {
        ns: "license",
        rule: "allow",
        from: "svc-portal",
      }),
      ent("ingress-portal", "ingress", "포털 인그레스"),
    ],
    links: [
      link("cni-1-on", "hosted_on", "cni-1", "vm-web"),
      link("cni-2-on", "hosted_on", "cni-2", "vm-web2"),
      link("np-license-on", "applies_to", "np-license", "svc-license"),
      link("ingress-on", "hosted_on", "ingress-portal", "vm-web"),
      link("portal-ingress", "depends_on", "svc-portal", "ingress-portal"),
    ],
  };
}

export function sdnLab(options: SdnLabOptions = {}): Blueprint {
  const base = networkLab();
  const parts = overlay(options.controllers ?? 2);
  const cn = options.cloudNative ? cloudNative() : { entities: [], links: [] };
  const entities: Entity[] = [
    ent("vm-web2", "vm", "vm-web2", { cpuCount: 8, memoryGiB: 32, cpuDemand: 0.2 }),
    {
      ...ent(
        "svc-portal",
        "service",
        "사내 포털",
        serviceProps({ kind: "request", process: "portal", perHourKrw: 2_000_000 }),
      ),
    },
    ent(
      "svc-license",
      "service",
      "EDA 라이선스 서버",
      serviceProps({ kind: "stateful", process: "licd", perHourKrw: 3_000_000 }),
    ),
    ...parts.entities,
    ...cn.entities,
  ];
  const links: Link[] = [
    link("web2-run", "runs_on", "vm-web2", "srv-b1"),
    link("portal-on-1", "service_on", "svc-portal", "vm-web", { role: "active" }),
    link("portal-on-2", "service_on", "svc-portal", "vm-web2", { role: "active" }),
    link("license-on", "service_on", "svc-license", "srv-a2", { role: "active" }),
    ...(options.calls
      ? [link("call-portal-license", "calls", "svc-portal", "svc-license", {})]
      : []),
    ...parts.links,
    ...cn.links,
  ];
  return {
    ...base,
    id: "sdn-lab",
    entities: [...base.entities, ...entities],
    links: [...base.links, ...links],
  };
}
