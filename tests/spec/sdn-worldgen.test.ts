import { Catalog } from "@terrarium/core/catalog";
import { Physics } from "@terrarium/core/physics";
import { DEFAULT_SHAPE, generateShaped, type ShapeSpec } from "@terrarium/core/sources/worldgen";
import {
  type Blueprint,
  BlueprintIndex,
  hasErrors,
  type Layers,
  validateBlueprint,
  World,
} from "@terrarium/core/world";
import { describe, expect, it } from "vitest";

const catalog = new Catalog();

const withLayers = (layers: Partial<Layers>, servers = 120): ShapeSpec => ({
  ...DEFAULT_SHAPE,
  servers,
  layers: { ...DEFAULT_SHAPE.layers, ...layers },
});

const build = (layers: Partial<Layers>) => generateShaped(withLayers(layers)).blueprint;
const kinds = (bp: Blueprint, kind: string) => bp.entities.filter((e) => e.kind === kind);

describe("SDN 칩이 리프-스파인 위에 오버레이를 깐다 [REQ-097]", () => {
  it("net-sdn: 컨트롤러 둘(서로 다른 랙), 리프마다 VTEP, 서비스마다 세그먼트와 가상 방화벽", () => {
    const bp = build({ network: "net-sdn" });
    expect(hasErrors(validateBlueprint(bp, catalog))).toBe(false);
    const index = new BlueprintIndex(bp);
    const ctl = kinds(bp, "sdn_controller");
    expect(ctl.map((c) => c.props.role)).toEqual(["active", "standby"]);
    const racks = ctl.map((c) => {
      const host = index.outgoing(c.id, "hosted_on")[0]?.to as string;
      return index.find(host)?.parentId;
    });
    expect(new Set(racks).size).toBe(2);
    const leaves = bp.entities.filter(
      (e) =>
        e.kind === "switch" &&
        index
          .incoming(e.id, "network")
          .some((l) => ["server", "storage"].includes(index.find(l.from)?.kind ?? "")),
    );
    expect(kinds(bp, "vtep")).toHaveLength(leaves.length);
    const services = kinds(bp, "service");
    expect(kinds(bp, "overlay_segment")).toHaveLength(services.length);
    expect(kinds(bp, "nfv_function")).toHaveLength(services.length);
    expect(kinds(bp, "cni")).toHaveLength(0);
    for (const s of services)
      expect(
        bp.links.some(
          (l) =>
            l.kind === "depends_on" &&
            l.from === s.id &&
            index.find(l.to)?.kind === "overlay_segment",
        ),
      ).toBe(true);
  });

  it("net-cloud-native: 거기에 노드마다 CNI, 서비스마다 정책, 요청 서비스마다 인그레스", () => {
    const bp = build({ network: "net-cloud-native" });
    expect(hasErrors(validateBlueprint(bp, catalog))).toBe(false);
    expect(kinds(bp, "sdn_controller")).toHaveLength(2);
    expect(kinds(bp, "cni").length).toBeGreaterThan(0);
    expect(kinds(bp, "network_policy")).toHaveLength(kinds(bp, "service").length);
    const requests = kinds(bp, "service").filter((s) => s.props.serviceKind === "request");
    expect(kinds(bp, "ingress")).toHaveLength(requests.length);
  });

  it("리프-스파인 이하의 칩에는 오버레이가 없다", () => {
    for (const network of ["net-legacy", "net-three-tier", "net-leaf-spine"])
      expect(kinds(build({ network }), "vtep")).toHaveLength(0);
  });

  it("같은 구성과 번호면 같은 세계다", () => {
    expect(JSON.stringify(build({ network: "net-sdn" }))).toBe(
      JSON.stringify(build({ network: "net-sdn" })),
    );
  });
});

describe("깔린 세계가 돌아간다 [REQ-097]", () => {
  it("두 칩 모두에서 서비스가 멀쩡하게 시작한다", () => {
    for (const network of ["net-sdn", "net-cloud-native"]) {
      const world = World.fromBlueprint(build({ network }), catalog);
      const physics = new Physics(world);
      physics.settle();
      physics.run(300);
      for (const s of world.index.ofKind("service"))
        expect([network, world.stateAs(s.id, "service").status]).toEqual([network, "healthy"]);
      expect(
        world.alarms().filter((a) => a.code.startsWith("sdn_") || a.code.startsWith("evpn")),
      ).toEqual([]);
    }
  });
});
