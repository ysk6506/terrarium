/**
 * The overlay and cloud-native network of a "서비스부터" world (REQ-097, ADR-0107 item 6): on the leaf-spine a controller pair,
 * a VTEP on every leaf, a segment for every service (carried by the VTEPs of the leaves its nodes stand under), and a virtual
 * firewall in each service's way; for the cloud-native choice also a CNI plug-in on every node, a network policy and an
 * ingress for each service. The controllers stand on servers in different racks, so the pair is a pair in the blueprint too.
 */
import {
  type BlueprintIndex,
  type Entity,
  leafOfServer,
  type OverlayBuild,
} from "@terrarium/core/world";
import { type Laying, link, slugOf } from "./shaped-db";

/** A service the overlay is laid for, and where its nodes stand (VMs, or servers when there are none). */
export interface PlacedService {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly nodes: readonly string[];
}

/** The server a node stands on: itself, or the machine its VM runs on. */
function serverOfNode(into: Laying, index: BlueprintIndex, node: string): string | undefined {
  if (index.find(node)?.kind === "server") return node;
  return into.links.find((l) => l.kind === "runs_on" && l.from === node)?.to;
}

/** Every leaf switch: a switch with a server or storage array cabled to it. */
function leavesOf(index: BlueprintIndex): Entity[] {
  return index
    .ofKind("switch")
    .filter((sw) =>
      index.incoming(sw.id, "network").some((l) => {
        const kind = index.find(l.from)?.kind;
        return kind === "server" || kind === "storage";
      }),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

function layControllers(
  into: Laying,
  leaves: readonly Entity[],
  build: OverlayBuild,
  hosts: readonly Entity[],
): void {
  for (let i = 0; i < build.controllers; i++) {
    const host = hosts[i];
    if (!host) return;
    const id = `sdn-ctl-${i + 1}`;
    into.entities.push({
      id,
      kind: "sdn_controller",
      name: `SDN 컨트롤러 ${i + 1}`,
      props: { role: i === 0 ? "active" : "standby" },
    });
    link(into, "hosted_on", id, host.id);
    for (const leaf of leaves) link(into, "controls", id, leaf.id);
  }
}

function layVteps(into: Laying, leaves: readonly Entity[]): void {
  for (const leaf of leaves) {
    const id = `vtep-${leaf.id}`;
    into.entities.push({ id, kind: "vtep", name: `VTEP ${leaf.name}`, props: {} });
    link(into, "hosted_on", id, leaf.id);
  }
}

function laySegment(into: Laying, index: BlueprintIndex, svc: PlacedService, vni: number): void {
  const seg = `seg-${slugOf(svc.id)}`;
  into.entities.push({
    id: seg,
    kind: "overlay_segment",
    name: `${svc.name} 세그먼트`,
    props: { vni, tenant: svc.name },
  });
  const leaves = new Set<string>();
  for (const node of svc.nodes) {
    const server = serverOfNode(into, index, node);
    const leaf = server ? leafOfServer(index, server) : undefined;
    if (leaf) leaves.add(leaf);
  }
  for (const leaf of [...leaves].sort()) link(into, "member_of", `vtep-${leaf}`, seg);
  link(into, "depends_on", svc.id, seg);
}

function layFirewall(into: Laying, svc: PlacedService, host: string | undefined): void {
  if (!host) return;
  const id = `nfv-fw-${slugOf(svc.id)}`;
  into.entities.push({ id, kind: "nfv_function", name: `${svc.name} 가상 방화벽`, props: {} });
  link(into, "hosted_on", id, host);
  link(into, "depends_on", svc.id, id);
}

function layCloudNative(
  into: Laying,
  svc: PlacedService,
  previous: PlacedService | undefined,
): void {
  const slug = slugOf(svc.id);
  for (const [i, node] of svc.nodes.entries()) {
    const id = `cni-${slug}-${i + 1}`;
    into.entities.push({
      id,
      kind: "cni",
      name: `CNI ${svc.name} ${i + 1}`,
      props: { plugin: "calico" },
    });
    link(into, "hosted_on", id, node);
  }
  const policy = `np-${slug}`;
  into.entities.push({
    id: policy,
    kind: "network_policy",
    name: `${svc.name} 정책`,
    props: { ns: slug, rule: "allow", ...(previous ? { from: previous.id } : {}) },
  });
  link(into, "applies_to", policy, svc.id);
  if (svc.kind !== "request") return;
  const ingress = `ingress-${slug}`;
  into.entities.push({ id: ingress, kind: "ingress", name: `${svc.name} 인그레스`, props: {} });
  if (svc.nodes[0]) link(into, "hosted_on", ingress, svc.nodes[0]);
  link(into, "depends_on", svc.id, ingress);
}

export interface OverlayPlace {
  readonly index: BlueprintIndex;
  readonly build: OverlayBuild;
  /** Servers for the controllers, in different racks. */
  readonly controllerHosts: readonly Entity[];
  /** Where each service's firewall stands (a VM or a server), by service id. */
  readonly firewallHosts: ReadonlyMap<string, string>;
}

/** Everything the overlay and the cloud-native choice add to a world. */
export function layOverlay(
  into: Laying,
  place: OverlayPlace,
  services: readonly PlacedService[],
): void {
  const leaves = leavesOf(place.index);
  if (leaves.length === 0) return;
  layControllers(into, leaves, place.build, place.controllerHosts);
  layVteps(into, leaves);
  services.forEach((svc, i) => {
    laySegment(into, place.index, svc, 20_000 + i);
    if (place.build.nfv) layFirewall(into, svc, place.firewallHosts.get(svc.id));
    if (place.build.cloudNative) layCloudNative(into, svc, services[i - 1]);
  });
}
