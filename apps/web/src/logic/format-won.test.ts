import { describe, expect, test } from "vitest";
import { won } from "./format";

describe("big prices read the way people say them [REQ-043]", () => {
  test("hundreds of millions stay short, thousands get separators, trillions say 조", () => {
    expect(won(320)).toBe("3.2억 원");
    expect(won(1500)).toBe("15억 원");
    expect(won(125_345)).toBe("1,253억 원");
    expect(won(1_298_400)).toBe("1조 2,984억 원");
    expect(won(1_000_000)).toBe("1조 원");
  });
});
