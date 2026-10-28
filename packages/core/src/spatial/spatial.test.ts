import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  bounds,
  cableLength,
  center,
  contains,
  DEFAULT_KEYS,
  DEFAULT_LAYOUT,
  type DeviceInput,
  deriveRoomLayout,
  distance,
  EMPTY_HINT,
  extractHint,
  floorLevel,
  overlaps,
  packShelves,
  parseFloorInfo,
  parseRackPosition,
  parseUnitSpan,
  type RackInput,
  roomKey,
  rotated,
  snap,
} from ".";

describe("location hints [REQ-013]", () => {
  test.each([
    [
      "H1>DSR동_C타워>3F_A_Datacenter",
      { site: "H1", building: "DSR동_C타워", floor: "3F", room: "A_Datacenter" },
    ],
    ["H1 > Bldg > B1F_Room 2", { site: "H1", building: "Bldg", floor: "B1F", room: "Room 2" }],
    ["Bldg>3F", { building: "Bldg", floor: "3F" }],
    ["Bldg>ServerRoom", { building: "Bldg", room: "ServerRoom" }],
    ["3f-hall", { floor: "3F", room: "hall" }],
    ["A|B|C|2F_x", { site: "A", building: "C", floor: "2F", room: "x" }],
    ["", {}],
    [" > ", {}],
  ])("floor info %j", (text, expected) => {
    expect(parseFloorInfo(text)).toEqual(expected);
  });

  test("room keys are stable and mark unknown parts", () => {
    expect(roomKey(parseFloorInfo("H1>B>3F_A"))).toBe("H1>B>3F>A");
    expect(roomKey({})).toBe("?>?>?>?");
  });

  test.each([
    ["A-03", { row: 1, column: 3 }],
    ["c12", { row: 3, column: 12 }],
    ["1-5", { row: 1, column: 5 }],
    ["ROW3-RACK05", { row: 3, column: 5 }],
    ["row 2 col 7", { row: 2, column: 7 }],
    ["4x9", { row: 4, column: 9 }],
    ["R12", { column: 12 }],
    ["RACK-12", { column: 12 }],
    ["12", { column: 12 }],
    ["storage-rack", {}],
    ["", {}],
  ])("rack position %j", (text, expected) => {
    expect(parseRackPosition(text)).toEqual(expected);
  });

  test.each([
    ["U12", { start: 12, span: 1 }],
    ["12U", { start: 12, span: 1 }],
    ["U12-U14", { start: 12, span: 3 }],
    ["12~14", { start: 12, span: 3 }],
    ["14:12", { start: 12, span: 3 }],
    ["u3 - u5", { start: 3, span: 3 }],
    ["0", undefined],
    ["top", undefined],
  ])("unit span %j", (text, expected) => {
    expect(parseUnitSpan(text)).toEqual(expected);
  });

  test.each([
    ["3F", 3],
    ["B2F", -2],
    ["b1f", -1],
    [undefined, 0],
    ["F", 0],
  ])("floor level %j = %i", (floor, level) => {
    expect(floorLevel(floor)).toBe(level);
  });

  test("rack hints read the row from a property and the column from the name", () => {
    const hint = extractHint({ floor_info: "H1>B>3F_A", rack_row: 2, name: "B-07" }, "rack");
    expect([hint.row, hint.column, hint.floorInfo.floor]).toEqual([2, 7, "3F"]);
  });

  test("explicit properties win over the name; numbers may be strings or single-item lists", () => {
    expect(extractHint({ rack_row: 4, rack_no: 9, name: "A-01" }, "rack")).toMatchObject({
      row: 4,
      column: 9,
    });
    expect(extractHint({ rack_row: "3", rack_no: [5] }, "rack")).toMatchObject({
      row: 3,
      column: 5,
    });
  });

  test.each([true, [1, 2], "x", 2.5, null])(
    "unusable row value %j is ignored, not guessed",
    (bad) => {
      expect(extractHint({ rack_row: bad }, "rack").row).toBeUndefined();
    },
  );

  test("device hints read the rack reference, unit and height", () => {
    expect(
      extractHint({ Rack: "r-12", U_Position: "U20-U21", u_height: 2 }, "device"),
    ).toMatchObject({ rackRef: "r-12", unit: 20, unitSpan: 2 });
    expect(extractHint({ u: 7, u_height: 2 }, "device")).toMatchObject({ unit: 7, unitSpan: 2 });
    expect(extractHint({ u: "U9" }, "device")).toMatchObject({ unit: 9, unitSpan: 1 });
    expect(extractHint({ u: 0 }, "device").unit).toBeUndefined();
    expect(extractHint({ u: "garbage" }, "device").unit).toBeUndefined();
    expect(extractHint({}, "device")).toEqual(EMPTY_HINT);
  });

  test("property names are case-insensitive and keys can be overridden", () => {
    const keys = { ...DEFAULT_KEYS, floor: ["zone"], row: ["lane"], column: ["bay"] };
    expect(extractHint({ ZONE: "B>2F_X", Lane: 3, bay: 4 }, "rack", keys)).toMatchObject({
      row: 3,
      column: 4,
      floorInfo: { floor: "2F" },
    });
  });
});

