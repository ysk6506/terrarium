import { describe, expect, it } from "vitest";
import { Catalog } from "../../catalog";
import { BlueprintIndex, validateBlueprint } from "../../world";
import {
  customService,
  DEFAULT_SHAPE,
  generateShaped,
  type ServiceDraft,
  type ShapeSpec,
  shapeProblem,
} from "./index";

const withApp = (app: string, services?: readonly ServiceDraft[]): ShapeSpec => ({
  ...DEFAULT_SHAPE,
  layers: { ...DEFAULT_SHAPE.layers, app },
  ...(services ? { services } : {}),
});

const kinds = (spec: ShapeSpec) => {
  const { blueprint } = generateShaped(spec);
  const count = new Map<string, number>();
  for (const e of blueprint.entities) count.set(e.kind, (count.get(e.kind) ?? 0) + 1);
  return { blueprint, count };
};

describe("애플리케이션 층을 짓는 생성기 [REQ-100]", () => {
  it("app-single과 LB 뒤 N대 모양에는 애플리케이션 개체가 없다", () => {
    for (const app of ["app-single", "app-lb-sticky"]) {
      const { count } = kinds(withApp(app));
      for (const k of [
        "app_instance",
        "load_balancer",
        "session_store",
        "circuit_breaker",
        "mesh_sidecar",
        "mesh_control",
        "region",
      ])
        expect(count.get(k) ?? 0, `${app}: ${k}`).toBe(0);
    }
  });

  it("무상태: 인스턴스와 로드 밸런서와 세션 저장소가 서고 브레이커·메시·리전은 없다", () => {
    const { count } = kinds(withApp("app-stateless"));
    expect(count.get("app_instance")).toBeGreaterThan(0);
    expect(count.get("load_balancer")).toBeGreaterThan(0);
    expect(count.get("session_store")).toBeGreaterThan(0);
    expect(count.get("circuit_breaker") ?? 0).toBe(0);
    expect(count.get("mesh_control") ?? 0).toBe(0);
    expect(count.get("region") ?? 0).toBe(0);
  });

  it("IAP 기본 틀에는 오케스트레이터가 도메인 에이전트와 코어를, 도메인 에이전트가 토폴로지 그래프 DB를 부르는 호출이 있다", () => {
    const { blueprint } = kinds(withApp("app-stateless"));
    const pairs = blueprint.links
      .filter((l) => l.kind === "calls")
      .map(
        (l) => `${l.from.split("-").slice(2).join("-")} > ${l.to.split("-").slice(2).join("-")}`,
      );
    expect(pairs).toEqual(
      expect.arrayContaining([
        "orchestrator > domain-agents",
        "orchestrator > goclaw-core",
        "domain-agents > topology-graph",
      ]),
    );
  });

  it("서비스를 더하며 부르는 서비스를 고르면 calls 링크가 생긴다", () => {
    const first = DEFAULT_SHAPE.services[0] as ServiceDraft;
    const extra = customService(2, {
      name: "정산 배치",
      gives: "밤새 정산해요",
      stopsText: "정산이 늦어져요",
      calls: [first.key],
    });
    expect(extra.calls).toEqual([first.key]);
    const { blueprint } = kinds(withApp("app-lb-sticky", [first, extra]));
    const link = blueprint.links.find((l) => l.kind === "calls" && l.from === "svc-svc2");
    expect(link).toBeDefined();
    expect(link?.to).toBe(`svc-${first.key}`);
  });

  it("마이크로서비스부터 서비스끼리의 호출마다 브레이커가, 메시부터 사이드카와 컨트롤 플레인이, 멀티 리전은 리전 둘이 선다", () => {
    const first = DEFAULT_SHAPE.services[0] as ServiceDraft;
    const extra = customService(2, {
      name: "정산 배치",
      gives: "밤새 정산해요",
      stopsText: "정산이 늦어져요",
      calls: [first.key],
    });
    const vms = (app: string): ShapeSpec => ({
      ...withApp(app, [first, extra]),
      layers: { ...DEFAULT_SHAPE.layers, app, compute: "cmp-bare-spare" },
    });
    expect(kinds(vms("app-microservices")).count.get("circuit_breaker")).toBe(1);
    expect(kinds(vms("app-stateless")).count.get("circuit_breaker") ?? 0).toBe(0);
    const mesh = kinds(withApp("app-mesh")).count;
    expect(mesh.get("mesh_sidecar")).toBeGreaterThan(0);
    expect(mesh.get("mesh_control")).toBe(1);
    expect(kinds(withApp("app-multiregion")).count.get("region")).toBe(2);
  });

  it("지은 세계는 검증을 통과하고 모든 서비스가 처음에 멀쩡하다", () => {
    for (const app of ["app-stateless", "app-microservices", "app-mesh", "app-multiregion"]) {
      const result = generateShaped(withApp(app));
      expect(validateBlueprint(result.blueprint, new Catalog()), app).toEqual([]);
      expect(shapeProblem(withApp(app))).toBeUndefined();
      expect(new BlueprintIndex(result.blueprint).ofKind("service").length).toBeGreaterThan(0);
    }
  });

  it("멀티 리전은 호스트가 두 배로 서고 인스턴스가 두 리전에 나뉜다", () => {
    const one = generateShaped(withApp("app-mesh"));
    const two = generateShaped(withApp("app-multiregion"));
    expect(two.counts.serviceHosts).toBeGreaterThan(one.counts.serviceHosts);
    const idx = new BlueprintIndex(two.blueprint);
    const per = new Map<string, number>();
    for (const l of idx.allLinks())
      if (l.kind === "member_of" && idx.find(l.to)?.kind === "region")
        per.set(l.to, (per.get(l.to) ?? 0) + 1);
    expect(per.size).toBe(2);
    expect([...per.values()].every((n) => n > 0)).toBe(true);
  });
});
