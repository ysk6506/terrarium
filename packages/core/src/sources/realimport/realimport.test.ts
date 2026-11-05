import { Catalog } from "@terrarium/core/catalog";
import { BlueprintIndex, blueprintDigest } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  assertReadOnly,
  CLOUD_TOPOLOGY_MAPPING,
  classify,
  importReality,
  MemorySource,
  READ_QUERIES,
  readAll,
  sampleGraph,
} from ".";

const catalog = new Catalog();
const sample = () => new MemorySource("sample", sampleGraph());
const run = (options = {}) =>
  importReality(sample(), { siteName: "기흥사업장(샘플)", catalog, ...options });

describe("read-only Cypher [REQ-011]", () => {
  test.each([
    "CREATE (n:X)",
    "MATCH (n) SET n.x = 1",
    "MATCH (n) DETACH DELETE n",
    "merge (n:X {id: 1})",
    "MATCH (n) REMOVE n.x",
    "DROP INDEX ON :X(id)",
    "LOAD CSV FROM 'f' AS row RETURN row",
    "MATCH (n) // looks harmless\n set n.y = 2",
    "MATCH (n) FOREACH (x IN [1] | SET n.z = x)",
    "CALL db.idx.fulltext.createNodeIndex('X', 'name')",
  ])("refuses a writing query: %s", (query) => {
    expect(() => assertReadOnly(query)).toThrow(/only reads reality/);
  });

  test("words like SET inside strings, names, comments or longer identifiers do not trip it", () => {
    for (const query of [
      "MATCH (n {name: 'SET DELETE CREATE'}) RETURN n",
      'MATCH (n) WHERE n.note = "please merge later" RETURN n',
      "MATCH (n:`CREATE`) RETURN n",
      "MATCH (n) /* DELETE nothing */ RETURN n.offset, n.asset, n.reset_count SKIP $offset",
    ])
      expect(() => assertReadOnly(query)).not.toThrow();
  });

  test("the adapter queries are read-only and refuse labels that are not plain names", () => {
    const q = READ_QUERIES.nodes("PhysicalServer", 0, 500);
    expect(q).toEqual({
      text: "MATCH (n:PhysicalServer) RETURN ID(n) AS id, labels(n) AS labels, properties(n) AS props ORDER BY ID(n) SKIP $offset LIMIT $limit",
      params: { offset: 0, limit: 500 },
    });
    expect(READ_QUERIES.relationships("COOLED_BY", 500, 500).params).toEqual({
      offset: 500,
      limit: 500,
    });
    expect(READ_QUERIES.labels().text).toContain("labels(n)");
    expect(READ_QUERIES.relationshipTypes().text).toContain("type(r)");
    expect(() => READ_QUERIES.nodes("X) DETACH DELETE n //", 0, 1)).toThrow(/not a plain label/);
    expect(() => READ_QUERIES.relationships("A-B", 0, 1)).toThrow(/not a plain label/);
  });
});

describe("memory source [REQ-010]", () => {
  test("summarises, pages and reads every page", async () => {
    const source = sample();
    const summary = await source.summary();
    expect(summary.labels.RACK).toBe(12);
    expect(summary.relationships.COOLED_BY).toBe(6);
    const first = await source.nodes("RACK", { offset: 0, limit: 5 });
    expect(first).toHaveLength(5);
    expect(await readAll((p) => source.nodes("RACK", p), 5)).toHaveLength(12);
    expect(await readAll((p) => source.relationships("COOLED_BY", p), 4)).toHaveLength(6);
    expect(await readAll((p) => source.nodes("Nothing", p), 5)).toEqual([]);
  });
});

describe("classification [REQ-010]", () => {
  test("rules are tried in order, filters apply, and relationships may be stored either way round", () => {
    const g = sampleGraph();
    const c = classify(CLOUD_TOPOLOGY_MAPPING, g.nodes, g.relationships);
    const roleOf = (name: string) => [...c.nodes.values()].find((n) => n.name === name)?.role;
    expect(roleOf("dsr3-pflex-01")).toBe("storage");
    expect(roleOf("dsr3-a01-01-01")).toBe("server");
    expect(roleOf("dsr3-a01-01-01.esx.internal")).toBe("hypervisor");
    expect(roleOf("bd-tor-07")).toBeUndefined();
    expect(c.filteredOut).toEqual({ NetworkSwitch: 1, VDS: 1, PortGroup: 1, LoadBalancer: 1 });
    expect(c.relations.filter((r) => r.means === "port_owner")).toHaveLength(64);
    expect(c.unmatched).toEqual({ USES_VSWITCH: 1, MONITORED_BY: 1 });
  });

  test("a node with no name property is named after its label and id", () => {
    const c = classify(CLOUD_TOPOLOGY_MAPPING, [{ id: "9", labels: ["RACK"], props: {} }], []);
    expect(c.nodes.get("9")?.name).toBe("RACK-9");
  });
});