const rack = (id: string, props: Record<string, unknown> = {}): RackInput => ({
  id,
  hint: extractHint(props, "rack"),
});
const device = (
  id: string,
  rackId: string | undefined,
  heightU = 1,
  props: Record<string, unknown> = {},
): DeviceInput => ({
  id,
  hint: extractHint(props, "device"),
  heightU,
  ...(rackId ? { rackId } : {}),
});

describe("room layout [REQ-012] [REQ-013]", () => {
  const spec = DEFAULT_LAYOUT;

  test("an empty room has only margins", () => {
    const layout = deriveRoomLayout([], []);
    expect(layout.racks.size).toBe(0);
    expect(layout.size).toEqual({ w: spec.margin * 2, d: spec.margin * 2 });
  });

  test("racks with stated slots sit on an absolute grid inside the margin", () => {
    const layout = deriveRoomLayout(
      [rack("a", { name: "A-01" }), rack("b", { name: "A-02" }), rack("c", { name: "B-03" })],
      [],
    );
    expect(layout.racks.get("a")).toEqual({
      x: spec.margin,
      y: spec.margin,
      rotation: 0,
      row: 1,
      column: 1,
      inferred: false,
    });
    expect(layout.racks.get("b")?.x).toBeCloseTo(spec.margin + spec.rackWidth, 9);
    expect(layout.racks.get("c")?.x).toBeCloseTo(spec.margin + 2 * spec.rackWidth, 9);
    expect(layout.racks.get("c")?.y).toBeCloseTo(spec.margin + spec.rackDepth + spec.coldAisle, 9);
    expect(layout.notes).toEqual([]);
  });

  test("rows alternate facing and aisle widths: cold, then hot", () => {
    const layout = deriveRoomLayout(
      ["A-1", "B-1", "C-1", "D-1"].map((name, i) => rack(`r${i}`, { name })),
      [],
    );
    const r = (i: number) => layout.racks.get(`r${i}`);
    expect([0, 1, 2, 3].map((i) => r(i)?.rotation)).toEqual([0, 180, 0, 180]);
    expect((r(1)?.y ?? 0) - (r(0)?.y ?? 0)).toBeCloseTo(spec.rackDepth + spec.coldAisle, 9);
    expect((r(2)?.y ?? 0) - (r(1)?.y ?? 0)).toBeCloseTo(spec.rackDepth + spec.hotAisle, 9);
  });

  test("missing rows close up rather than leaving gaps", () => {
    const layout = deriveRoomLayout(
      [rack("a", { rack_row: 1, rack_no: 1 }), rack("b", { rack_row: 5, rack_no: 1 })],
      [],
    );
    expect((layout.racks.get("b")?.y ?? 0) - (layout.racks.get("a")?.y ?? 0)).toBeCloseTo(
      spec.rackDepth + spec.coldAisle,
      9,
    );
  });

  test("racks without data are placed and marked as guesses", () => {
    const layout = deriveRoomLayout([rack("r1"), rack("r2"), rack("r3")], []);
    expect([...layout.racks.values()].every((p) => p.inferred)).toBe(true);
    expect(new Set([...layout.racks.values()].map((p) => `${p.x},${p.y}`)).size).toBe(3);
    expect(layout.notes).toHaveLength(3);
  });

  test("a conflicting slot keeps the first rack (by id) and moves the other in the same row", () => {
    const layout = deriveRoomLayout([rack("b", { name: "A-01" }), rack("a", { name: "A-01" })], []);
    expect(layout.racks.get("a")?.inferred).toBe(false);
    expect(layout.racks.get("b")).toMatchObject({ row: 1, column: 2, inferred: true });
    expect(layout.notes[0]).toContain("already used by a");
  });

  test("partial information is respected when guessing", () => {
    const layout = deriveRoomLayout(
      [
        rack("a", { rack_row: 1, rack_no: 1 }),
        rack("b", { rack_row: 1 }),
        rack("c", { rack_no: 1 }),
      ],
      [],
    );
    expect(layout.racks.get("b")).toMatchObject({ row: 1, column: 2 });
    expect(layout.racks.get("c")).toMatchObject({ row: 2, column: 1 });
  });

  test("a full row grows instead of overlapping", () => {
    const layout = deriveRoomLayout(
      Array.from({ length: 5 }, (_, i) => rack(`r${i}`, { rack_row: 1 })),
      [],
      { ...spec, racksPerRow: 2 },
    );
    expect(new Set([...layout.racks.values()].map((p) => p.column))).toEqual(
      new Set([1, 2, 3, 4, 5]),
    );
  });

  test("devices stack at their requested units; unstated ones fill from the bottom without overlap", () => {
    const layout = deriveRoomLayout(
      [rack("r", { name: "A-1" })],
      [
        device("s1", "r", 2, { u: "U10-U11" }),
        device("s2", "r", 1, { u: 1 }),
        device("s3", "r"),
        device("s4", "r"),
      ],
    );
    expect(layout.devices.get("s1")).toEqual({ rackId: "r", u: 10, inferred: false });
    expect(layout.devices.get("s2")).toEqual({ rackId: "r", u: 1, inferred: false });
    expect(layout.devices.get("s3")).toEqual({ rackId: "r", u: 2, inferred: true });
    expect(layout.devices.get("s4")).toEqual({ rackId: "r", u: 3, inferred: true });
  });

  test("devices may name their rack by text reference", () => {
    expect(
      deriveRoomLayout(
        [rack("r", { name: "A-1" })],
        [device("s", undefined, 1, { rack: "r", u: 3 })],
      ).devices.get("s"),
    ).toMatchObject({ rackId: "r", u: 3 });
  });

  test("overlapping requests are moved and noted; units beyond the rack are treated as unknown", () => {
    const layout = deriveRoomLayout(
      [rack("r", { name: "A-1" })],
      [
        device("a", "r", 2, { u: 5 }),
        device("b", "r", 2, { u: 6 }),
        device("c", "r", 1, { u: 99 }),
      ],
    );
    expect(layout.devices.get("b")).toMatchObject({ u: 7, inferred: true });
    expect(layout.devices.get("c")?.inferred).toBe(true);
    expect(layout.notes.some((n) => n.includes("already used"))).toBe(true);
  });

  test("a full rack stacks extras at the top and says so", () => {
    const layout = deriveRoomLayout(
      [rack("r", { name: "A-1" })],
      Array.from({ length: 4 }, (_, i) => device(`s${i}`, "r")),
      { ...spec, rackUnits: 3 },
    );
    expect(layout.devices.get("s3")).toMatchObject({ u: 3, inferred: true });
    expect(layout.notes.some((n) => n.includes("full"))).toBe(true);
  });

  test("free-standing equipment stands along the front wall and pushes racks back", () => {
    const layout = deriveRoomLayout(
      [rack("r", { name: "A-1" })],
      [device("crac1", undefined), device("crac2", "ghost")],
    );
    expect(layout.equipment.get("crac1")).toEqual({
      x: spec.margin,
      y: spec.margin,
      inferred: true,
    });
    expect(layout.equipment.get("crac2")?.x).toBeCloseTo(spec.margin + spec.equipmentPitch, 9);
    expect(layout.racks.get("r")?.y).toBeCloseTo(spec.margin + spec.equipmentZone, 9);
  });

  test("room size covers every rack and the equipment strip", () => {
    const layout = deriveRoomLayout(
      [rack("a", { name: "A-1" }), rack("b", { name: "C-4" })],
      Array.from({ length: 8 }, (_, i) => device(`e${i}`, undefined)),
    );
    for (const p of layout.racks.values()) {
      expect(p.x + spec.rackWidth).toBeLessThanOrEqual(layout.size.w);
      expect(p.y + spec.rackDepth).toBeLessThanOrEqual(layout.size.d);
    }
    expect(layout.size.w).toBeCloseTo(spec.margin * 2 + 8 * spec.equipmentPitch, 9);
  });
});

