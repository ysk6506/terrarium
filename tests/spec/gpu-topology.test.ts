import { Catalog } from "@terrarium/core/catalog";
import { Physics } from "@terrarium/core/physics";
import { fold, layerShape, type TopologySource } from "@terrarium/core/topology";
import { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { shapedLab } from "./test-support/ladder-labs";

const sourceOf = (world: World): TopologySource => ({
  index: world.index,
  time: () => world.time(),
  stateOf: (id) => world.stateOf(id),
  faults: () => world.faults(),
  alarms: () => world.alarms(),
  linkUp: (id) => world.linkUp(id),
});

describe("가속기 층: GPU → 노드 → 패브릭 → 잡·풀 [REQ-107]", () => {
  test("학습 클러스터 세계의 가속기 층은 네 단계이고 단계 순서가 이렇다", () => {
    const world = World.fromBlueprint(
      shapedLab({
        layers: { accel: "gpu-training-cluster", network: "net-leaf-spine" },
        cards: ["training-pipeline"],
      }),
      new Catalog(),
    );
    const shape = layerShape(world.index, "accel");
    expect(shape.stages.map((s) => s.label)).toEqual(["GPU", "노드", "패브릭", "잡·풀"]);
    for (const members of shape.members) expect(members.length).toBeGreaterThan(0);
  });

  test("GPU 하나가 고장 나면 그 노드와 잡이 영향을 받는 것으로 칠해진다", () => {
    const world = World.fromBlueprint(
      shapedLab({
        layers: { accel: "gpu-training-cluster", network: "net-leaf-spine" },
        cards: ["training-pipeline"],
      }),
      new Catalog(),
    );
    const physics = new Physics(world);
    physics.settle();
    const gpu = world.index.ofKind("gpu")[0]?.id as string;
    world.apply(
      { type: "fault.add", fault: { id: "f1", type: "gpu_xid_error", target: gpu, params: {} } },
      "scenario",
    );
    physics.run(60);
    const board = fold(sourceOf(world), { layer: "accel" });
    expect(board.tiles.some((t) => t.state === "fault" || t.state === "alarm")).toBe(true);
  });
});
