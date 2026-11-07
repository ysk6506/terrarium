import { draftFromCard, IAP_DRAFT, type ServiceDraft } from "@terrarium/core/sources/worldgen";
import {
  LAYER_IDS,
  type LayerId,
  placeOf,
  SERVICE_CATALOG,
  type ServiceLoad,
  unmetOf,
} from "@terrarium/core/world";
import { describe, expect, it } from "vitest";
import { resolveLayers, resolveServiceLayers } from "./auto-pick";
import { applyRules, LOAD_RULE_ROWS, LOAD_RULES } from "./load-rules";

/** A load no rule asks anything of. */
const CALM = { rps: 1, dataGB: 1, users: 1, maxDowntimeS: 3_600, gpuHours: 0 };
const BASE = { id: "base", why: "기본" };

const withLoad = (s: ServiceDraft, load: ServiceLoad): ServiceDraft => ({ ...s, load });
const card = (id: string) =>
  SERVICE_CATALOG.find((c) => c.id === id) as (typeof SERVICE_CATALOG)[0];

interface Row {
  readonly rule: string;
  readonly layer: LayerId;
  readonly hit: Partial<typeof CALM>;
  readonly miss: Partial<typeof CALM>;
  readonly id: string;
  readonly quote: string;
}

const ROWS: readonly Row[] = [
  {
    rule: "사용자 5,000",
    layer: "network",
    hit: { users: 5_000 },
    miss: { users: 4_999 },
    id: "net-leaf-spine",
    quote: "5,000명",
  },
  {
    rule: "중단 60초 컴퓨트",
    layer: "compute",
    hit: { maxDowntimeS: 60 },
    miss: { maxDowntimeS: 61 },
    id: "cmp-virt-ha",
    quote: "1분",
  },
  {
    rule: "중단 10초 컴퓨트",
    layer: "compute",
    hit: { maxDowntimeS: 10 },
    miss: { maxDowntimeS: 11 },
    id: "cmp-drs",
    quote: "10초",
  },
  {
    rule: "GPU 학습",
    layer: "accel",
    hit: { gpuHours: 1 },
    miss: { gpuHours: 0 },
    id: "gpu-training-cluster",
    quote: "1시간",
  },
  {
    rule: "중단 60초 스토리지",
    layer: "storage",
    hit: { maxDowntimeS: 60 },
    miss: { maxDowntimeS: 61 },
    id: "sto-dual-controller",
    quote: "1분",
  },
  {
    rule: "데이터 10,000 GB",
    layer: "storage",
    hit: { dataGB: 10_000 },
    miss: { dataGB: 9_999 },
    id: "sto-distributed",
    quote: "10 TB",
  },
  {
    rule: "중단 60초 DB",
    layer: "database",
    hit: { maxDowntimeS: 60 },
    miss: { maxDowntimeS: 61 },
    id: "db-auto-failover",
    quote: "1분",
  },
  {
    rule: "중단 10초 DB",
    layer: "database",
    hit: { maxDowntimeS: 10 },
    miss: { maxDowntimeS: 11 },
    id: "db-distributed-sql",
    quote: "10초",
  },
  {
    rule: "요청 1,000",
    layer: "app",
    hit: { rps: 1_000 },
    miss: { rps: 999 },
    id: "app-stateless",
    quote: "1,000건",
  },
  {
    rule: "요청 10,000",
    layer: "app",
    hit: { rps: 10_000 },
    miss: { rps: 9_999 },
    id: "app-microservices",
    quote: "10,000건",
  },
  {
    rule: "중단 30초 전원",
    layer: "power",
    hit: { maxDowntimeS: 30 },
    miss: { maxDowntimeS: 31 },
    id: "pwr-n1-ups",
    quote: "30초",
  },
  {
    rule: "중단 30초 사이트",
    layer: "site",
    hit: { maxDowntimeS: 30 },
    miss: { maxDowntimeS: 31 },
    id: "site-two-rooms",
    quote: "30초",
  },
  {
    rule: "중단 5초 사이트",
    layer: "site",
    hit: { maxDowntimeS: 5 },
    miss: { maxDowntimeS: 6 },
    id: "site-two-buildings",
    quote: "5초",
  },
];

