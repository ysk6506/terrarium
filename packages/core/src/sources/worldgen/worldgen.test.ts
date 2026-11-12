import { Catalog } from "@terrarium/core/catalog";
import { BlueprintIndex, blueprintDigest, type Entity } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_WORLDGEN,
  generateWorld,
  MAX_RACKS,
  rackCount,
  SITE_PRESETS,
  sitePreset,
  specProblems,
  type WorldgenSpec,
} from ".";

const catalog = new Catalog();
const spec = (extra: Partial<WorldgenSpec> = {}): WorldgenSpec => ({
  ...DEFAULT_WORLDGEN,
  rows: 2,
  racksPerRow: 4,
  site: "hwaseong",
  seed: 3,
  ...extra,
});

const ofKind = (entities: readonly Entity[], kind: Entity["kind"]) =>
  entities.filter((e) => e.kind === kind);

describe("worldgen presets [REQ-035] [REQ-009]", () => {
  test("the six Samsung sites are presets with Korean names and a land size", () => {
    expect(SITE_PRESETS.map((p) => p.name)).toEqual([
      "기흥사업장",
      "화성사업장",
      "온양사업장",
      "천안사업장",
      "수원사업장",
      "평택사업장",
    ]);
    for (const p of SITE_PRESETS) expect(p.land.w * p.land.d).toBeGreaterThan(100_000);
    expect(new Set(SITE_PRESETS.map((p) => p.code)).size).toBe(6);
    expect(sitePreset("pyeongtaek")?.code).toBe("pt");
    expect(sitePreset("seoul")).toBeUndefined();
  });

  test.each(SITE_PRESETS.map((p) => [p.id]))("%s: the default world is valid", (site) => {
    const result = generateWorld(
      { ...DEFAULT_WORLDGEN, site: site as WorldgenSpec["site"], seed: 1 },
      catalog,
    );
    expect(result.issues).toEqual([]);
    const site0 = result.blueprint.entities.find((e) => e.kind === "site");
    expect(site0).toMatchObject({ name: sitePreset(site)?.name, props: { preset: site } });
  });
});

