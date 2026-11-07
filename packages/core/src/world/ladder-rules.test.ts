import { describe, expect, test } from "vitest";
import { LADDER, LAYER_IDS, type LayerId, type Layers } from "./ladder";
import {
  cheapestWay,
  needMet,
  placeOf,
  pointlessOf,
  unmetNeeds,
  unmetOf,
  withChoice,
} from "./ladder-rules";

const BASE: Layers = {
  network: "net-three-tier",
  compute: "cmp-bare",
  storage: "sto-local",
  database: "db-single",
  app: "app-single",
  power: "pwr-single",
  cooling: "cool-n",
  site: "site-one-room",
} as unknown as Layers;

const base = (over: Partial<Layers>): Layers => ({ ...BASE, ...over });
const needsOf = (layer: LayerId, id: string) =>
  LADDER[layer].find((c) => c.id === id)?.requires ?? [];

describe("전제 규칙: 어떤 칩은 다른 층이 받쳐 줘야 골라진다 [REQ-102]", () => {
  test("규칙의 층과 칩 id는 모두 사다리에 있다", () => {
    for (const layer of LAYER_IDS)
      for (const chip of LADDER[layer]) {
        for (const need of chip.requires ?? []) {
          expect(
            placeOf(need.layer, need.atLeast),
            `${chip.id} → ${need.atLeast}`,
          ).toBeGreaterThanOrEqual(0);
          if (need.orElse)
            expect(placeOf(need.orElse.layer, need.orElse.atLeast)).toBeGreaterThanOrEqual(0);
        }
        for (const p of chip.pointlessWith ?? [])
          expect(placeOf(p.layer, p.chip), `${chip.id} ~ ${p.chip}`).toBeGreaterThanOrEqual(0);
      }
  });

  test("정해진 규칙이 칩에 붙어 있다", () => {
    const wants: Record<string, string[]> = {
      "net-cloud-native": ["compute:cmp-containers"],
      "app-mesh": ["compute:cmp-containers"],
      "cmp-virt-ha": ["storage:sto-shared"],
      "cmp-drs": ["storage:sto-shared"],
      "db-shared-aa": ["storage:sto-shared"],
      "app-multiregion": ["site:site-multi-active", "database:db-distributed-sql"],
      "site-dr-warm": ["storage:sto-geo", "database:db-primary-secondary"],
      "site-multi-active": ["storage:sto-geo", "database:db-distributed-sql"],
    };
    for (const [id, spots] of Object.entries(wants)) {
      const layer = LAYER_IDS.find((l) => LADDER[l].some((c) => c.id === id)) as LayerId;
      const got = needsOf(layer, id).flatMap((n) => [n, ...(n.orElse ? [n.orElse] : [])]);
      for (const s of spots) expect(got.map((n) => `${n.layer}:${n.atLeast}`)).toContain(s);
    }
  });

  test("'이상'은 사다리에서 그 칩이거나 오른쪽이라는 뜻이다", () => {
    const need = { layer: "compute" as const, atLeast: "cmp-containers" };
    expect(needMet(base({ compute: "cmp-containers" }), need)).toBe(true);
    expect(needMet(base({ compute: "cmp-multicluster" }), need)).toBe(true);
    expect(needMet(base({ compute: "cmp-drs", storage: "sto-shared" }), need)).toBe(false);
  });

  test("채워지지 않은 전제를 말해 준다", () => {
    const l = base({ network: "net-cloud-native" });
    expect(unmetNeeds(l, "network", "net-cloud-native")).toHaveLength(1);
    expect(unmetOf(l).map((u) => u.chip)).toEqual(["net-cloud-native"]);
    expect(unmetOf(BASE)).toEqual([]);
  });

  test("둘 중 하나로 채워지는 전제는 싼 쪽을 고른다", () => {
    const need = needsOf("site", "site-dr-warm")[0];
    expect(need).toBeDefined();
    if (!need) return;
    expect(needMet(base({ site: "site-dr-warm", database: "db-primary-secondary" }), need)).toBe(
      true,
    );
    expect(needMet(base({ site: "site-dr-warm", storage: "sto-geo" }), need)).toBe(true);
    expect(needMet(base({ site: "site-dr-warm" }), need)).toBe(false);
    expect(cheapestWay(need).layer).toBe("database");
  });

  test("'컴퓨트도 바꾸기'는 전제 층을 필요한 가장 왼쪽 칩으로 올리고, 이미 높은 층은 건드리지 않는다", () => {
    const up = withChoice(base({ compute: "cmp-bare" }), "network", "net-cloud-native");
    expect(up.network).toBe("net-cloud-native");
    expect(up.compute).toBe("cmp-containers");
    expect(unmetOf(up)).toEqual([]);
    const kept = withChoice(
      base({ compute: "cmp-multicluster", storage: "sto-shared" }),
      "network",
      "net-cloud-native",
    );
    expect(kept.compute).toBe("cmp-multicluster");
    // 전제가 또 전제를 부르면 줄줄이 올라간다: 컨테이너 → 아니, 다중 활성은 DB·스토리지로
    const chain = withChoice(base({}), "app", "app-multiregion");
    expect(unmetOf(chain)).toEqual([]);
    expect(chain.site).toBe("site-multi-active");
  });

  test("쓸모없는 짝은 막지 않고 한 줄 말만 건넨다", () => {
    const l = base({ compute: "cmp-multicluster", storage: "sto-shared", site: "site-one-room" });
    const found = pointlessOf(l);
    expect(found).toHaveLength(1);
    expect(found[0]?.note).toBe("멀티클러스터인데 서버룸이 하나면 같은 방이 멈추면 둘 다 멈춰요");
    expect(pointlessOf({ ...l, site: "site-two-rooms" })).toEqual([]);
  });
});
