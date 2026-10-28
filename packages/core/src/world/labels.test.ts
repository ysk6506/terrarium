import { describe, expect, test } from "vitest";
import { ENTITY_KINDS, KIND_LABELS, kindList, LINK_LABELS, LINK_RULES } from ".";

describe("kind labels [REQ-034]", () => {
  test("every entity and link kind has a Korean label", () => {
    for (const kind of ENTITY_KINDS) expect(KIND_LABELS[kind]).toMatch(/\S/);
    for (const kind of Object.keys(LINK_RULES))
      expect(LINK_LABELS[kind as keyof typeof LINK_LABELS]).toMatch(/\S/);
  });

  test("kind lists read naturally, including link targets", () => {
    expect(kindList(["cooling_unit", "power_panel"])).toBe("냉방기·분전반");
    expect(kindList(["link"])).toBe("네트워크 링크");
  });
});
