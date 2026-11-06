/**
 * The SDN overlay and cloud-native network layers (REQ-097, ADR-0107 item 6, docs/design-docs/sdn-network-layer.md).
 *
 * Over the leaf-spine underlay a controller pair (one active, one standby) pushes the overlay's configuration to the
 * switches; every leaf has a VTEP (the end of the VXLAN tunnels) that keeps a BGP EVPN session with the spines; an
 * overlay segment (a VXLAN network, VNI) is the set of VTEPs that carry one service's traffic; a virtual network
 * function (a firewall) can stand in a service's way. In the cloud-native layer every node has a CNI plugin, network
 * policies allow or block traffic between services, and an ingress is the door from outside. Services lean on
 * a segment, an ingress or a function with `depends_on`, a policy `applies_to` the service it guards.
 * Settings are props; the state of each is kept by physics (physics/sdn.ts); health is read in sdn-health.ts.
 */
import type { Entity } from "./blueprint";
import type { BlueprintIndex } from "./graph";

/** Seconds the standby controller needs to see the active one gone before it takes over. */
export const SDN_DETECT_S = 30;
/** Seconds an EVPN session needs to come back after what broke it is gone (the BGP timers). */
export const EVPN_REESTABLISH_S = 90;
/** Seconds an ingress controller needs to come up after a restart. */
export const INGRESS_RESTART_S = 20;
/** The revision of the configuration the active controller holds; a VTEP that missed the last push is one behind. */
export const SDN_REVISION = 42;
/** The process of the CNI plugin, SDN controller and ingress controller on a host, as `systemctl` names them. */
export const CNI_PROCESS = "calico-node";
export const SDN_PROCESS = "sdn-controller";
export const INGRESS_PROCESS = "nginx-ingress";

export type PolicyRule = "allow" | "deny";

export interface SdnControllerDef {
  /** The role it starts in. */
  readonly role: "active" | "standby";
  readonly detectS: number;
}

const num = (props: Entity["props"], key: string): number | undefined =>
  typeof props[key] === "number" ? (props[key] as number) : undefined;

export const sdnControllerDef = (entity: Entity): SdnControllerDef => ({
  role: entity.props.role === "standby" ? "standby" : "active",
  detectS: num(entity.props, "detectS") ?? SDN_DETECT_S,
});

export const policyRuleOf = (entity: Entity): PolicyRule =>
  entity.props.rule === "deny" ? "deny" : "allow";

const byId = (a: { id: string }, b: { id: string }): number => a.id.localeCompare(b.id);

const kindOf = (index: BlueprintIndex, kind: Entity["kind"], ids: readonly string[]): Entity[] =>
  ids
    .map((id) => index.find(id))
    .filter((e): e is Entity => e?.kind === kind)
    .sort(byId);

/** Every SDN controller of the world, by id. */
export const sdnControllers = (index: BlueprintIndex): Entity[] =>
  [...index.ofKind("sdn_controller")].sort(byId);

/** The switch a VTEP stands on. */
export const switchOfVtep = (index: BlueprintIndex, vtepId: string): string | undefined =>
  index.outgoing(vtepId, "hosted_on")[0]?.to;

/** The VTEP of a switch, if it has one. */
export const vtepOfSwitch = (index: BlueprintIndex, switchId: string): Entity | undefined =>
  kindOf(
    index,
    "vtep",
    index.incoming(switchId, "hosted_on").map((l) => l.from),
  )[0];

/** The segments a VTEP carries, by id. */
export const segmentsOfVtep = (index: BlueprintIndex, vtepId: string): Entity[] =>
  kindOf(
    index,
    "overlay_segment",
    index.outgoing(vtepId, "member_of").map((l) => l.to),
  );

/** The VTEPs that carry a segment, by id. */
export const vtepsOfSegment = (index: BlueprintIndex, segmentId: string): Entity[] =>
  kindOf(
    index,
    "vtep",
    index.incoming(segmentId, "member_of").map((l) => l.from),
  );

/** What a service leans on in the overlay and the cloud-native layer (`depends_on`), by kind. */
export function sdnDependencies(index: BlueprintIndex, serviceId: string): Entity[] {
  return index
    .outgoing(serviceId, "depends_on")
    .map((l) => index.find(l.to))
    .filter(
      (e): e is Entity =>
        e?.kind === "overlay_segment" || e?.kind === "ingress" || e?.kind === "nfv_function",
    )
    .sort(byId);
}

/** The policies that guard a service, by id. */
export const policiesOf = (index: BlueprintIndex, serviceId: string): Entity[] =>
  kindOf(
    index,
    "network_policy",
    index.incoming(serviceId, "applies_to").map((l) => l.from),
  );

/** The services that lean on a segment, an ingress or a function, by id. */
export const servicesLeaningOn = (index: BlueprintIndex, id: string): Entity[] =>
  kindOf(
    index,
    "service",
    index.incoming(id, "depends_on").map((l) => l.from),
  );

/** The CNI plugin of a node (a server or VM), if it has one. */
export const cniOfHost = (index: BlueprintIndex, hostId: string): Entity | undefined =>
  kindOf(
    index,
    "cni",
    index.incoming(hostId, "hosted_on").map((l) => l.from),
  )[0];

/** The leaf switch a server is cabled to first. */
export const leafOfServer = (index: BlueprintIndex, serverId: string): string | undefined =>
  index
    .outgoing(serverId, "network")
    .map((l) => l.to)
    .find((to) => index.find(to)?.kind === "switch");

/** The server under a host: the host itself, or the machine a VM runs on (where it was moved to is physics' business). */
export const serverUnder = (index: BlueprintIndex, hostId: string): string | undefined =>
  index.find(hostId)?.kind === "vm" ? index.outgoing(hostId, "runs_on")[0]?.to : hostId;
