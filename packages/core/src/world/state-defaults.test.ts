import { Catalog } from "@terrarium/core/catalog";
import { describe, expect, test } from "vitest";
import { type Blueprint, BlueprintIndex, type Entity, type EntityKind, initialState } from ".";

const catalog = new Catalog();
const thing = (id: string, kind: EntityKind, extra: Partial<Entity> = {}): Entity => ({
  id,
  kind,
  name: id,
  props: {},
  ...extra,
});
const stateOf = (entities: Entity[]) => {
  const bp: Blueprint = { schemaVersion: 1, id: "b", name: "b", entities, links: [], meta: {} };
  return initialState(new BlueprintIndex(bp), catalog).entities;
};

describe("equipment with no model starts from plain defaults [REQ-001]", () => {
  test("a server, a cooling unit, a CDU and a chiller that name no model", () => {
    const s = stateOf([
      thing("srv", "server"),
      thing("crah", "cooling_unit"),
      thing("cdu", "cdu"),
      thing("chl", "chiller"),
    ]);
    expect(s.srv).toMatchObject({ kind: "server" });
    expect(s.crah).toMatchObject({ kind: "cooling_unit", capacityKw: 50, setpointC: 20 });
    expect(s.cdu).toMatchObject({ kind: "cdu", capacityKw: 500, setpointC: 32, supplyC: 32 });
    expect((s.cdu as { pumpsOk: boolean[] }).pumpsOk).toEqual([true, true, true]);
    expect(s.chl).toMatchObject({ kind: "chiller", capacityKw: 1000, supplyC: 12, returnC: 18 });
  });

  test("a model id the catalog does not know counts as no model", () => {
    const s = stateOf([thing("cdu", "cdu", { modelId: "no-such-model" })]);
    expect(s.cdu).toMatchObject({ capacityKw: 500 });
  });

  test("a model of another kind is not read as the equipment's own", () => {
    const serverModel = catalog.list().find((m) => m.kind === "server");
    expect(serverModel).toBeDefined();
    const s = stateOf([
      thing("cdu", "cdu", { modelId: serverModel?.id as string }),
      thing("chl", "chiller", { modelId: serverModel?.id as string }),
      thing("crah", "cooling_unit", { modelId: serverModel?.id as string }),
    ]);
    expect(s.cdu).toMatchObject({ capacityKw: 500 });
    expect(s.chl).toMatchObject({ capacityKw: 1000 });
    expect(s.crah).toMatchObject({ capacityKw: 50 });
  });

  test("a kind with no factory is just healthy", () => {
    expect(stateOf([thing("s", "site")]).s).toEqual({ kind: "site", health: "ok" });
  });

  test("props that are not numbers are ignored; numbers are taken", () => {
    const s = stateOf([
      thing("a", "server", { props: { cpuUtil: "high" } }),
      thing("b", "server", { props: { cpuUtil: 0.7 } }),
      thing("c", "cooling_unit", { props: { setpointC: "cold" } }),
      thing("d", "cooling_unit", { props: { setpointC: 17 } }),
      thing("e", "vm", { props: { cpuDemand: "lots" } }),
      thing("f", "vm", { props: { cpuDemand: 0.9 } }),
    ]);
    expect((s.a as { cpuUtil: unknown }).cpuUtil).not.toBe("high");
    expect(s.b).toMatchObject({ cpuUtil: 0.7 });
    expect(s.c).toMatchObject({ setpointC: 20 });
    expect(s.d).toMatchObject({ setpointC: 17 });
    expect(s.e).toMatchObject({ cpuDemand: 0.3 });
    expect(s.f).toMatchObject({ cpuDemand: 0.9 });
  });
});
