import {
  customService,
  DEFAULT_SHAPE,
  planShape,
  type ServiceDraft,
  type ShapeSpec,
} from "@terrarium/core/sources/worldgen";
import { describe, expect, test } from "vitest";
import { hostsText, resolveServiceLayers, shapeView } from ".";

const batch = (layers?: ServiceDraft["layers"]): ServiceDraft => ({
  ...customService(2, {
    name: "정산 배치",
    gives: "밤새 정산해요",
    stopsText: "정산이 늦어져요",
    kind: "batch",
  }),
  ...(layers ? { layers } : {}),
});

const spec = (layers?: ServiceDraft["layers"]): ShapeSpec => ({
  ...DEFAULT_SHAPE,
  services: [...DEFAULT_SHAPE.services, batch(layers)],
});

const OWN = {
  compute: "cmp-bare-spare",
  storage: "sto-raid-backup",
  database: "db-single",
  app: "app-single",
} as const;

describe("서비스마다 다른 모양을 화면이 읽는 법 [REQ-094]", () => {
  test("따로 고르지 않은 서비스는 세계의 모양이고, 따로 고르면 그 서비스의 호스트·VM만 달라진다", () => {
    const same = shapeView(spec());
    const apart = shapeView(spec(OWN));
    // 정산 배치: 3 VM → 서버째 3대 + 예비 1대
    expect(same.vms).toBe(12);
    expect(apart.vms).toBe(9);
    expect(apart.hosts).toBe(same.hosts + 1);
    expect(apart.hosts).toBe(planShape(spec(OWN)).serviceHosts + planShape(spec(OWN)).spareHosts);
  });

  test("서비스의 호스트 수 글은 그 서비스의 모양으로 센다", () => {
    const s = spec(OWN);
    const iap = s.services[0] as ServiceDraft;
    const own = s.services[1] as ServiceDraft;
    expect(hostsText(iap, s.layers)).toBe("3대");
    expect(hostsText(own, s.layers)).toBe("3대");
    expect(hostsText({ ...own, layers: undefined } as ServiceDraft, s.layers)).toBe("3대");
  });

  test("따로 고른 서비스의 약한 모양에서 나는 고장도 세계의 고장에 더해진다", () => {
    const same = shapeView(spec());
    const apart = shapeView(spec(OWN));
    expect(apart.stops.length).toBeGreaterThanOrEqual(same.stops.length);
    expect(apart.scenarios).toBeGreaterThanOrEqual(same.scenarios);
  });

  test("서비스 하나의 '알아서'는 그 서비스를 보고 네 층만 고른다", () => {
    const small = resolveServiceLayers(batch(), {});
    expect(Object.keys(small.layers).sort()).toEqual(["app", "compute", "database", "storage"]);
    // 노드 셋의 배치 서비스: 호스트에 나눠 올리고, 쌓아 두고 돌리는 일이라 백업만으로 충분해요
    expect(small.layers.compute).toBe("cmp-virt-ha");
    expect(small.layers.database).toBe("db-single");
    expect(small.why.database).toMatch(/백업/);
    const pressed = resolveServiceLayers(batch(), { compute: "cmp-bare" });
    expect(pressed.layers.compute).toBe("cmp-bare");
    expect(pressed.why.compute).toBeUndefined();
    // 서버째 두면 저장소는 서버 안 디스크를 묶는 쪽으로 따라와요
    expect(pressed.layers.storage).toBe("sto-raid-backup");
  });
});
