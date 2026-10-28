import { describe, expect, test } from "vitest";
import { BUILTIN_PROFILES, DEFAULT_PROFILE, memberId, ProfileRegistry } from ".";

describe("product-version profiles [REQ-004]", () => {
  const registry = new ProfileRegistry();

  test("every protocol has a default profile and keys are unique", () => {
    for (const protocol of ["redfish", "vcenter", "vrops"] as const) {
      expect(registry.get(protocol, DEFAULT_PROFILE[protocol]).protocol).toBe(protocol);
    }
    expect(new Set(BUILTIN_PROFILES.map((p) => p.key)).size).toBe(BUILTIN_PROFILES.length);
  });

  test("profiles are found by protocol and key; wrong protocol or key is an error", () => {
    expect(registry.get("redfish").key).toBe("bmc-gen16/7.10");
    expect(registry.get("vcenter", "vcenter/7.0").legacyRest).toBe(true);
    expect(() => registry.get("vrops", "vcenter/7.0")).toThrow(/no vrops profile/);
    expect(() => registry.get("redfish", "nope")).toThrow(/no redfish profile/);
    expect(registry.list("redfish").map((p) => p.key)).toEqual([
      "bmc-gen14/4.40",
      "bmc-gen16/7.10",
      "bmc-lite/2.80",
    ]);
    expect(registry.list()).toHaveLength(BUILTIN_PROFILES.length);
  });

  test("member ids follow the profile's id style", () => {
    expect(memberId(registry.get("redfish", "bmc-gen14/4.40"), "System", "srv-a1")).toBe(
      "System.Embedded.1",
    );
    expect(memberId(registry.get("redfish", "bmc-gen14/4.40"), "Manager", "srv-a1")).toBe(
      "iDRAC.Embedded.1",
    );
    expect(memberId(registry.get("redfish", "bmc-lite/2.80"), "Chassis", "srv-a1", 2)).toBe("2");
    const entityStyle = new ProfileRegistry([
      { ...registry.get("redfish"), key: "custom/1", idStyle: "entity" },
    ]);
    expect(memberId(entityStyle.get("redfish", "custom/1"), "System", "srv-a1")).toBe("srv-a1");
  });
});
