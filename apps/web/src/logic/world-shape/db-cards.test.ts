import { problemName } from "@terrarium/core/scenario";
import { DEFAULT_SHAPE } from "@terrarium/core/sources/worldgen";
import { chipById, type Layers } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { cardOf } from "./ladders";
import { shapeView } from "./shape-view";

const MODELED = [
  "sto-shared",
  "sto-dual-controller",
  "sto-distributed",
  "db-single",
  "db-active-passive",
  "db-shared-aa",
  "db-primary-secondary",
  "db-auto-failover",
  "sto-geo",
  "db-distributed-sql",
  "db-managed-multiaz",
];

const viewWith = (layers: Partial<Layers>) =>
  shapeView({ ...DEFAULT_SHAPE, layers: { ...DEFAULT_SHAPE.layers, ...layers } });

describe("데이터베이스와 스토리지 칩의 카드는 코어의 고장 목록과 같다 [REQ-095]", () => {
  for (const id of MODELED) {
    test(`${id}: 카드의 '생기는 고장'이 멈추는 고장과 느려지는 고장을 이름으로 푼 것이다`, () => {
      const chip = chipById(id);
      expect(chip?.modeled).toBe(true);
      const names = [...(chip?.stops ?? []), ...(chip?.slows ?? [])].map(problemName);
      expect(names.length).toBeGreaterThan(0);
      expect(cardOf(id)?.faults.split(" · ")).toEqual(names);
    });
  }

  test("데이터베이스와 스토리지에는 점선이 남지 않는다 [REQ-106]", () => {
    for (const id of ["db-distributed-sql", "db-managed-multiaz", "sto-geo"]) {
      expect(chipById(id)?.modeled, id).toBe(true);
      expect(chipById(id)?.buildsAs, id).toBeUndefined();
    }
  });
});

describe("'이 모양이면'에 데이터베이스 고장이 들어간다 [REQ-095]", () => {
  test("자동 페일오버를 고르면 스플릿 브레인이 멈추는 고장에, 복제 끊김이 느려지는 고장에 든다", () => {
    const v = viewWith({ database: "db-auto-failover" });
    expect(v.problems).toEqual(expect.arrayContaining(["db_split_brain", "db_replication_broken"]));
    expect(v.ways).toEqual(expect.arrayContaining(["복제본 승격하기"]));
  });

  test("멀티패스가 없는 공유 스토리지는 컨트롤러 고장에 멈추고, 듀얼 컨트롤러+멀티패스는 느려질 뿐이다", () => {
    const stops = (id: string) => chipById(id)?.stops ?? [];
    const slows = (id: string) => chipById(id)?.slows ?? [];
    expect(stops("sto-shared")).toContain("storage_controller_failure");
    expect(stops("sto-dual-controller")).not.toContain("storage_controller_failure");
    expect(slows("sto-dual-controller")).toContain("storage_controller_failure");
  });

  test("분산 3벌을 고르면 노드 상실이 느려지는 고장이고 시나리오가 따라온다", () => {
    const v = viewWith({ storage: "sto-distributed" });
    expect(v.problems).toContain("storage_node_lost");
    expect(v.scenarios).toBeGreaterThan(0);
    expect(v.handover.some((h) => h.team === "스토리지팀")).toBe(true);
  });

  test("합의 DB와 관리형 DB는 자기 고장을 더한다 [REQ-106]", () => {
    const raft = viewWith({ database: "db-distributed-sql" });
    expect(raft.problems).toEqual(
      expect.arrayContaining(["db_leader_lost", "db_quorum_lost", "db_node_lagging"]),
    );
    expect(raft.dotted).toEqual([]);
    const managed = viewWith({ database: "db-managed-multiaz" });
    expect(managed.problems).toEqual(
      expect.arrayContaining(["db_az_failure", "db_failover_flapping", "db_storage_full"]),
    );
  });
});
