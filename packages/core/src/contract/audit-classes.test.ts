import { AUDIT_ACTIONS, isResourceKind } from "@terrarium/core/experiments";
import { describe, expect, test } from "vitest";
import { AUDIT_LABELS, AUDIT_REASON_LABELS } from "./audit";
import { AUDIT_CLASSES, failsClosed } from "./audit-classes";
import { ROUTES, type RouteName, type RouteSpec } from "./routes";

const names = Object.keys(ROUTES) as RouteName[];
const classes = AUDIT_CLASSES as Record<string, (typeof AUDIT_CLASSES)[RouteName]>;

describe("every route says what the audit log records of it [REQ-054]", () => {
  test("[REQ-054] a route without a classification fails here, and a classification without a route does too", () => {
    expect(names.filter((n) => classes[n] === undefined)).toEqual([]);
    expect(Object.keys(classes).filter((n) => !(n in ROUTES))).toEqual([]);
  });

  test("[REQ-054] a route that records nothing says why", () => {
    for (const n of names) {
      const c = classes[n];
      if (c?.records === "none") expect(c.reason.length, n).toBeGreaterThan(5);
    }
  });

  test("[REQ-054] a route that changes something records it: only a read may record nothing or only an override", () => {
    const changing = names.filter((n) => ROUTES[n].method !== "GET");
    const lax = changing.filter((n) => classes[n]?.records !== "change");
    // the exceptions are named, each with its reason, so a new one is a decision and not an oversight
    expect(lax.sort().map((n) => `${n}:${classes[n]?.records}`)).toEqual([
      "askMoss:none",
      "checkConnection:none",
      "dryRunScenario:none",
    ]);
    for (const n of lax)
      expect(classes[n]?.records === "none" && classes[n].reason.length, n).toBeGreaterThan(5);
  });

  test("[REQ-054] a route only an admin may call is recorded, so is every route that names an action", () => {
    for (const n of names)
      if ((ROUTES[n] as RouteSpec).policy === "admin")
        expect(classes[n]?.records, n).toBe("change");
  });

  test("[REQ-054] actions and resource kinds are words of the closed list and the registry, and every action has a label", () => {
    for (const n of names) {
      const c = classes[n];
      if (!c) continue;
      if ("action" in c && c.action) expect(AUDIT_ACTIONS, n).toContain(c.action);
      if ("resource" in c && c.resource)
        expect(isResourceKind(c.resource), `${n}: ${c.resource}`).toBe(true);
    }
    for (const a of AUDIT_ACTIONS) expect(AUDIT_LABELS[a], a).toEqual(expect.any(String));
    expect(Object.keys(AUDIT_LABELS).sort()).toEqual([...AUDIT_ACTIONS].sort());
    expect(Object.values(AUDIT_REASON_LABELS).every((t) => t.length > 3)).toBe(true);
  });

  test("[REQ-054] labels use the product's own words", () => {
    const text = [...Object.values(AUDIT_LABELS), ...Object.values(AUDIT_REASON_LABELS)].join("\n");
    for (const banned of ["횟수", "시드", "개체"]) expect(text).not.toContain(banned);
  });

  test("[REQ-054] only a recorded change that is not a plain read stops when the log cannot be written", () => {
    expect(failsClosed("createWorld", "POST")).toBe(true);
    expect(failsClosed("listAudit", "GET")).toBe(false);
    expect(failsClosed("sharedReport", "GET")).toBe(false);
    for (const n of names)
      if (ROUTES[n].method === "GET") expect(failsClosed(n, "GET"), n).toBe(false);
  });
});
