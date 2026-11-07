import { SERVICE_CATALOG } from "@terrarium/core/world";
import { describe, expect, it } from "vitest";
import {
  askOf,
  askTotal,
  DEFAULT_SHAPE,
  defaultSize,
  draftFromCard,
  fillFor,
  generateShaped,
  planShape,
  type ServiceDraft,
  type ShapeSpec,
  SIZE_LIMITS,
  serversForLoad,
  shapeProblem,
  sizeFields,
  sizeFor,
  sizeFromServers,
  sizeProblem,
  sizeTotals,
  sizingNotes,
} from "./index";

const card = (id: string) =>
  SERVICE_CATALOG.find((c) => c.id === id) as (typeof SERVICE_CATALOG)[0];
const withSize = (
  spec: ShapeSpec,
  rooms: number,
  racksPerRoom: number,
  perRack: number,
): ShapeSpec => ({
  ...spec,
  ...sizeFields({ rooms, racksPerRoom, perRack }),
});

describe("서버 수는 세 숫자 [REQ-109]", () => {
  it("[REQ-109] 서버 수식: 요청 50/초 · 사람 100명 · 데이터 250 GB · GPU 100시간마다 서버 한 대", () => {
    expect(serversForLoad({ rps: 300, dataGB: 2_000, users: 1_200, maxDowntimeS: 60 })).toBe(
      6 + 12 + 8,
    );
    expect(serversForLoad({ rps: 0, dataGB: 0, users: 0, maxDowntimeS: 60 })).toBe(0);
    expect(serversForLoad({ rps: 0, dataGB: 0, users: 0, maxDowntimeS: 60, gpuHours: 5_000 })).toBe(
      50,
    );
  });

  it("[REQ-109] 숫자가 클수록 시작 값은 줄지 않고, 늘 한계 안이고, 같은 입력이면 같다", () => {
    let last = 0;
    for (const rps of [0, 100, 1_000, 10_000, 100_000, 1_000_000]) {
      const a = defaultSize([
        { key: "x", load: { rps, dataGB: 100, users: 100, maxDowntimeS: 60 } },
      ]);
      expect(sizeProblem(a)).toBeUndefined();
      expect(askTotal(a)).toBeGreaterThanOrEqual(last);
      expect(a).toEqual(
        defaultSize([{ key: "x", load: { rps, dataGB: 100, users: 100, maxDowntimeS: 60 } }]),
      );
      last = askTotal(a);
    }
  });

  it("[REQ-109] 기본 서비스(IAP)는 서버룸 하나, 서비스가 클수록 서버룸과 랙이 서비스에 맞게 늘어난다", () => {
    expect(defaultSize(DEFAULT_SHAPE.services)).toEqual({ rooms: 1, racksPerRoom: 6, perRack: 20 });
    const big = defaultSize([
      draftFromCard(card("file-share"), []),
      draftFromCard(card("cache"), []),
    ]);
    expect(big.rooms).toBeGreaterThan(1);
    expect(askTotal(big)).toBeGreaterThan(askTotal(defaultSize(DEFAULT_SHAPE.services)));
  });

  it("[REQ-109] 옛 spec의 서버 수는 같은 세계를 말하는 세 숫자로 옮겨진다", () => {
    for (const servers of [48, 480, 4_800]) {
      const a = sizeFromServers(servers);
      expect(askTotal(a)).toBeGreaterThanOrEqual(servers);
      expect(askTotal(a)).toBeLessThan(servers + a.rooms * a.racksPerRoom * 0 + 60);
      expect(sizeProblem(a)).toBeUndefined();
    }
    expect(sizeFor(480)).toEqual({ rooms: 1, racksPerRoom: 24, perRack: 20 });
  });

  it("[REQ-109] 세 숫자 없이 서버 수만 보내도 전과 같은 계획이 나온다 (호환)", () => {
    const legacy = planShape(DEFAULT_SHAPE);
    expect(askOf(DEFAULT_SHAPE)).toBeUndefined();
    expect(legacy.computeRacks).toBe(24);
    expect(legacy.servers).toBe(480);
    expect(legacy.fill).toBe(0.8);
    expect(shapeProblem(DEFAULT_SHAPE)).toBeUndefined();
    expect(shapeProblem({ ...DEFAULT_SHAPE, servers: 5 })).toMatch(/서버는 12/);
  });

  it("[REQ-109] 세 숫자가 있으면 그 곱이 서버 수이고 랙과 서버룸은 숫자대로 선다", () => {
    const spec = withSize(DEFAULT_SHAPE, 2, 24, 24);
    const plan = planShape(spec);
    expect(spec.servers).toBe(1_152);
    expect(plan.servers).toBe(1_152);
    expect(plan.rooms).toBe(2);
    expect(sizeTotals(plan)).toEqual({ servers: 1_152, racks: 48, rooms: 2 });
    expect(plan.fill).toBe(fillFor(24));
    expect(sizingNotes({ rooms: 2, racksPerRoom: 24, perRack: 24 }, plan)).toEqual([]);
  });

  it("[REQ-109] 사이트가 둘이면 서버룸·랙·서버가 같은 만큼 더 들어가고 한 줄로 알려 준다", () => {
    const spec = {
      ...withSize(DEFAULT_SHAPE, 1, 24, 20),
      layers: { ...DEFAULT_SHAPE.layers, site: "site-dr-warm" },
    };
    const plan = planShape(spec);
    expect(plan.buildings).toBe(2);
    expect(plan.rooms).toBe(2);
    expect(plan.servers).toBe(960);
    const notes = sizingNotes({ rooms: 1, racksPerRoom: 24, perRack: 20 }, plan);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/건물이 2동/);
  });

  it("[REQ-109] 학습 클러스터는 GPU 랙을 따로 더하고 그 합계에 GPU 서버가 들어간다", () => {
    const spec = {
      ...withSize(DEFAULT_SHAPE, 1, 24, 20),
      layers: {
        ...DEFAULT_SHAPE.layers,
        accel: "gpu-training-cluster",
        network: "net-leaf-spine",
        cooling: "cool-n1",
      },
    };
    const plan = planShape(spec);
    expect(plan.denseRacks).toBeGreaterThan(0);
    const total = sizeTotals(plan);
    expect(total.servers).toBe(plan.servers + plan.gpuServers);
    expect(total.racks).toBeGreaterThan(24);
    expect(sizingNotes({ rooms: 1, racksPerRoom: 24, perRack: 20 }, plan).join()).toMatch(/GPU 랙/);
  });

  it("[REQ-109] 서비스가 쓰는 호스트가 더 많으면 서버 수를 맞춰 올리고 그렇다고 말한다", () => {
    const keys: string[] = ["iap"];
    const services = [
      DEFAULT_SHAPE.services[0] as ServiceDraft,
      ...["web-api", "app-db", "k8s-platform", "message-queue"].map((id) => {
        const d = draftFromCard(card(id), keys);
        keys.push(d.key);
        return d;
      }),
    ];
    const spec = { ...withSize(DEFAULT_SHAPE, 1, 3, 4), services };
    const plan = planShape(spec);
    expect(plan.servers).toBeGreaterThan(12);
    expect(sizingNotes({ rooms: 1, racksPerRoom: 3, perRack: 4 }, plan).join()).toMatch(/호스트/);
  });

  it("[REQ-109] 한계 밖의 숫자와 셋 중 일부만 보낸 요청은 말로 거절한다", () => {
    expect(shapeProblem(withSize(DEFAULT_SHAPE, 9, 24, 20))).toMatch(/서버룸은 1~8/);
    expect(shapeProblem(withSize(DEFAULT_SHAPE, 1, 300, 20))).toMatch(/룸당 랙/);
    expect(shapeProblem(withSize(DEFAULT_SHAPE, 1, 24, 30))).toMatch(/랙당 서버/);
    expect(shapeProblem(withSize(DEFAULT_SHAPE, 8, 228, 22))).toMatch(/모두 12~4,800/);
    expect(shapeProblem({ ...DEFAULT_SHAPE, rooms: 2 })).toMatch(/셋 다/);
    expect(SIZE_LIMITS.servers.max).toBe(4_800);
  });

  it("[REQ-109] 세 숫자로 짓는 세계도 그대로 만들어지고, 같은 숫자면 같은 세계다", () => {
    const spec = withSize(DEFAULT_SHAPE, 1, 6, 20);
    const a = generateShaped(spec);
    const b = generateShaped(spec);
    expect(a.counts).toEqual(b.counts);
    expect(a.counts.rooms).toBe(1);
    expect(a.counts.racks).toBeGreaterThanOrEqual(6);
    expect(a.counts.servers).toBeGreaterThan(60);
  });
});
