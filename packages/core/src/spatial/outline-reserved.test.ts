import { describe, expect, test } from "vitest";
import { encodeReserved, parseReserved, type ReservedPlot } from "./outline";

describe("ground the map shows a building on but the world does not build [REQ-056] [REQ-048]", () => {
  const plots: ReservedPlot[] = [
    { kind: "fab", x: 1063, y: 1347, w: 314, d: 146 },
    { kind: "lab", x: 607, y: 270, w: 66, d: 60 },
    { kind: "dc", x: 872, y: 1640, w: 115, d: 60 },
  ];

  test("plots keep their kind, corner and size through the text kept in a site's props", () => {
    expect(parseReserved(encodeReserved(plots))).toEqual(plots);
    expect(encodeReserved([])).toBe("");
    expect(parseReserved("")).toEqual([]);
  });

  test("anything that is not a plot is left out, the rest is kept", () => {
    expect(parseReserved(undefined)).toEqual([]);
    expect(parseReserved(7)).toEqual([]);
    expect(parseReserved("fab:1,2,3,4;barn:1,2,3,4;fab:x,2,3,4;fab:1,2,0,4;lab:5,6,7,8")).toEqual([
      { kind: "fab", x: 1, y: 2, w: 3, d: 4 },
      { kind: "lab", x: 5, y: 6, w: 7, d: 8 },
    ]);
  });
});
