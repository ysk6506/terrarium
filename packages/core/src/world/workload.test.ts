import { describe, expect, it } from "vitest";
import type { Entity } from "./blueprint";
import { CHIP_COUNT, LADDER, LAYER_IDS, layersProblem } from "./ladder";
import { serviceDef, serviceProps } from "./service";
import {
  conditionsFor,
  DEFAULT_WORKLOAD,
  daytimeShare,
  heaviest,
  hourWeights,
  workloadOf,
  workloadProblem,
  workloadProps,
} from "./workload";

const svc = (props: Record<string, string | number | boolean>): Entity => ({
  id: "s",
  kind: "service",
  name: "서비스",
  props: { ...serviceProps({ kind: "request", process: "p" }), ...props },
});

describe("일감과 사다리 [REQ-094]", () => {
  it("일감은 서비스 개체에 저장되고 그대로 읽힌다", () => {
    const w = DEFAULT_WORKLOAD.batch;
    expect(workloadOf(svc(workloadProps(w)))).toEqual(w);
    expect(workloadOf(svc({}))).toBeUndefined();
  });

  it("가장 많이 쓰는 자원이 정상 조건을 낮춘다: CPU 위주면 CPU가 더 일찍 느려진다", () => {
    const plain = serviceDef(svc({}));
    const heavy = serviceDef(
      svc(
        workloadProps({
          ...DEFAULT_WORKLOAD.api,
          shares: { cpu: 0.7, mem: 0.1, disk: 0.1, net: 0.1 },
        }),
      ),
    );
    expect(heavy.conditions.maxCpuUtil).toBeLessThan(plain.conditions.maxCpuUtil);
    expect(heavy.conditions.maxMemPct).toBe(plain.conditions.maxMemPct);
    expect(heaviest({ cpu: 0.7, mem: 0.1, disk: 0.1, net: 0.1 })).toBe("cpu");
    expect(conditionsFor(DEFAULT_WORKLOAD.api, plain.conditions).maxInletC).toBe(
      plain.conditions.maxInletC,
    );
  });

  it("직접 정한 정상 조건은 일감이 덮어쓰지 않는다", () => {
    const set = serviceDef(svc({ ...workloadProps(DEFAULT_WORKLOAD.api), maxCpuUtil: 0.5 }));
    expect(set.conditions.maxCpuUtil).toBe(0.5);
  });

  it("시각 가중치는 합이 1이고 낮 일감은 낮에 더 쏠린다", () => {
    for (const p of ["office", "flat", "night", "bursty"] as const)
      expect(hourWeights(p).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(daytimeShare("office")).toBeGreaterThan(daytimeShare("night"));
  });

  it("말이 안 되는 일감은 한국어로 말한다", () => {
    expect(workloadProblem({ ...DEFAULT_WORKLOAD.api, perMinute: 0 })).toMatch(/분당 요청/);
    expect(
      workloadProblem({ ...DEFAULT_WORKLOAD.api, shares: { cpu: 1, mem: 1, disk: 0, net: 0 } }),
    ).toMatch(/100%/);
    expect(workloadProblem(DEFAULT_WORKLOAD.api)).toBeUndefined();
  });

  it("사다리: 여덟 층에 선택지가 마흔네 개이고 층마다 아이디가 겹치지 않는다", () => {
    expect(LAYER_IDS).toHaveLength(8);
    expect(CHIP_COUNT).toBe(44);
    const ids = LAYER_IDS.flatMap((l) => LADDER[l].map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      layersProblem({
        ...Object.fromEntries(LAYER_IDS.map((l) => [l, LADDER[l][0]?.id])),
      } as never),
    ).toBeUndefined();
    expect(layersProblem({ network: "x" } as never)).toMatch(/선택지는 없어요/);
  });
});
