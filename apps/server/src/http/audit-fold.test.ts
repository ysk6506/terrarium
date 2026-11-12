/**
 * Failures before sign-in cannot fill the log (ADR-0193): one line for each address and reason in a minute, carrying the
 * count; no more than a set number of such lines in a minute; the rest only counted. Memory and SQLite give the same answers.
 * The clock is the test's own.
 */
import { type AuditStore, MemoryAuditStore, type NewAuditEntry } from "@terrarium/core/experiments";
import { describe, expect, test } from "vitest";
import { SqliteStore } from "../adapters";
import { Auditor, auditMetricsText } from "../runtime";
import { allEntries } from "./test-support/audit-support";
import { auditedApp } from "./test-support/audited-app";

const T0 = Date.UTC(2026, 9, 29, 12, 0, 0);

const fail = (
  address: string,
  reason: NewAuditEntry["reason"] = "proxy_secret_wrong",
): NewAuditEntry => ({
  requestId: "r",
  subject: { kind: "person", id: "anonymous", name: "anonymous", admin: false },
  action: "auth.sign_in",
  outcome: "denied",
  ...(reason ? { reason } : {}),
  resource: { kind: "session" },
  remoteAddress: address,
});

/** A recorder on a clock the test moves. */
function recorder(store: AuditStore, limit = 60) {
  const clock = { now: T0 };
  const audit = new Auditor(store, () => new Date(clock.now).toISOString(), undefined, limit);
  return {
    audit,
    at: (secondsAfterStart: number) => {
      clock.now = T0 + secondsAfterStart * 1000;
    },
  };
}

const stores: [string, () => { store: AuditStore; close: () => void }][] = [
  ["memory", () => ({ store: new MemoryAuditStore(), close: () => undefined })],
  [
    "sqlite",
    () => {
      const sql = new SqliteStore(":memory:");
      return { store: sql.audit, close: () => sql.close() };
    },
  ],
];

describe.each(stores)("failures before sign-in, folded [REQ-054] (%s)", (_name, make) => {
  test("[REQ-054] one line for an address and a reason in a minute, with how many there were, written when the minute has ended", async () => {
    const { store, close } = make();
    const { audit, at } = recorder(store);
    for (let i = 0; i < 25; i++) {
      at(i);
      await audit.tryRecord(fail("10.0.0.7"));
    }
    expect((await store.query({ limit: 10 })).entries).toHaveLength(0);
    at(61);
    await audit.flushDue();
    const lines = (await store.query({ limit: 10 })).entries;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      action: "auth.sign_in",
      reason: "proxy_secret_wrong",
      remoteAddress: "10.0.0.7",
      detail: { count: 25, windowStart: "2026-10-29T12:00:00.000Z" },
    });
    expect(audit.counts().suppressed.get("proxy_secret_wrong")).toBe(24);
    close();
  });

  test("[REQ-054] another address or another reason is another line; each of the four reasons is folded", async () => {
    const { store, close } = make();
    const { audit, at } = recorder(store);
    for (const reason of [
      "unauthenticated",
      "proxy_secret_missing",
      "proxy_secret_wrong",
      "proxy_login_missing",
    ] as const)
      for (const address of ["a", "b"]) await audit.tryRecord(fail(address, reason));
    at(120);
    await audit.flushDue();
    expect((await store.query({ limit: 20 })).entries).toHaveLength(8);
    close();
  });

  test("[REQ-054] when the minute has passed, the next failure is written again", async () => {
    const { store, close } = make();
    const { audit, at } = recorder(store);
    await audit.tryRecord(fail("x"));
    at(59);
    await audit.tryRecord(fail("x"));
    at(61);
    await audit.tryRecord(fail("x"));
    at(125);
    await audit.tryRecord(fail("x"));
    await audit.flushDue(true);
    const counts = (await store.query({ limit: 10 })).entries.map((e) => e.detail?.count);
    expect(counts.reverse()).toEqual([2, 1, 1]);
    close();
  });

  test("[REQ-054] all together no more than the limit in a minute; over it, only counted, and one line says the limit was reached", async () => {
    const { store, close } = make();
    const { audit, at } = recorder(store, 5);
    for (let i = 0; i < 40; i++) await audit.tryRecord(fail(`10.0.0.${i}`));
    at(61);
    await audit.flushDue();
    const lines = (await store.query({ limit: 100 })).entries;
    expect(lines.filter((e) => e.action === "auth.sign_in")).toHaveLength(5);
    const limit = lines.filter((e) => e.action === "audit.limit");
    expect(limit).toHaveLength(1);
    expect(limit[0]).toMatchObject({
      subject: { kind: "system" },
      detail: { dropped: 35, lines: 5 },
    });
    expect(audit.counts().suppressed.get("proxy_secret_wrong")).toBe(35);
    // the next minute starts afresh
    await audit.tryRecord(fail("fresh"));
    at(130);
    await audit.flushDue();
    expect((await store.query({ limit: 100 })).entries).toHaveLength(7);
    close();
  });

  test("[REQ-054] a failure after sign-in, or a sign-in that went through, is not folded", async () => {
    const { store, close } = make();
    const { audit } = recorder(store);
    await audit.tryRecord({
      ...fail("a", "not_admin"),
      action: "access.denied",
      resource: { kind: "audit" },
    });
    await audit.tryRecord({
      ...fail("a", "not_admin"),
      action: "access.denied",
      resource: { kind: "audit" },
    });
    expect((await store.query({ limit: 10 })).entries).toHaveLength(2);
    close();
  });
});

describe("the same answers, the counters and the setting [REQ-054]", () => {
  test("[REQ-054] memory and SQLite end with the same lines for the same failures", async () => {
    const runs = [];
    for (const [, make] of stores) {
      const { store, close } = make();
      const { audit, at } = recorder(store, 3);
      for (let i = 0; i < 20; i++) {
        at(i * 7);
        await audit.tryRecord(
          fail(`10.0.0.${i % 6}`, i % 2 ? "unauthenticated" : "proxy_secret_wrong"),
        );
      }
      await audit.flushDue(true);
      const shape = (await store.query({ limit: 100 })).entries.map(
        ({ requestId: _r, detail, ...e }) => ({
          ...e,
          detail: detail && { ...detail },
        }),
      );
      runs.push(shape);
      close();
    }
    expect(runs[0]).toEqual(runs[1]);
  });

  test("[REQ-054] the metrics say how many were only counted, by reason, with nothing a person typed", async () => {
    const { audit } = recorder(new MemoryAuditStore());
    for (let i = 0; i < 4; i++) await audit.tryRecord(fail("a", "proxy_login_missing"));
    const text = auditMetricsText(audit.counts());
    expect(text).toContain('terrarium_audit_suppressed_total{reason="proxy_login_missing"} 3');
    expect(text).not.toContain("10.0.0");
  });

  test("[REQ-054] over HTTP: a flood of wrong secrets writes a handful of lines, and stopping the server writes the rest", async () => {
    const s = auditedApp();
    for (let i = 0; i < 30; i++)
      await s.app.inject({
        method: "GET",
        url: "/api/meta",
        headers: { "x-terrarium-proxy-secret": "wrong", "x-forwarded-user": `u${i}` },
      });
    await s.platform.stop();
    const lines = (await allEntries(s.audit)).filter((e) => e.action === "auth.sign_in");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.detail?.count).toBe(30);
  });
});
