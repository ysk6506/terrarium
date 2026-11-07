import type { Blueprint } from "@terrarium/core/world";
import { describe, expect, it } from "vitest";
import { harmRows, withHarm } from "./quick-harm";

const bp = {
  entities: [
    {
      id: "svc-a",
      kind: "service",
      name: "A",
      props: {
        harmPerHourKrw: 5_000_000,
        harmTiers: JSON.stringify([
          { name: "느림", perHourKrw: 1_000_000 },
          { name: "멈춤", perHourKrw: 5_000_000 },
        ]),
      },
    },
    { id: "srv", kind: "server", name: "s", props: {} },
  ],
  links: [],
} as unknown as Blueprint;

describe("멈추면 시간당 피해를 실험 폼에서 [REQ-104]", () => {
  it("[REQ-104] 서비스의 등급을 읽는다", () => {
    expect(harmRows(bp)).toEqual([
      {
        entityId: "svc-a",
        service: "A",
        tiers: [
          { name: "느림", perHourKrw: 1_000_000 },
          { name: "멈춤", perHourKrw: 5_000_000 },
        ],
      },
    ]);
  });

  it("[REQ-104] 숫자를 바꾸면 가장 큰 값이 서비스의 시간당 피해가 되고 다른 개체는 그대로다", () => {
    const next = withHarm(bp, { "svc-a": [2_000_000, 9_000_000] });
    expect(harmRows(next)[0]?.tiers.map((t) => t.perHourKrw)).toEqual([2_000_000, 9_000_000]);
    expect(next.entities[0]?.props.harmPerHourKrw).toBe(9_000_000);
    expect(next.entities[1]).toBe(bp.entities[1]);
  });
});
