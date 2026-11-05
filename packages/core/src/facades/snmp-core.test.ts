import { describe, expect, test } from "vitest";
import {
  compareOid,
  type Mib,
  parseOid,
  snmpGet,
  snmpGetBulk,
  snmpGetNext,
  snmpSet,
  snmpWalk,
} from "./snmp-core";

const oid = (text: string) => parseOid(text) as number[];

/** A small MIB: a scalar, a two-column table of two rows, and one writable string. */
function tiny(store = { name: "a" }): Mib {
  const v = (
    text: string,
    type: "INTEGER" | "OCTET STRING",
    value: number | string,
    set?: boolean,
  ) => ({
    oid: oid(text),
    name: `T::${text}`,
    type,
    value,
    ...(set
      ? {
          set: {
            check: (x: string | number) =>
              String(x).length > 3 ? ("wrongLength" as const) : ("noError" as const),
            apply: (x: string | number) => {
              store.name = String(x);
            },
          },
        }
      : {}),
  });
  return {
    objects: [
      { name: "T::count", oid: oid("1.3.6.1.4.1.9.1"), type: "INTEGER", access: "read-only" },
      { name: "T::name", oid: oid("1.3.6.1.4.1.9.2"), type: "OCTET STRING", access: "read-write" },
      { name: "T::colA", oid: oid("1.3.6.1.4.1.9.3.1.1"), type: "INTEGER", access: "read-only" },
      { name: "T::colB", oid: oid("1.3.6.1.4.1.9.3.1.2"), type: "INTEGER", access: "read-only" },
      { name: "T::absent", oid: oid("1.3.6.1.4.1.9.4"), type: "INTEGER", access: "read-only" },
    ],
    vars: [
      v("1.3.6.1.4.1.9.1.0", "INTEGER", 7),
      v("1.3.6.1.4.1.9.2.0", "OCTET STRING", store.name, true),
      v("1.3.6.1.4.1.9.3.1.1.1", "INTEGER", 10),
      v("1.3.6.1.4.1.9.3.1.1.2", "INTEGER", 20),
      v("1.3.6.1.4.1.9.3.1.2.1", "INTEGER", 11),
      v("1.3.6.1.4.1.9.3.1.2.2", "INTEGER", 21),
    ],
  };
}

describe("SNMP agent engine [REQ-002]", () => {
  test("OIDs sort numerically, not as text", () => {
    expect(compareOid(oid("1.3.6.1.9"), oid("1.3.6.1.10"))).toBeLessThan(0);
    expect(compareOid(oid("1.3.6"), oid("1.3.6.1"))).toBeLessThan(0);
    expect(parseOid(".1.3.6.1")).toEqual([1, 3, 6, 1]);
    expect(parseOid("sysDescr.0")).toBeUndefined();
  });

  test("get answers a value, noSuchInstance for a known object, noSuchObject for an unknown one", () => {
    const r = snmpGet(tiny(), [
      oid("1.3.6.1.4.1.9.1.0"),
      oid("1.3.6.1.4.1.9.1.5"),
      oid("1.3.6.1.4.1.9.4.0"),
      oid("1.3.6.1.4.1.77.1.0"),
    ]);
    expect(r.errorStatus).toBe("noError");
    expect(r.varbinds.map((b) => b.value ?? b.exception)).toEqual([
      7,
      "noSuchInstance",
      "noSuchInstance",
      "noSuchObject",
    ]);
  });

  test("getnext moves to the next instance, across rows and columns, and ends with endOfMibView", () => {
    const mib = tiny();
    const next = (text: string) => snmpGetNext(mib, [oid(text)]).varbinds[0];
    expect(next("1.3.6.1.4.1.9.3.1.1.2")?.oid).toBe("1.3.6.1.4.1.9.3.1.2.1");
    expect(next("1.3.6.1.4.1.9.3")?.oid).toBe("1.3.6.1.4.1.9.3.1.1.1");
    expect(next("1.3.6.1.4.1.9.3.1.2.2")?.exception).toBe("endOfMibView");
  });

  test("getbulk reads the non-repeaters once and the repeaters row by row", () => {
    const r = snmpGetBulk(tiny(), [oid("1.3.6.1.4.1.9.1"), oid("1.3.6.1.4.1.9.3.1.1")], 1, 3);
    expect(r.varbinds.map((b) => b.oid)).toEqual([
      "1.3.6.1.4.1.9.1.0",
      "1.3.6.1.4.1.9.3.1.1.1",
      "1.3.6.1.4.1.9.3.1.1.2",
      "1.3.6.1.4.1.9.3.1.2.1",
    ]);
  });

  test("getbulk stops once everything has reached the end of the MIB", () => {
    const r = snmpGetBulk(tiny(), [oid("1.3.6.1.4.1.9.3.1.2.1")], 0, 50);
    expect(r.varbinds.map((b) => b.exception ?? b.oid)).toEqual([
      "1.3.6.1.4.1.9.3.1.2.2",
      "endOfMibView",
    ]);
  });

  test("walk lists a subtree in order and nothing outside it", () => {
    const r = snmpWalk(tiny(), oid("1.3.6.1.4.1.9.3"));
    expect(r.varbinds.map((b) => b.value)).toEqual([10, 20, 11, 21]);
  });

  test("set changes nothing unless every binding is acceptable, and names the one that is not", () => {
    const store = { name: "a" };
    const mib = tiny(store);
    const bad = snmpSet(mib, [
      { oid: oid("1.3.6.1.4.1.9.2.0"), type: "OCTET STRING", value: "ok" },
      { oid: oid("1.3.6.1.4.1.9.1.0"), type: "INTEGER", value: 1 },
    ]);
    expect(bad).toMatchObject({ errorStatus: "notWritable", errorIndex: 2 });
    expect(store.name).toBe("a");
    expect(
      snmpSet(mib, [{ oid: oid("1.3.6.1.4.1.9.2.0"), type: "INTEGER", value: 1 }]).errorStatus,
    ).toBe("wrongType");
    expect(
      snmpSet(mib, [{ oid: oid("1.3.6.1.4.1.9.2.0"), type: "OCTET STRING", value: "toolong" }])
        .errorStatus,
    ).toBe("wrongLength");
    expect(
      snmpSet(mib, [{ oid: oid("1.3.6.1.4.1.9.4.0"), type: "INTEGER", value: 1 }]).errorStatus,
    ).toBe("noCreation");
    expect(
      snmpSet(mib, [{ oid: oid("1.3.6.1.4.1.77.1.0"), type: "INTEGER", value: 1 }]).errorStatus,
    ).toBe("notWritable");
    const good = snmpSet(mib, [
      { oid: oid("1.3.6.1.4.1.9.2.0"), type: "OCTET STRING", value: "bob" },
    ]);
    expect(good.errorStatus).toBe("noError");
    expect(store.name).toBe("bob");
  });

  test("a request with too many bindings is tooBig", () => {
    const many = Array.from({ length: 65 }, () => oid("1.3.6.1.4.1.9.1.0"));
    expect(snmpGet(tiny(), many).errorStatus).toBe("tooBig");
  });
});
