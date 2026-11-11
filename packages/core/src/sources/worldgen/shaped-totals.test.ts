import { LADDER, LAYER_IDS } from "@terrarium/core/world";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHAPE,
  defaultSize,
  generateShaped,
  planShape,
  type ShapeSpec,
  shapeProblem,
  sizeFields,
  worldTotals,
} from "./index";
import { MIDDLE_LAYERS } from "./shaped-defaults";

const spec = (over: Partial<ShapeSpec> = {}): ShapeSpec => ({
  ...DEFAULT_SHAPE,
  ...sizeFields(defaultSize(DEFAULT_SHAPE.services)),
  ...over,
});

/** What the plan promises and what the generator then builds, in the three words every screen uses. */
function both(s: ShapeSpec) {
  const plan = planShape(s);
  const t = worldTotals(plan);
  const made = generateShaped(s).counts;
  return {
    plan: {
      servers: t.servers,
      racks: t.racks,
      baseRacks: t.baseRacks,
      rooms: t.rooms,
      switches: plan.switches,
    },
    made: {
      servers: made.servers,
      racks: made.racks,
      baseRacks: made.baseRacks,
      rooms: made.rooms,
      switches: made.switches,
    },
  };
}

describe("크기 합계는 만들어진 세계와 같다 [REQ-111]", () => {
  it("[REQ-111] 기본 세계: 서버 120대, 서버 랙 6 + 기반 랙 1, 스위치 9대가 화면에도 세계에도 같다", () => {
    const { plan, made } = both(spec());
    expect(plan).toEqual(made);
    expect(made.servers).toBe(120);
    expect(made.racks).toBe(7);
    expect(made.baseRacks).toBe(1);
  });

  it("[REQ-111] 룸 수·룸당 랙·랙당 서버를 바꿔도 같다 (행에 안 맞는 랙 수, 1U·2U가 섞이는 높은 랙당 서버도)", () => {
    for (const [rooms, racksPerRoom, perRack] of [
      [1, 25, 20],
      [2, 7, 13],
      [3, 10, 22],
      [1, 3, 4],
      [2, 48, 20],
    ] as const) {
      const s = spec({ rooms, racksPerRoom, perRack, servers: rooms * racksPerRoom * perRack });
      const { plan, made } = both(s);
      expect(made, `${rooms}×${racksPerRoom}×${perRack}`).toEqual(plan);
      expect(made.servers).toBeGreaterThanOrEqual(rooms * racksPerRoom * perRack);
    }
  });

  it("[REQ-111] 층마다 모델링된 칩을 하나씩 바꿔도 같다 (GPU·액체 냉각·두 번째 사이트 포함)", () => {
    let tried = 0;
    for (const layer of LAYER_IDS)
      for (const chip of LADDER[layer]) {
        if (!chip.modeled) continue;
        const s = spec({ layers: { ...MIDDLE_LAYERS, [layer]: chip.id } });
        if (shapeProblem(s)) continue;
        const { plan, made } = both(s);
        expect(made, `${layer}:${chip.id}`).toEqual(plan);
        tried += 1;
      }
    expect(tried).toBeGreaterThan(40);
  });

  it("[REQ-111] 서버가 부족하게 모자란 서비스가 있어도 랙은 서버를 정확히 랙당 서버 수만큼 채운다", () => {
    const s = spec({ rooms: 1, racksPerRoom: 3, perRack: 4, servers: 12 });
    const made = generateShaped(s).counts;
    expect(made.servers).toBe(planShape(s).servers);
  });
});
