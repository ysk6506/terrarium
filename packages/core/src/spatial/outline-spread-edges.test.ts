import { describe, expect, test } from "vitest";
import { packSpread } from ".";

describe("buildings spread over land that is hard to fill [REQ-048]", () => {
  const land = [
    { x: 0, y: 0 },
    { x: 600, y: 0 },
    { x: 600, y: 400 },
    { x: 0, y: 400 },
  ];

  test("buildings of the same size are told apart by their id, so the same input gives the same land", () => {
    const items = [
      { id: "b", w: 100, d: 60 },
      { id: "a", w: 100, d: 60 },
    ];
    const first = packSpread(items, land, { gap: 40, setback: 30 });
    const again = packSpread([...items].reverse(), land, { gap: 40, setback: 30 });
    expect(first).toEqual(again);
    expect(first.placed.map((p) => p.id)).toEqual(["a", "b"]);
  });

  test("land held back so far from its edge that nothing is left holds nothing and keeps all of them out", () => {
    const thin = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 400 },
      { x: 0, y: 400 },
    ];
    const { placed, unplaced } = packSpread(
      [
        { id: "a", w: 20, d: 20 },
        { id: "b", w: 20, d: 20 },
      ],
      thin,
      { gap: 10, setback: 50 },
    );
    expect(placed).toEqual([]);
    expect(unplaced).toEqual(["a", "b"]);
  });
});