const names = fc.constantFrom("A-01", "A-02", "A-03", "B-01", "B-02", "C-05", "R7", "9", "odd", "");

const inventories = fc
  .record({
    racks: fc.array(names, { maxLength: 8 }),
    devices: fc.array(
      fc.record({
        unit: fc.option(fc.integer({ min: 1, max: 50 }), { nil: undefined }),
        height: fc.integer({ min: 1, max: 3 }),
        rack: fc.nat(10),
      }),
      { maxLength: 12 },
    ),
  })
  .map(({ racks, devices }) => {
    const rackInputs = racks.map((name, i) => rack(`rack${i}`, name ? { name } : {}));
    const deviceInputs = devices.map((d, i) => {
      const rackId =
        rackInputs.length > 0 && d.rack < rackInputs.length ? rackInputs[d.rack]?.id : undefined;
      return device(`dev${i}`, rackId, d.height, d.unit !== undefined ? { u: d.unit } : {});
    });
    return { rackInputs, deviceInputs };
  });

describe("room layout properties [REQ-001] [REQ-013]", () => {
  test("the result does not depend on input order", () => {
    fc.assert(
      fc.property(inventories, fc.integer(), ({ rackInputs, deviceInputs }, seed) => {
        const shuffle = <T>(items: T[]) =>
          [...items]
            .sort((a, b) => ((String(a).length * seed) % 7) - ((String(b).length * seed) % 7) || 0)
            .reverse();
        const a = deriveRoomLayout(rackInputs, deviceInputs);
        const b = deriveRoomLayout(shuffle(rackInputs), shuffle(deviceInputs));
        expect([...b.racks].sort()).toEqual([...a.racks].sort());
        expect([...b.devices].sort()).toEqual([...a.devices].sort());
        expect(b.notes).toEqual(a.notes);
      }),
      { numRuns: 80 },
    );
  });

  test("racks never share a spot and every rack is inside the room", () => {
    fc.assert(
      fc.property(inventories, ({ rackInputs, deviceInputs }) => {
        const layout = deriveRoomLayout(rackInputs, deviceInputs);
        const spots = [...layout.racks.values()].map((p) => `${p.x},${p.y}`);
        expect(new Set(spots).size).toBe(spots.length);
        for (const p of layout.racks.values()) {
          expect(
            contains(
              { x: 0, y: 0, w: layout.size.w, d: layout.size.d },
              { x: p.x, y: p.y, w: DEFAULT_LAYOUT.rackWidth, d: DEFAULT_LAYOUT.rackDepth },
            ),
          ).toBe(true);
        }
      }),
      { numRuns: 80 },
    );
  });

  test("devices in one rack never overlap (12 devices of up to 3U always fit in 42U)", () => {
    fc.assert(
      fc.property(inventories, ({ rackInputs, deviceInputs }) => {
        const layout = deriveRoomLayout(rackInputs, deviceInputs);
        const used = new Map<string, Set<number>>();
        for (const input of deviceInputs) {
          const placed = layout.devices.get(input.id);
          if (!placed) continue;
          const set = used.get(placed.rackId) ?? new Set<number>();
          for (let u = placed.u; u < placed.u + input.heightU; u++) {
            expect(set.has(u)).toBe(false);
            set.add(u);
          }
          used.set(placed.rackId, set);
        }
        expect(layout.notes.some((n) => n.includes("full"))).toBe(false);
      }),
      { numRuns: 80 },
    );
  });
});

