/**
 * The generator builds what the compute choices say (REQ-096): the containers choice lays a Kubernetes on the service's
 * VMs (a control plane of three on different hosts and racks, workers, workloads), multi-cluster lays two on hosts of
 * their own, and DRS lets the virtualisation clusters of the world move VMs by themselves.
 */

import { Catalog } from "@terrarium/core/catalog";
import { GenerateWorldBody, parseWith } from "@terrarium/core/contract";
import { Physics } from "@terrarium/core/physics";
import { DEFAULT_SHAPE, generateShaped } from "@terrarium/core/sources/worldgen";
import {
  BlueprintIndex,
  blueprintDigest,
  type Layers,
  nodeHost,
  World,
} from "@terrarium/core/world";
import { describe, expect, test } from "vitest";

const build = (compute: string, servers = 48) =>
  generateShaped({
    ...DEFAULT_SHAPE,
    servers,
    layers: { ...DEFAULT_SHAPE.layers, compute } as Layers,
  }).blueprint;

const hostServer = (index: BlueprintIndex, node: string): string => {
  const vm = nodeHost(index, node) as string;
  return index.outgoing(vm, "runs_on")[0]?.to as string;
};
const rackOf = (index: BlueprintIndex, server: string): string =>
  index.entity(server).parentId ?? "";

describe("the IAP card builds a Kubernetes on VMs [REQ-096]", () => {
  const bp = build("cmp-containers");
  const index = new BlueprintIndex(bp);

  test("the default card is the containers choice and builds a control plane of three and six workers", () => {
    expect(DEFAULT_SHAPE.layers.compute).toBe("cmp-containers");
    expect(index.ofKind("k8s_cluster")).toHaveLength(1);
    const nodes = index.ofKind("k8s_node");
    expect(nodes.filter((n) => n.props.role === "control-plane")).toHaveLength(3);
    expect(nodes.filter((n) => n.props.role === "worker")).toHaveLength(6);
    expect(nodes.every((n) => index.find(nodeHost(index, n.id) ?? "")?.kind === "vm")).toBe(true);
  });

  test("the three control-plane nodes stand on different hosts in different racks", () => {
    const cp = index.ofKind("k8s_node").filter((n) => n.props.role === "control-plane");
    const servers = cp.map((n) => hostServer(index, n.id));
    expect(new Set(servers).size).toBe(3);
    expect(new Set(servers.map((s) => rackOf(index, s))).size).toBe(3);
  });

  test("a workload for each part of the service, a batch workload nobody waits on, and the service leans on the first", () => {
    const names = index.ofKind("k8s_workload").map((w) => w.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "orchestrator",
        "domain-agents",
        "topology-graph",
        "goclaw-core",
        "batch",
      ]),
    );
    const service = index.ofKind("service")[0];
    const leans = index
      .outgoing(service?.id ?? "", "depends_on")
      .map((l) => l.to)
      .filter((id) => index.entity(id).kind === "k8s_workload");
    expect(leans).toHaveLength(4);
    expect(leans.some((id) => index.entity(id).name === "batch")).toBe(false);
  });

  test("the world starts well: the pods stand, the cluster is up, the service is healthy", () => {
    const world = World.fromBlueprint(bp, new Catalog());
    const physics = new Physics(world);
    physics.settle();
    physics.run(300);
    const pods = index
      .ofKind("k8s_workload")
      .flatMap((w) => world.stateAs(w.id, "k8s_workload").pods);
    expect(pods.length).toBeGreaterThan(8);
    expect(pods.every((p) => p.phase === "Running")).toBe(true);
    const service = index.ofKind("service")[0]?.id as string;
    expect(world.stateAs(service, "service").status).toBe("healthy");
    expect(world.stateAs("k8s-iap", "k8s_cluster")).toMatchObject({ apiUp: true, cpUp: 3 });
  });

  test("the same spec gives the same world", () => {
    expect(blueprintDigest(build("cmp-containers"))).toBe(blueprintDigest(bp));
  });

  test("the server takes the default card as it is, workload names of its parts included", () => {
    const got = parseWith(GenerateWorldBody, { shape: { ...DEFAULT_SHAPE, servers: 48 } });
    expect(got.ok, JSON.stringify(got)).toBe(true);
  });

  test("a choice without containers builds no cluster", () => {
    expect(new BlueprintIndex(build("cmp-virt-ha")).ofKind("k8s_cluster")).toHaveLength(0);
  });
});

describe("multi-cluster builds two clusters on hosts of their own [REQ-096]", () => {
  const bp = build("cmp-multicluster", 96);
  const index = new BlueprintIndex(bp);

  test("two clusters whose nodes share no host, and the service leans on both", () => {
    const clusters = index.ofKind("k8s_cluster");
    expect(clusters).toHaveLength(2);
    const hosts = clusters.map(
      (c) =>
        new Set(
          index
            .incoming(c.id, "member_of")
            .map((l) => index.find(l.from))
            .filter((e) => e?.kind === "k8s_node")
            .map((n) => hostServer(index, (n as { id: string }).id)),
        ),
    );
    expect([...(hosts[0] as Set<string>)].some((h) => (hosts[1] as Set<string>).has(h))).toBe(
      false,
    );
    const service = index.ofKind("service")[0]?.id as string;
    expect(
      index
        .outgoing(service, "depends_on")
        .filter((l) => index.entity(l.to).kind === "k8s_workload"),
    ).toHaveLength(8);
  });

  test("one cluster stopped slows the service and does not stop it", () => {
    const world = World.fromBlueprint(bp, new Catalog());
    const physics = new Physics(world);
    physics.settle();
    const service = index.ofKind("service")[0]?.id as string;
    for (const w of index
      .ofKind("k8s_workload")
      .filter(
        (x) => x.id.startsWith("k8s-iap-") && !x.id.startsWith("k8s-iap-b-") && x.name !== "batch",
      ))
      world.apply(
        {
          type: "fault.add",
          fault: { id: `f-${w.id}`, type: "k8s_pod_crashloop", target: w.id, params: {} },
        },
        "scenario",
      );
    physics.run(300);
    expect(world.stateAs(service, "service").status).toBe("degraded");
  });
});

describe("DRS lets the virtualisation clusters move VMs [REQ-096]", () => {
  test("the clusters of a world built with it carry the flag, and without it they do not", () => {
    const on = new BlueprintIndex(build("cmp-drs"));
    const off = new BlueprintIndex(build("cmp-virt-ha"));
    expect(on.ofKind("cluster").length).toBeGreaterThan(0);
    expect(on.ofKind("cluster").every((c) => c.props.drs === true)).toBe(true);
    expect(off.ofKind("cluster").some((c) => c.props.drs === true)).toBe(false);
  });
});
