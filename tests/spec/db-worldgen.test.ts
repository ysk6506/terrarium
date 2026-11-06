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
const rackOf = (bp: Blueprint, id: string): string | undefined => {
  const index = new BlueprintIndex(bp);
  const host = index.outgoing(id, "hosted_on")[0]?.to as string;
  const server = index.find(host)?.kind === "vm" ? index.outgoing(host, "runs_on")[0]?.to : host;
  return index.find(server as string)?.parentId;
};

describe("데이터베이스 칩이 세계에 클러스터를 깐다 [REQ-095]", () => {
  const SHAPES: ReadonlyArray<readonly [string, string, number, string[]]> = [
    ["db-single", "single", 1, ["primary"]],
    ["db-active-passive", "active_passive", 2, ["primary", "standby"]],
    ["db-shared-aa", "shared_aa", 3, ["primary", "primary", "primary"]],
    ["db-primary-secondary", "replicated", 2, ["primary", "secondary"]],
    ["db-auto-failover", "auto_failover", 3, ["primary", "secondary", "secondary"]],
  ];

  for (const [chip, shape, count, roles] of SHAPES) {
    it(`${chip}: ${shape} 클러스터, 인스턴스 ${count}개, 서로 다른 랙, 서비스가 기댄다`, () => {
      const bp = build({ database: chip });
      expect(hasErrors(validateBlueprint(bp, catalog))).toBe(false);
      const [cluster] = kinds(bp, "db_cluster");
      expect(cluster?.props.shape).toBe(shape);
      const members = kinds(bp, "db_instance");
      expect(members.map((m) => m.props.role)).toEqual(roles);
      const racks = new Set(members.map((m) => rackOf(bp, m.id)));
      expect(racks.size).toBe(count);
      const [svc] = kinds(bp, "service");
      expect(
        bp.links.some((l) => l.kind === "depends_on" && l.from === svc?.id && l.to === cluster?.id),
      ).toBe(true);
    });
  }

  it("공유 디스크 모양은 저장소 칸이 로컬이어도 풀을 만들어 인스턴스가 함께 쓴다", () => {
    const bp = build({ database: "db-shared-aa", storage: "sto-raid-backup" });
    const [pool] = kinds(bp, "storage_pool");
    expect(pool?.props.mode).toBe("dual");
    const onPool = bp.links.filter((l) => l.kind === "stored_on" && l.to === pool?.id);
    expect(onPool).toHaveLength(3);
    expect(kinds(bp, "storage_controller")).toHaveLength(2);
  });

  it("복제 모양은 저장소가 로컬이면 풀이 없다", () => {
    expect(kinds(build({ storage: "sto-local" }), "storage_pool")).toHaveLength(0);
  });

  it("베어메탈이면 인스턴스가 서버 위에 직접 선다", () => {
    const bp = build({ compute: "cmp-bare", database: "db-auto-failover" });
    const index = new BlueprintIndex(bp);
    for (const m of kinds(bp, "db_instance"))
      expect(index.find(index.outgoing(m.id, "hosted_on")[0]?.to as string)?.kind).toBe("server");
  });

  it("점선 칩은 가장 가까운 칩 모양으로 짓는다", () => {
    const a = build({ database: "db-distributed-sql" });
    const b = build({ database: "db-auto-failover" });
    expect(kinds(a, "db_instance")).toHaveLength(kinds(b, "db_instance").length);
  });
});

describe("스토리지 칩이 풀을 깐다 [REQ-095]", () => {
  it("듀얼 컨트롤러 + 멀티패스: 컨트롤러 둘, 호스트가 알아서 경로를 바꾼다", () => {
    const bp = build({ storage: "sto-dual-controller" });
    const [pool] = kinds(bp, "storage_pool");
    expect(pool?.props).toMatchObject({ mode: "dual", multipath: true });
    expect(kinds(bp, "storage_controller")).toHaveLength(2);
  });

  it("공유 SAN·NAS: 컨트롤러 둘이지만 경로는 사람이 바꾼다", () => {
    const [pool] = kinds(build({ storage: "sto-shared" }), "storage_pool");
    expect(pool?.props).toMatchObject({ mode: "dual", multipath: false });
  });

  it("분산 스토리지: 노드 넷이 서로 다른 랙에 서고 세 벌을 둔다", () => {
    const bp = build({ storage: "sto-distributed" });
    const [pool] = kinds(bp, "storage_pool");
    expect(pool?.props).toMatchObject({ mode: "distributed", copies: 3 });
    const nodes = bp.links.filter((l) => l.kind === "backed_by" && l.from === pool?.id);
    expect(nodes).toHaveLength(4);
    const index = new BlueprintIndex(bp);
    expect(new Set(nodes.map((l) => index.find(l.to)?.parentId)).size).toBe(4);
    expect(hasErrors(validateBlueprint(bp, catalog))).toBe(false);
  });
});

describe("깔린 세계가 돌아간다 [REQ-095]", () => {
  it("모든 칩 조합에서 서비스가 멀쩡하게 시작한다", () => {
    for (const database of ["db-single", "db-active-passive", "db-shared-aa", "db-auto-failover"]) {
      for (const storage of ["sto-shared", "sto-dual-controller", "sto-distributed"]) {
        const world = World.fromBlueprint(build({ database, storage }), catalog);
        const physics = new Physics(world);
        physics.settle();
        physics.run(120);
        for (const s of world.index.ofKind("service"))
          expect([database, storage, world.stateAs(s.id, "service").status]).toEqual([
            database,
            storage,
            "healthy",
          ]);
      }
    }
  });
});