describe("worldgen output [REQ-009] [REQ-001]", () => {
  test("the same spec and seed give the same world; another seed gives another", () => {
    const a = generateWorld(spec(), catalog).blueprint;
    expect(blueprintDigest(generateWorld(spec(), catalog).blueprint)).toBe(blueprintDigest(a));
    expect(blueprintDigest(generateWorld(spec({ seed: 4 }), catalog).blueprint)).not.toBe(
      blueprintDigest(a),
    );
    expect(a).toMatchObject({
      id: "hs-3",
      name: "화성사업장 데이터센터",
      meta: { source: "worldgen", site: "hwaseong", seed: 3 },
    });
    expect(generateWorld(spec({ name: "실험용 홀" }), catalog).blueprint.name).toBe("실험용 홀");
  });

  test("the hierarchy follows the spec: buildings, floors, rooms, rows of racks", () => {
    const result = generateWorld(
      spec({ buildings: 2, floors: 3, roomsPerFloor: 2, rows: 2, racksPerRow: 3 }),
      catalog,
    );
    expect(result.issues).toEqual([]);
    const { entities } = result.blueprint;
    expect(ofKind(entities, "building").map((e) => e.name)).toEqual(["DC1동", "DC2동"]);
    expect(ofKind(entities, "floor")).toHaveLength(6);
    expect(
      ofKind(entities, "room")
        .map((e) => e.name)
        .slice(0, 2),
    ).toEqual(["1F-A 서버룸", "1F-B 서버룸"]);
    expect(ofKind(entities, "rack")).toHaveLength(2 * 3 * 2 * 2 * 3);
    expect(result.stats.rack).toBe(72);
  });

  test("A/B power: every server and switch is fed by both sides; single feed has one", () => {
    const check = (redundancy: WorldgenSpec["powerRedundancy"], feeds: number) => {
      const { blueprint } = generateWorld(spec({ powerRedundancy: redundancy }), catalog);
      const index = new BlueprintIndex(blueprint);
      for (const kind of ["server", "switch", "storage"] as const)
        for (const e of index.ofKind(kind))
          expect([e.id, index.outgoing(e.id, "power").length]).toEqual([e.id, feeds]);
      expect(index.ofKind("ups")).toHaveLength(feeds);
      expect(index.ofKind("power_panel")).toHaveLength(feeds);
    };
    check("2N", 2);
    check("N", 1);
  });

  test("cooling is sized for the load with the requested redundancy, and every rack is cooled", () => {
    const units = (r: WorldgenSpec["coolingRedundancy"]) =>
      ofKind(
        generateWorld(spec({ coolingRedundancy: r }), catalog).blueprint.entities,
        "cooling_unit",
      ).length;
    const n = units("N");
    expect(units("N+1")).toBe(n + 1);
    expect(units("2N")).toBe(2 * n);
    const index = new BlueprintIndex(generateWorld(spec(), catalog).blueprint);
    for (const rack of index.ofKind("rack"))
      expect(index.outgoing(rack.id, "cooling").length).toBe(n + 1);
  });

  test("racks stay within 80% of PDU capacity at full load", () => {
    const { blueprint } = generateWorld(spec({ fill: 0.9, gpuShare: 0.5, rows: 3 }), catalog);
    const index = new BlueprintIndex(blueprint);
    for (const rack of index.ofKind("rack")) {
      const peak = index.childrenOf(rack.id).reduce((sum, d) => {
        const model = d.modelId ? catalog.get(d.modelId) : undefined;
        if (!model) return sum;
        return (
          sum + ("maxPowerW" in model ? model.maxPowerW : "powerW" in model ? model.powerW : 0)
        );
      }, 0);
      expect(peak).toBeLessThanOrEqual(0.8 * 17_300);
    }
  });

  test("hosts idle below 60% CPU with their VMs; GPU servers carry no VMs", () => {
    const { blueprint } = generateWorld(spec({ vmsPerHost: 30 }), catalog);
    const index = new BlueprintIndex(blueprint);
    for (const host of index.ofKind("server")) {
      const model = catalog.getOf(host.modelId ?? "", "server");
      const vms = index.incoming(host.id, "runs_on").map((l) => index.entity(l.from));
      if (host.modelId === "srv-4u-gpu") expect(vms).toEqual([]);
      const load = vms.reduce(
        (s, vm) => s + Number(vm.props.cpuCount) * Number(vm.props.cpuDemand),
        0,
      );
      const util = Number(host.props.cpuUtil) + load / (model.cpuSockets * model.coresPerSocket);
      expect(util).toBeLessThanOrEqual(0.61);
    }
  });

  test("virtualisation: a cluster per room under one vCenter, VMs on datastores backed by arrays", () => {
    const index = new BlueprintIndex(generateWorld(spec({ roomsPerFloor: 2 }), catalog).blueprint);
    expect(index.ofKind("vcenter")).toHaveLength(1);
    const clusters = index.ofKind("cluster");
    expect(clusters).toHaveLength(2);
    for (const c of clusters)
      expect(index.outgoing(c.id, "managed_by").map((l) => l.to)).toEqual(["hs-vc"]);
    for (const vm of index.ofKind("vm")) {
      expect(index.outgoing(vm.id, "runs_on")).toHaveLength(1);
      const ds = index.outgoing(vm.id, "stored_on")[0]?.to as string;
      expect(index.outgoing(ds, "backed_by")[0]?.to).toMatch(/-stor$/);
    }
    const bare = generateWorld(spec({ vmsPerHost: 0 }), catalog).stats;
    expect([bare.vm, bare.cluster, bare.vcenter, bare.storage, bare.datastore]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("containment pairs rows facing a cold aisle, or back to back for a hot aisle", () => {
    const rooms = (containment: WorldgenSpec["containment"]) =>
      ofKind(
        generateWorld(spec({ rows: 4, containment }), catalog).blueprint.entities,
        "containment",
      ).map((c) => c.name);
    expect(rooms("cold")).toEqual(["1F-A 서버룸 냉복도 1", "1F-A 서버룸 냉복도 2"]);
    expect(rooms("hot")).toEqual(["1F-A 서버룸 열복도 1"]);
    expect(rooms("none")).toEqual([]);
  });

  test("BMC product versions are mixed, so protocol answers vary across servers", () => {
    const servers = ofKind(
      generateWorld(spec({ rows: 4, racksPerRow: 8 }), catalog).blueprint.entities,
      "server",
    );
    const profiles = new Set(servers.map((s) => s.props.bmcProfile));
    expect([...profiles].sort()).toEqual(["bmc-gen14/4.40", "bmc-gen16/7.10", "bmc-lite/2.80"]);
  });
});

describe("worldgen limits [REQ-009]", () => {
  test("a spec outside the limits is refused with every reason in Korean", () => {
    const bad = {
      ...spec(),
      buildings: 0,
      fill: 2,
      rows: 1.5,
      site: "seoul",
      seed: 0.5,
      containment: "glass",
    } as unknown as WorldgenSpec;
    expect(specProblems(bad)).toEqual([
      "알 수 없는 사업장 'seoul'",
      "다시 만들기 번호는 정수여야 해요",
      "건물 수: 1~4 사이의 정수여야 해요 (지금 0)",
      "서버룸당 랙 줄: 1~12 사이의 정수여야 해요 (지금 1.5)",
      "랙 채움 비율: 0.1~0.9 사이여야 해요 (지금 2)",
      "컨테인먼트: 알 수 없는 값 'glass'",
    ]);
    expect(() => generateWorld(bad, catalog)).toThrow(/세계를 만들 수 없어요: 알 수 없는 사업장/);
  });

  test("worlds are capped in size", () => {
    const huge = spec({ buildings: 4, floors: 8, roomsPerFloor: 4, rows: 12, racksPerRow: 20 });
    expect(rackCount(huge)).toBeGreaterThan(MAX_RACKS);
    expect(specProblems(huge)).toEqual([
      `랙이 ${rackCount(huge)}개예요. 한 세계는 ${MAX_RACKS}개까지 만들 수 있어요`,
    ]);
    expect(specProblems(spec())).toEqual([]);
  });
});
