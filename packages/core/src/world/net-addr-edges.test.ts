import { describe, expect, test } from "vitest";
import {
  cidrText,
  inSubnet,
  intToIp,
  ipToInt,
  lenToMask,
  lenToWildcard,
  macOf,
  maskToLen,
  networkOf,
  parseCidr,
  parseHostCidr,
} from "./net-addr";

describe("addresses that are not addresses are turned away, and good ones round trip [REQ-062]", () => {
  test("four parts of 0 to 255 and nothing else", () => {
    expect(ipToInt("10.1.2.3")).toBe(167838211);
    expect(intToIp(167838211)).toBe("10.1.2.3");
    for (const bad of [
      "10.1.2",
      "10.1.2.3.4",
      "10.1.2.x",
      "10.1.2.256",
      "10.1.2.",
      "",
      "1000.1.2.3",
      "-1.0.0.0",
    ])
      expect(ipToInt(bad), bad).toBeUndefined();
  });

  test("the network of an address, for any prefix length including none", () => {
    const ip = ipToInt("10.1.2.77") as number;
    expect(intToIp(networkOf(ip, 24))).toBe("10.1.2.0");
    expect(intToIp(networkOf(ip, 16))).toBe("10.1.0.0");
    expect(networkOf(ip, 0)).toBe(0);
    expect(networkOf(ip, -3)).toBe(0);
    expect(inSubnet(ip, ipToInt("10.1.2.0") as number, 24)).toBe(true);
    expect(inSubnet(ip, ipToInt("10.1.3.0") as number, 24)).toBe(false);
  });

  test("a mask is a run of ones then zeros; anything else is not a mask", () => {
    expect(maskToLen("255.255.255.0")).toBe(24);
    expect(maskToLen("0.0.0.0")).toBe(0);
    expect(maskToLen("255.255.255.255")).toBe(32);
    expect(maskToLen("255.0.255.0")).toBeUndefined();
    expect(maskToLen("not a mask")).toBeUndefined();
    expect(lenToMask(0)).toBe("0.0.0.0");
    expect(lenToMask(20)).toBe("255.255.240.0");
    expect(lenToWildcard(24)).toBe("0.0.0.255");
  });

  test("a network in slash form, or a lone address as a /32", () => {
    expect(cidrText(parseCidr("10.1.2.99/24") as never)).toBe("10.1.2.0/24");
    expect(cidrText(parseCidr("10.1.2.99") as never)).toBe("10.1.2.99/32");
    for (const bad of ["10.1.2.0/33", "10.1.2.0/x", "10.1.2.0/", "nope/24", "10.1.2.0/123", ""])
      expect(parseCidr(bad), bad).toBeUndefined();
  });

  test("a host address with its prefix keeps the host part and needs the prefix", () => {
    expect(parseHostCidr("10.1.2.3/24")).toEqual({ ip: ipToInt("10.1.2.3"), len: 24 });
    for (const bad of ["10.1.2.3", "10.1.2.3/40", "10.1.2.3/ab", "bad/24"])
      expect(parseHostCidr(bad), bad).toBeUndefined();
  });

  test("a MAC from an id is the same every time and has the three-group form", () => {
    expect(macOf("sw-1")).toBe(macOf("sw-1"));
    expect(macOf("sw-1")).toMatch(/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/);
    expect(macOf("sw-1", 1)).not.toBe(macOf("sw-1", 0));
  });
});
