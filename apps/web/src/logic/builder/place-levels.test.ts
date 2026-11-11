import { Catalog } from "@terrarium/core/catalog";
import { describe, expect, test } from "vitest";
import { placeKinds } from "./place";

const catalog = new Catalog();
const view = (over: Partial<Parameters<typeof placeKinds>[2]> = {}) => ({
  buildings: 1,
  forSale: 0,
  rooms: 1,
  roomFull: false,
  ...over,
});
const kinds = (level: Parameters<typeof placeKinds>[0], v = view()) =>
  placeKinds(level, catalog, v).map((k) => [k.id, k.direct?.kind, k.ask?.length] as const);

describe("놓기 목록은 서 있는 층에 맞는 것만 보여 준다 [REQ-102]", () => {
  test("땅 위에서는 땅·건물·건물 밖 설비를 보여 주고, 건물이 없으면 건물은 바로 놓는다", () => {
    expect(kinds({ kind: "site" }, view({ buildings: 0, forSale: 2, rooms: 0 }))).toEqual([
      ["land", undefined, 0],
      ["building", "tool", undefined],
      ["outside", undefined, 4],
    ]);
    expect(kinds({ kind: "site" })).toEqual([
      ["land", undefined, undefined],
      ["building", undefined, 4],
      ["outside", undefined, 4],
    ]);
  });

  test("층에서는 서버룸을 바로 놓고, 방이 있으면 다른 방도 고르게 한다", () => {
    expect(kinds({ kind: "floor", id: "f1" }, view({ buildings: 0, rooms: 0 }))).toEqual([
      ["rooms", "tool", undefined],
      ["power", undefined, 4],
    ]);
    expect(kinds({ kind: "floor", id: "f1" }).map((k) => k[0])).toEqual([
      "rooms",
      "other-rooms",
      "power",
    ]);
  });

  test("서버룸에서는 랙·복도 덮개·냉방기·전기 설비를 보여 주고, 랙이 가득 차면 방을 넓히게 한다", () => {
    expect(kinds({ kind: "room", id: "r1" }).map((k) => k[0])).toEqual([
      "racks",
      "aisle",
      "cooling",
      "power",
    ]);
    const full = kinds({ kind: "room", id: "r1" }, view({ roomFull: true }));
    expect(full[0]).toEqual(["racks", "widen", undefined]);
    expect(full.map((k) => k[0])).not.toContain("aisle");
  });

  test("냉방기의 줄에는 고를 수 있는 것의 이름이 가운뎃점으로 이어진다", () => {
    const cooling = placeKinds({ kind: "room", id: "r1" }, catalog, view()).find(
      (k) => k.id === "cooling",
    );
    expect(cooling?.line).toContain(" · ");
    expect(cooling?.line).not.toContain(" — ");
  });
});
