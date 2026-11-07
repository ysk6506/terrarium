import { describe, expect, it } from "vitest";
import {
  buildFor,
  customService,
  DEFAULT_SHAPE,
  generateShaped,
  hostsOf,
  planShape,
  type ServiceDraft,
  type ShapeSpec,
  shapeProblem,
} from "./index";

const second = (layers?: ServiceDraft["layers"]): ServiceDraft => ({
  ...customService(2, { name: "정산 배치", gives: "밤새 정산해요", stopsText: "정산이 늦어져요" }),
  ...(layers ? { layers } : {}),
});

const two = (layers?: ServiceDraft["layers"]): ShapeSpec => ({
  ...DEFAULT_SHAPE,
  services: [...DEFAULT_SHAPE.services, second(layers)],
});

const BARE = {
  compute: "cmp-bare-spare",
  storage: "sto-raid-backup",
  database: "db-single",
  app: "app-single",
} as const;

describe("서비스마다 다른 모양 [REQ-094]", () => {
  it("모양을 따로 고르지 않은 서비스는 세계의 모양을 그대로 따른다", () => {
    const same = generateShaped(two());
    const sameAgain = generateShaped(two(undefined));
    expect(same.counts).toEqual(sameAgain.counts);
    // IAP 9개 + 정산 3개 노드는 VM, 호스트는 서비스마다 3대씩
    expect(same.counts.serviceVms).toBe(12);
    expect(same.counts.serviceHosts).toBe(6);
  });

  it("서비스가 자기 모양을 고르면 그 서비스만 달리 선다: 서버째 두고 예비 한 대", () => {
    const apart = generateShaped(two(BARE));
    // IAP는 VM 9개 그대로, 정산 배치는 VM 없이 서버에 바로 선다
    expect(apart.counts.serviceVms).toBe(9);
    const links = apart.blueprint.links.filter((l) => l.kind === "service_on");
    const role = (from: string, what: string) =>
      links.filter((l) => l.from === from && l.props.role === what).map((l) => l.to);
    expect(role("svc-svc2", "active")).toHaveLength(3);
    expect(role("svc-svc2", "standby")).toHaveLength(1);
    expect(role("svc-iap", "standby")).toHaveLength(0);
    // 서버는 서비스끼리 나눠 쓰지 않는다
    const batch = new Set([...role("svc-svc2", "active"), ...role("svc-svc2", "standby")]);
    const iapHosts = apart.blueprint.links
      .filter((l) => l.kind === "runs_on" && l.from.includes("-iap-vm"))
      .map((l) => l.to);
    expect(iapHosts.some((h) => batch.has(h))).toBe(false);
  });

  it("계획이 센 호스트와 예비가 서비스마다의 모양을 더한 것이다", () => {
    const spec = two(BARE);
    const plan = planShape(spec);
    expect(plan.spareHosts).toBe(1);
    expect(plan.serviceHosts).toBe(3 + 3);
    expect(hostsOf(second(BARE), buildFor(spec.layers, second(BARE)))).toBe(3);
    expect(planShape(two()).spareHosts).toBe(0);
  });

  it("세계의 건물은 하나: 서비스가 네트워크·전원·냉방·사업장을 따로 고를 수는 없다", () => {
    const loose = { ...BARE, power: "pwr-single" } as never;
    expect(shapeProblem(two(loose))).toBeUndefined();
    const built = generateShaped(two(loose));
    expect(built.blueprint.meta?.layers).toContain("pwr-ab");
  });

  it("없는 선택지를 고르면 어느 서비스인지 말해 준다", () => {
    expect(shapeProblem(two({ ...BARE, compute: "cmp-nope" }))).toMatch(/정산 배치: .*cmp-nope/);
    expect(() => generateShaped(two({ ...BARE, compute: "cmp-nope" }))).toThrow(/정산 배치/);
  });

  it("점선이던 칸도 자기 모양으로 지어서 가까운 모양으로 지었다는 알림이 없다 [REQ-106]", () => {
    const built = generateShaped(two({ ...BARE, database: "db-distributed-sql" }));
    expect(built.notes.some((n) => n.startsWith("정산 배치: "))).toBe(false);
    expect(
      built.blueprint.entities.filter((e) => e.kind === "db_node").length,
    ).toBeGreaterThanOrEqual(3);
  });
});