interface ImportMetaGlob {
  glob(patterns: string[], options: object): unknown;
}
const DOCS = (import.meta as unknown as ImportMetaGlob).glob(
  ["../../../../../docs/design-docs/world-entry.md"],
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
) as Record<string, string>;
const doc = Object.values(DOCS)[0] ?? "";

describe("알아서의 규칙 표: 숫자가 층을 고른다 [REQ-109]", () => {
  it("[REQ-109] 규칙마다 기준 숫자에서 켜지고 바로 아래에서는 꺼지며, 이유가 그 숫자를 말한다", () => {
    for (const r of ROWS) {
      const hit = applyRules(r.layer, BASE, { ...CALM, ...r.hit });
      const miss = applyRules(r.layer, BASE, { ...CALM, ...r.miss });
      expect(hit.id, r.rule).not.toBe("base");
      expect(placeOf(r.layer, hit.id), r.rule).toBeGreaterThanOrEqual(placeOf(r.layer, r.id));
      expect(hit.why, r.rule).toContain(r.quote);
      expect(miss.id, r.rule).not.toBe(r.id);
    }
    expect(ROWS.length).toBeGreaterThanOrEqual(LOAD_RULES.length - 1);
  });

  it("[REQ-109] 사이트가 건물 둘 이상이고 허용 중단이 30초 이하면 DR 핫이고, 방 하나면 DR 핫이 아니다", () => {
    const load = { ...CALM, maxDowntimeS: 30 };
    expect(applyRules("site", { id: "site-two-buildings", why: "x" }, load).id).toBe("site-dr-hot");
    expect(applyRules("site", { id: "site-dr-warm", why: "x" }, load).id).toBe("site-dr-hot");
    expect(applyRules("site", { id: "site-one-room", why: "x" }, load).id).toBe("site-two-rooms");
    expect(
      applyRules("site", { id: "site-two-buildings", why: "x" }, { ...CALM, maxDowntimeS: 31 }).id,
    ).toBe("site-two-buildings");
  });

  it("[REQ-109] 숫자는 층을 올리기만 하고 내리지 않는다 (허용 중단이 짧을수록, 요청이 많을수록 오른쪽)", () => {
    for (const layer of LAYER_IDS) {
      let last = -1;
      for (const s of [3_600, 120, 61, 60, 31, 30, 11, 10, 6, 5, 1]) {
        const id = applyRules(layer, { id: "base", why: "" }, { ...CALM, maxDowntimeS: s }).id;
        const at = id === "base" ? -1 : placeOf(layer, id);
        expect(at, `${layer} ${s}`).toBeGreaterThanOrEqual(last);
        last = at;
      }
    }
  });

  it("[REQ-109] IAP와 웹 API를 함께 놓으면 '중단 허용 1분이라서 자동 페일오버'라고 말한다", () => {
    const keys = ["iap"];
    const web = draftFromCard(card("web-api"), keys);
    const got = resolveLayers([IAP_DRAFT, web], {});
    expect(got.layers.database).toBe("db-auto-failover");
    expect(got.why.database).toBe("중단 허용 1분이라서 자동 페일오버");
    // IAP alone allows five minutes: nothing asks for more than before
    const alone = resolveLayers([IAP_DRAFT], {});
    expect(alone.layers.database).toBe("db-primary-secondary");
    expect(alone.layers.app).toBe("app-lb-sticky");
  });

  it("[REQ-109] 학습 파이프라인의 20 TB와 GPU 5,000시간은 분산 스토리지와 학습 클러스터를 고른다", () => {
    const train = draftFromCard(card("training-pipeline"), []);
    const got = resolveLayers([train], {});
    expect(got.layers.accel).toBe("gpu-training-cluster");
    expect(got.layers.storage).toBe("sto-distributed");
    expect(got.why.storage).toContain("20 TB");
    expect(got.why.accel).toContain("5,000시간");
  });

  it("[REQ-109] 서비스가 여럿이면 가장 바쁜 것·가장 엄격한 중단·데이터의 합을 따른다", () => {
    const a = withLoad(IAP_DRAFT, { rps: 10, dataGB: 6_000, users: 10, maxDowntimeS: 600 });
    const b = withLoad(draftFromCard(card("cache"), ["iap"]), {
      rps: 12_000,
      dataGB: 5_000,
      users: 10,
      maxDowntimeS: 600,
    });
    const got = resolveLayers([a, b], {});
    expect(got.layers.app).toBe("app-microservices");
    expect(got.layers.storage).toBe("sto-distributed");
  });

  it("[REQ-109] 어떤 숫자 조합에서도 전제를 어긴 층이 나오지 않고, 같은 입력이면 같은 결과다", () => {
    const keys = ["iap"];
    const web = draftFromCard(card("web-api"), keys);
    const train = draftFromCard(card("training-pipeline"), keys);
    let checked = 0;
    for (const rps of [0, 999, 1_000, 10_000])
      for (const users of [0, 5_000])
        for (const dataGB of [0, 10_000])
          for (const maxDowntimeS of [3_600, 61, 60, 30, 10, 5])
            for (const gpuHours of [0, 100])
              for (const cost of [-1, 0, 1] as const)
                for (const base of [IAP_DRAFT, web, train]) {
                  const s = withLoad(base, { rps, users, dataGB, maxDowntimeS, gpuHours });
                  const one = resolveLayers([s], {}, { cost });
                  expect(unmetOf(one.layers), JSON.stringify({ s: s.load, cost })).toEqual([]);
                  expect(resolveLayers([s], {}, { cost })).toEqual(one);
                  const own = resolveServiceLayers(s, {}, { cost });
                  expect(own.layers.database).toBe(one.layers.database);
                  checked++;
                }
    expect(checked).toBe(4 * 2 * 2 * 6 * 2 * 3 * 3);
  });

  it("[REQ-109] 직접 고른 층은 숫자가 무엇이든 그대로이고, 나머지만 숫자를 따른다", () => {
    const s = withLoad(IAP_DRAFT, { ...CALM, maxDowntimeS: 5, rps: 20_000 });
    const got = resolveLayers([s], { database: "db-single", app: "app-single" });
    expect(got.layers.database).toBe("db-single");
    expect(got.layers.app).toBe("app-single");
    expect(got.why.database).toBeUndefined();
    expect(got.layers.power).not.toBe("pwr-single");
  });

  it("[REQ-109] 비용 쪽으로 한 칸 옮기면 싸게는 왼쪽으로, 튼튼하게는 오른쪽으로 가고 이유가 그렇게 말한다", () => {
    const sum = (cost: -1 | 0 | 1) => {
      const r = resolveLayers([IAP_DRAFT], {}, { cost });
      return { total: LAYER_IDS.reduce((n, l) => n + placeOf(l, r.layers[l]), 0), why: r.why };
    };
    const cheap = sum(-1);
    const mid = sum(0);
    const steady = sum(1);
    expect(cheap.total).toBeLessThan(mid.total);
    expect(steady.total).toBeGreaterThan(mid.total);
    expect(Object.values(cheap.why).join()).toContain("싸게 쪽이라 한 칸 낮춰서");
    expect(Object.values(steady.why).join()).toContain("멈추지 않게 쪽이라 한 칸 올려서");
    // the GPUs a service brings are not a cost matter
    const train = draftFromCard(card("training-pipeline"), []);
    expect(resolveLayers([train], {}, { cost: -1 }).layers.accel).toBe("gpu-training-cluster");
  });

  it("[REQ-109] 규칙 표는 world-entry.md의 표와 같은 줄이다", () => {
    for (const row of LOAD_RULE_ROWS)
      expect(doc, `${row.layer} ${row.text} → ${row.id}`).toContain(
        `| ${row.text} | \`${row.id}\``,
      );
  });
});