describe("importing the sample graph [REQ-010] [REQ-012] [REQ-013]", () => {
  test("a valid world comes out, and the report accounts for everything read", async () => {
    const { blueprint, report } = await run();
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(report).toMatchObject({
      source: "sample",
      mapping: "cloud_topology",
      unknown: { labels: { LoadBalancer: 1 }, relationships: { MONITORED_BY: 1 } },
      ignored: { labels: { VDS: 1, PortGroup: 1 }, relationships: { USES_VSWITCH: 1 } },
      filteredOut: { NetworkSwitch: 1 },
      placement: {
        hypervisorsMerged: 32,
        hypervisorsAlone: 1,
        unplacedDevices: 2,
        unplacedRacks: 1,
      },
    });
    expect(report.entities).toMatchObject({
      server: 34,
      storage: 1,
      switch: 14,
      vm: 66,
      rack: 13,
      room: 3,
    });
    expect(blueprint.meta).toEqual({
      source: "realimport",
      from: "sample",
      mapping: "cloud_topology",
    });
  });

  test("ESXi hosts merge into their physical servers; VMs and clusters follow", async () => {
    const index = new BlueprintIndex((await run()).blueprint);
    const server = index.entity("srv-dsr3-a01-01-01");
    expect(server.props).toMatchObject({
      esxiName: "dsr3-a01-01-01.esx.internal",
      serial: "SN10001",
      sourceLabel: "PhysicalServer",
    });
    expect(index.incoming(server.id, "runs_on").map((l) => l.from)).toEqual([
      "vm-vm-app-01-1",
      "vm-vm-app-01-2",
    ]);
    expect(index.outgoing(server.id, "member_of").map((l) => l.to)).toEqual(["cl-cl-dsr3-a"]);
    expect(index.outgoing("cl-cl-dsr3-a", "managed_by").map((l) => l.to)).toEqual(["vc-vcsa-dsr3"]);
    expect(
      index
        .ofKind("server")
        .some((s) => s.name.endsWith(".esx.internal") && s.name !== "dsr3-orphan-esx.esx.internal"),
    ).toBe(false);
  });

  test("NIC-port chains become server-to-switch links carrying the port names; storage keeps its direct link", async () => {
    const index = new BlueprintIndex((await run()).blueprint);
    expect(index.outgoing("srv-dsr3-a01-01-02", "network")).toEqual([
      expect.objectContaining({
        to: "sw-tor-a01-01",
        props: { fromPort: "vmnic0", toPort: "Ethernet2/1" },
      }),
    ]);
    expect(index.outgoing("stor-dsr3-pflex-01", "network")).toEqual([
      expect.objectContaining({ to: "sw-tor-a01-01", props: { port: "Ethernet20/1" } }),
    ]);
    expect(index.outgoing("sw-tor-a01-01", "network").map((l) => l.to)).toEqual([
      "sw-dsr3-spine-01",
      "sw-dsr3-spine-02",
    ]);
  });

  test("storage volumes fold into datastore-backed-by-array", async () => {
    const index = new BlueprintIndex((await run()).blueprint);
    expect(index.outgoing("ds-pflex-ds-01", "backed_by").map((l) => l.to)).toEqual([
      "stor-dsr3-pflex-01",
    ]);
    expect(index.incoming("ds-pflex-ds-01", "stored_on")).toHaveLength(66);
  });

  test("rooms, racks and units come from relationships first, then location properties", async () => {
    const index = new BlueprintIndex((await run()).blueprint);
    const roomOf = (id: string) => index.enclosing(id, "room")?.name;
    expect(roomOf("rack-a01-01")).toBe("3F_A_Datacenter");
    expect(roomOf("rack-a01-02")).toBe("3F_A_Datacenter"); // placed by floor_info only
    expect(roomOf("rack-b02-02")).toBe("3F_B_Datacenter");
    expect(index.entity("srv-dsr3-a01-01-01").placement).toEqual({ type: "unit", u: 4 });
    expect(index.entity("srv-dsr3-a01-01-02").placement).toEqual({ type: "unit", u: 8 });
    const unplaced = index.entity(index.entity("srv-dsr3-unknown-01").parentId as string);
    expect(unplaced).toMatchObject({ name: "미배치 1", props: { unplaced: true } });
    expect(unplaced.id).toMatch(/-unplaced-1$/);
    expect(index.ancestors("rack-a01-01").map((e) => e.name)).toEqual([
      "3F_A_Datacenter",
      "3F",
      "DSR동_C타워",
      "기흥사업장(샘플)",
    ]);
  });

  test("power and missing cooling are assumed, sized, marked and reported; real cooling is kept", async () => {
    const { blueprint, report } = await run();
    const index = new BlueprintIndex(blueprint);
    expect(report.assumptions).toEqual([
      "3F_B_Datacenter: 냉방 설비 정보가 없어 CRAH 2대(N+1)를 가정했어요",
      "미분류 서버룸: 냉방 설비 정보가 없어 CRAH 2대(N+1)를 가정했어요",
      "냉방 관계가 없는 랙 7개는 같은 서버룸의 냉방기가 식힌다고 가정했어요",
      "그래프에 전력 정보가 없어 랙마다 A/B PDU, 서버룸마다 A/B 분전반, 층마다 A/B UPS를 부하에 맞춰 가정했어요 (synthesized 표시)",
    ]);
    for (const kind of ["pdu", "power_panel", "ups"] as const)
      for (const e of index.ofKind(kind)) expect(e.props.synthesized).toBe(true);
    const real = index.ofKind("cooling_unit").filter((u) => u.props.sourceLabel === "HVAC");
    expect(real.map((u) => u.name)).toEqual(["HVAC-3F-A-1", "HVAC-3F-A-2"]);
    expect(index.outgoing("srv-dsr3-a01-01-01", "power")).toHaveLength(2);
    for (const unit of index.ofKind("cooling_unit"))
      expect(index.outgoing(unit.id, "power")).toHaveLength(1);
    expect(index.outgoing("rack-a01-01", "cooling").map((l) => l.to)).toEqual(["hvac-hvac-3f-a-1"]);
  });

  test("undersized real cooling is reported, not enlarged", async () => {
    const g = sampleGraph();
    // Room A keeps one in-row unit (30 kW) while its servers become 4U GPU boxes.
    const nodes = g.nodes
      .filter((n) => n.props.name !== "HVAC-3F-A-2")
      .map((n) => {
        if (n.labels.includes("HVAC")) return { ...n, props: { ...n.props, model: "In-Row 30kW" } };
        if (n.labels.includes("PhysicalServer") && n.props.u_height)
          return { ...n, props: { ...n.props, u_height: 4 } };
        return n;
      });
    const { blueprint, report } = await importReality(new MemorySource("dense", { ...g, nodes }), {
      catalog,
    });
    expect(report.assumptions).toContainEqual(
      expect.stringMatching(
        /^3F_A_Datacenter: 실제 냉방 용량\(30 kW\)이 예상 부하\(\d+ kW\)보다 작아요. 실제 장비라 늘리지 않았어요$/,
      ),
    );
    const units = new BlueprintIndex(blueprint)
      .ofKind("cooling_unit")
      .filter((u) => u.props.sourceLabel === "HVAC");
    expect(units.map((u) => u.modelId)).toEqual(["inrow-30kw"]);
  });

  test("without assumptions the gaps show up as warnings", async () => {
    const { report } = await run({ assume: { power: false, cooling: false } });
    expect(report.assumptions).toEqual([]);
    expect(report.issues.some((i) => i.code === "W020")).toBe(true);
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("a scope keeps chosen rooms and what still connects to them", async () => {
    const { blueprint, report } = await run({ rooms: ["3f_a"] });
    const index = new BlueprintIndex(blueprint);
    expect(index.ofKind("room").map((r) => r.name)).toEqual(["3F_A_Datacenter"]);
    expect(report.outOfScope.rooms).toBe(2);
    expect(report.outOfScope.links).toBeGreaterThan(0);
    for (const vm of index.ofKind("vm")) expect(index.outgoing(vm.id, "runs_on")).toHaveLength(1);
    expect(index.ofKind("vm").length).toBeLessThan(66);
    expect(index.ofKind("cluster")).toHaveLength(1);
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("an import that is too big asks for a narrower scope", async () => {
    await expect(run({ maxEntities: 50 })).rejects.toThrow(
      /가져올 대상이 \d+개로 너무 많아요 \(최대 50개\). 가져올 서버룸 범위를 좁혀 주세요/,
    );
  });

  test("the same graph imports to the same world", async () => {
    const a = await run({ pageSize: 7 });
    const b = await run();
    expect(blueprintDigest(a.blueprint)).toBe(blueprintDigest(b.blueprint));
  });
});
