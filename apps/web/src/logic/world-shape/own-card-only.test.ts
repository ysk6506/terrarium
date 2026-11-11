import {
  catalogKey,
  DEFAULT_SHAPE,
  defaultSize,
  draftFromCard,
  generateShaped,
  planShape,
  type ServiceDraft,
  type ShapeSpec,
  shapeProblem,
  sizeFields,
  workloadServers,
} from "@terrarium/core/sources/worldgen";
import { catalogCard } from "@terrarium/core/world";
import { beforeEach, describe, expect, it } from "vitest";
import { type WorldDraft, worldDraft, worthKeeping } from "../world-draft";
import { resolveLayers, shapeView } from ".";
import { ladderHead, noServicesReason, removeService, worldNameFor } from "./service-list";
import { sizeView } from "./size-view";

const iap = DEFAULT_SHAPE.services[0] as ServiceDraft;
const own = (name = "내 정산 웹"): ServiceDraft => {
  const card = catalogCard("web-api");
  if (!card) throw new Error("web-api card");
  return draftFromCard(card, [iap.key], { name });
};

/** The spec the screens build: sizes from the services that are there, layers worked out from them. */
function specOf(services: readonly ServiceDraft[]): ShapeSpec {
  return {
    ...DEFAULT_SHAPE,
    ...sizeFields(defaultSize(services)),
    layers: resolveLayers(services, {}).layers,
    services,
  };
}

describe("IAP를 빼고 내 카드만 쓰기 [REQ-111]", () => {
  it("[REQ-111] IAP를 빼면 내 카드만 남고, 사다리는 그 카드의 이름으로 '서비스 1 / 1'을 묻는다", () => {
    const left = removeService([iap, own()], 0);
    expect(left.map((s) => s.name)).toEqual(["내 정산 웹"]);
    const head = ladderHead(left[0]?.name ?? "", 0, left.length);
    expect(head.title).toBe("내 정산 웹은 어떻게 돌리나요?");
    expect(head.badge).toBe("서비스 1 / 1");
    expect(ladderHead("IAP", 0, 2).badge).toBe("서비스 1 / 2");
  });

  it("[REQ-111] 빼면 그 서비스를 부르던 줄도 없어진다", () => {
    const web = own();
    const caller: ServiceDraft = { ...own("호출하는 쪽"), key: "x", calls: [web.key] };
    const left = removeService([web, caller], 0);
    expect(left[0]?.calls).toBeUndefined();
  });

  it("[REQ-111] 서버 수는 고른 서비스의 숫자로만 센다 (IAP의 숫자는 들어가지 않는다)", () => {
    const only = [own()];
    const both = [iap, own()];
    expect(workloadServers(only)).toBeLessThan(workloadServers(both));
    expect(workloadServers(both) - workloadServers(only)).toBe(workloadServers([iap]));
    // 크기 줄도 같은 계산이다
    const spec = specOf(only);
    const view = sizeView({
      services: only,
      size: defaultSize(only),
      start: defaultSize(only),
      plan: planShape(spec),
    });
    expect(view.startLine).toContain(`${workloadServers(only)}대쯤`);
  });

  it("[REQ-111] 내 카드만으로 세계가 만들어지고 IAP 서비스는 들어 있지 않다", () => {
    const spec = specOf([own()]);
    expect(shapeProblem(spec)).toBeUndefined();
    const made = generateShaped(spec);
    expect(made.counts.services).toBe(1);
    const names = made.blueprint.entities.filter((e) => e.kind === "service").map((e) => e.name);
    expect(names).toEqual(["내 정산 웹"]);
    expect(shapeView(spec).scenarios).toBeGreaterThan(0);
  });

  it("[REQ-111] 서비스가 0개면 다음은 막히고 이유는 한 줄이다", () => {
    expect(noServicesReason(0)).toBe("서비스를 하나는 골라야 다음으로 갈 수 있어요");
    expect(noServicesReason(1)).toBeUndefined();
    expect(shapeProblem(specOf([]))).toBe("서비스를 하나는 골라 주세요");
  });

  it("[REQ-111] 이름은 건드리지 않았으면 첫 서비스를 따른다 (IAP가 없는데 'IAP 실험용'이면 거짓이다)", () => {
    expect(worldNameFor("IAP 실험용", [iap, own()])).toBe("IAP 실험용");
    expect(worldNameFor("IAP 실험용", [own()])).toBe("내 정산 웹 실험용");
    expect(worldNameFor("내가 정한 이름", [own()])).toBe("내가 정한 이름");
    expect(worldNameFor("IAP 실험용", [])).toBe("IAP 실험용");
  });

  it("[REQ-111] 키는 빠진 자리를 다시 쓰지 않아도 겹치지 않는다", () => {
    expect(catalogKey("web-api", [])).toBe("web-api");
    expect(catalogKey("web-api", ["web-api"])).toBe("web-api-2");
  });
});

describe("IAP를 뺀 세계의 초안 [REQ-111]", () => {
  beforeEach(() => worldDraft.clear());
  const draft = (services: readonly ServiceDraft[]): WorldDraft => ({
    v: 1,
    services,
    manual: {},
    apart: {},
    size: {},
    name: DEFAULT_SHAPE.name,
    step: "ladders",
    ladder: 0,
    metas: {},
    cost: 0,
  });

  it("[REQ-111] IAP를 뺀 것도, 다 뺀 것도 이어서 할 만한 세계로 남고 그대로 읽힌다", () => {
    for (const services of [[own()], []]) {
      const d = draft(services);
      expect(worthKeeping(d, iap, DEFAULT_SHAPE.name)).toBe(true);
      worldDraft.write(d);
      expect(worldDraft.read()?.services.map((s) => s.key)).toEqual(services.map((s) => s.key));
    }
  });
});

describe("③의 숫자는 하나의 계산이다 [REQ-111]", () => {
  it("[REQ-111] 화면의 합계와 서버·랙·서버룸이 만들어진 세계와 같다 (내 카드만 있을 때도)", () => {
    for (const services of [[iap], [own()], [iap, own()]]) {
      const spec = specOf(services);
      const size = defaultSize(services);
      const view = sizeView({ services, size, start: size, plan: planShape(spec) });
      const made = generateShaped(spec).counts;
      expect(view.totals.servers).toBe(made.servers);
      expect(view.totals.racks).toBe(made.racks);
      expect(view.totals.baseRacks).toBe(made.baseRacks);
      expect(view.totals.rooms).toBe(made.rooms);
      expect(view.totalLine).toContain(`서버 ${made.servers}대`);
      expect(view.totalLine).toContain(
        `서버 랙 ${made.racks - made.baseRacks} + 기반 랙 ${made.baseRacks}`,
      );
    }
  });
});
