import { Catalog } from "@terrarium/core/catalog";
import { describe, expect, test } from "vitest";
import { type Blueprint, ENTITY_KINDS, type Entity, validateBlueprint } from ".";
import { withChanges } from "./test-support/sample";
import { campusBlueprint } from "./test-support/sample-campus";

const catalog = new Catalog();
const codes = (bp: Blueprint) =>
  validateBlueprint(bp, catalog).map((i) => `${i.code}@${i.entityId}`);
const get = (bp: Blueprint, id: string): Entity => bp.entities.find((e) => e.id === id) as Entity;
const moved = (bp: Blueprint, id: string, patch: Partial<Entity>) =>
  withChanges(bp, { entities: [{ ...get(bp, id), ...patch }] });
const parcel = (id: string, x: number, y: number, w: number, d: number, owned = true): Entity => ({
  id,
  kind: "parcel",
  name: id,
  parentId: "site",
  placement: { type: "area", x, y, w, d },
  props: owned ? {} : { owned: false },
});

describe("campus: land, buildings on it, plants and yards [REQ-043]", () => {
  test("the campus sample uses every kind of thing and has no problems at all", () => {
    const bp = campusBlueprint();
    expect(new Set(bp.entities.map((e) => e.kind)).size).toBe(ENTITY_KINDS.length);
    expect(validateBlueprint(bp, catalog)).toEqual([]);
  });

  test("a building has to stand on land the site owns", () => {
    const bp = campusBlueprint();
    // The building (10,10)-(70,50) sits inside the owned parcel; move it onto the parcel that is for sale.
    expect(codes(bp)).toEqual([]);
    expect(
      codes(moved(bp, "bldg", { placement: { type: "area", x: 115, y: 10, w: 60, d: 40 } })),
    ).toEqual(["W041@bldg"]);
    // Buy the parcel: now the same building is fine.
    const bought = moved(bp, "parcel-2", { props: {} });
    expect(
      codes(moved(bought, "bldg", { placement: { type: "area", x: 115, y: 10, w: 60, d: 40 } })),
    ).toEqual([]);
  });

  test("a building may straddle two owned parcels that touch, but not a gap between them", () => {
    const base = withChanges(campusBlueprint(), {
      remove: ["parcel-1", "parcel-2"],
      entities: [parcel("p-west", 0, 0, 60, 100), parcel("p-east", 60, 0, 80, 100)],
    });
    expect(codes(base)).toEqual([]);
    const gap = withChanges(base, { entities: [parcel("p-east", 70, 0, 80, 100)] });
    expect(codes(gap)).toEqual(["W041@bldg"]);
  });

  test("parcels cannot overlap each other", () => {
    const bp = withChanges(campusBlueprint(), { entities: [parcel("parcel-3", 100, 5, 30, 30)] });
    expect(codes(bp)).toContain("W040@parcel-3");
  });

  test("a site without any parcel keeps working as before: buildings are not checked against land", () => {
    const bp = withChanges(campusBlueprint(), { remove: ["parcel-1", "parcel-2"] });
    expect(codes(bp)).toEqual([]);
  });

  test("plant equipment stands on the site grounds, not in a hall, and may not overlap other yard equipment", () => {
    const bp = campusBlueprint();
    // A chiller cannot be put into a server room; the yard is the only place for it.
    const inHall = moved(bp, "chiller-1", {
      parentId: "hall",
      placement: { type: "spot", x: 3, y: 8, rotation: 0 },
    });
    expect(codes(inHall)).toContain("W004@chiller-1");
    const crowded = moved(bp, "gen-1", { placement: { type: "spot", x: 80, y: 15, rotation: 0 } });
    expect(codes(crowded)).toContain("W008@gen-1");
  });
});

describe("liquid cooling must fit and be connected [REQ-044]", () => {
  const server = (id: string, rack: string, modelId: string, u = 30): Entity => ({
    id,
    kind: "server",
    name: id,
    parentId: rack,
    modelId,
    placement: { type: "unit", u },
    props: {},
  });

  test("a server has to be built for how its rack is cooled", () => {
    const bp = campusBlueprint();
    const into = (rack: string, modelId: string) =>
      codes(withChanges(bp, { entities: [server("srv-x", rack, modelId)] })).filter((c) =>
        c.startsWith("W030"),
      );
    expect(into("rack-l", "ax-4u-8gpu-dlc")).toEqual([]);
    expect(into("tank-1", "sm-2u-imm")).toEqual([]);
    expect(into("rack-a", "srv-2u-compute")).toEqual([]);
    // Cold plates are not made for a plain air rack, and a tank only takes immersion chassis.
    expect(into("rack-a", "ax-4u-8gpu-dlc")).toEqual(["W030@srv-x"]);
    expect(into("rack-a", "sm-2u-imm")).toEqual(["W030@srv-x"]);
    expect(into("tank-1", "srv-2u-compute")).toEqual(["W030@srv-x"]);
    // An air server may sit in a liquid rack: the room still carries its heat.
    expect(into("rack-l", "srv-2u-compute")).toEqual([]);
  });

  test("a liquid rack, a CDU and a chilled-water unit each need something to take their heat", () => {
    const bp = campusBlueprint();
    const cut = (from: string, to: string) =>
      withChanges(bp, {
        remove: bp.links
          .filter((l) => l.kind === "cooling" && l.from === from && l.to === to)
          .map((l) => l.id),
      });
    expect(codes(cut("rack-l", "cdu-1"))).toEqual(["W031@rack-l"]);
    expect(codes(cut("tank-1", "cdu-1"))).toEqual(["W031@tank-1"]);
    expect(codes(cut("cdu-1", "chiller-1"))).toEqual(["W032@cdu-1"]);
    const chilled = withChanges(bp, {
      entities: [{ ...get(bp, "crah-1"), modelId: "cv-crah-250kw-chw" }],
    });
    expect(codes(chilled)).toEqual(["W033@crah-1"]);
  });
});