describe("geometry and packing [REQ-012]", () => {
  test("distance, center, rotation, snapping and floor-routed cable length", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(center({ x: 1, y: 2, w: 4, d: 2 })).toEqual({ x: 3, y: 3 });
    expect(rotated(0.6, 1.2, 90)).toEqual({ w: 1.2, d: 0.6 });
    expect(rotated(0.6, 1.2, 180)).toEqual({ w: 0.6, d: 1.2 });
    expect(snap(1.26, 0.6)).toBeCloseTo(1.2, 9);
    expect(snap(1.26, 0)).toBe(1.26);
    expect(cableLength({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(9);
  });

  test("overlap is strict: touching edges do not overlap", () => {
    const a = { x: 0, y: 0, w: 1, d: 1 };
    expect(overlaps(a, { x: 0.5, y: 0.5, w: 1, d: 1 })).toBe(true);
    expect(overlaps(a, { x: 1, y: 0, w: 1, d: 1 })).toBe(false);
    expect(contains({ x: 0, y: 0, w: 10, d: 10 }, { x: 9, y: 9, w: 1, d: 1 })).toBe(true);
    expect(contains({ x: 0, y: 0, w: 10, d: 10 }, { x: 9.5, y: 9, w: 1, d: 1 })).toBe(false);
  });

  test("bounds cover all rectangles", () => {
    expect(bounds([])).toBeUndefined();
    expect(
      bounds([
        { x: 1, y: 1, w: 1, d: 1 },
        { x: -1, y: 3, w: 1, d: 2 },
      ]),
    ).toEqual({ x: -1, y: 1, w: 3, d: 4 });
  });

  test("shelf packing places items in id order, wraps rows and never overlaps", () => {
    const packed = packShelves(
      [
        { id: "c", w: 4, d: 2 },
        { id: "a", w: 4, d: 3 },
        { id: "b", w: 4, d: 1 },
      ],
      11,
      1,
    );
    expect(packed.map((p) => [p.id, p.x, p.y])).toEqual([
      ["a", 1, 1],
      ["b", 6, 1],
      ["c", 1, 5],
    ]);
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ w: fc.integer({ min: 1, max: 9 }), d: fc.integer({ min: 1, max: 9 }) }),
          { maxLength: 15 },
        ),
        (sizes) => {
          const out = packShelves(
            sizes.map((s, i) => ({ id: `i${String(i).padStart(2, "0")}`, ...s })),
            20,
            0.5,
          );
          for (let i = 0; i < out.length; i++)
            for (let j = i + 1; j < out.length; j++)
              expect(overlaps(out[i] as never, out[j] as never)).toBe(false);
        },
      ),
    );
  });
});
