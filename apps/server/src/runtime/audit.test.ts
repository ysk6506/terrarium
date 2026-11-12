/**
 * The recorder (ADR-0193): what it lets into an entry, the time it puts on it, what it counts and logs, and the one removal.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { AUDIT_ACTIONS, MemoryAuditStore, type NewAuditEntry } from "@terrarium/core/experiments";
import { describe, expect, test } from "vitest";
import { Auditor, AuditWriteError, cleaned, DONE_UNRECORDED, NOT_DONE } from "./audit";
import { auditMetricsText } from "./audit-metrics";

const valid = (over: Partial<NewAuditEntry> = {}): NewAuditEntry => ({
  requestId: "req-1",
  subject: { kind: "person", id: "haneul", name: "김하늘", source: "proxy", admin: false },
  action: "world.create",
  outcome: "allowed",
  resource: { kind: "world", id: "w1", name: "홀", owner: "haneul", scope: "private" },
  ...over,
});

const clock = () => {
  let n = 0;
  return () => new Date(Date.UTC(2026, 9, 29, 0, 0, n++)).toISOString();
};

describe("what an entry may hold [REQ-054]", () => {
  test("[REQ-054] an action, an outcome or a reason outside the closed lists is a mistake in the code and is not stored", async () => {
    const audit = new Auditor(new MemoryAuditStore(), clock());
    await expect(audit.record(valid({ action: "world.explode" as never }))).rejects.toThrow();
    await expect(audit.record(valid({ outcome: "maybe" as never }))).rejects.toThrow();
    await expect(
      audit.record(valid({ outcome: "denied", reason: "because" as never })),
    ).rejects.toThrow();
    await expect(audit.record(valid({ outcome: "denied" }))).rejects.toThrow();
    await expect(audit.record(valid({ reason: "not_admin" }))).rejects.toThrow();
    await expect(audit.record(valid({ resource: { kind: "unheard_of" } }))).rejects.toThrow();
  });

  test("[REQ-054] only the names of what was sent are kept, and a value only for the scope, group, role, owner and sharing fields", () => {
    const e = cleaned(
      valid({
        fields: ["name", "scope", "bad name", "x".repeat(60), "apiKey"],
        changes: [
          { field: "scope", before: "private", after: "everyone" },
          { field: "apiKey" as never, before: "a", after: "b" },
        ],
      }),
    );
    expect(e.fields).toEqual(["name", "scope", "apiKey"]);
    expect(e.changes).toEqual([{ field: "scope", before: "private", after: "everyone" }]);
  });

  test("[REQ-054] text is cut to length and stripped of control characters", () => {
    const e = cleaned(
      valid({ resource: { kind: "world", name: `긴${"가".repeat(500)}\n\u0000끝` } }),
    );
    expect(e.resource.name?.length).toBeLessThanOrEqual(120);
    expect(e.resource.name).not.toMatch(/\p{Cc}/u);
  });

  test("[REQ-054] it can be about a person or an agent, on someone's behalf, in a case: the same shape", () => {
    const e = cleaned(
      valid({
        subject: { kind: "agent", id: "triage", name: "분류", admin: false },
        onBehalfOf: { kind: "person", id: "haneul" },
        caseId: "case-9",
      }),
    );
    expect(e).toMatchObject({
      subject: { kind: "agent" },
      onBehalfOf: { id: "haneul" },
      caseId: "case-9",
    });
  });
});

describe("the time, the counters and the log lines [REQ-054]", () => {
  test("[REQ-054] the time of an entry is the clock it was given: the same calls, the same times, never the wall", async () => {
    const run = async () => {
      const store = new MemoryAuditStore();
      const audit = new Auditor(store, clock());
      for (let i = 0; i < 3; i++) await audit.record(valid());
      return (await store.query({ limit: 10 })).entries.map((e) => e.at);
    };
    expect(await run()).toEqual(await run());
    expect(await run()).toEqual([
      "2026-10-29T00:00:02.000Z",
      "2026-10-29T00:00:01.000Z",
      "2026-10-29T00:00:00.000Z",
    ]);
  });

  test("[REQ-054] entries are counted by action and outcome, and the text has only those two as labels", async () => {
    const audit = new Auditor(new MemoryAuditStore(), clock());
    await audit.record(valid());
    await audit.record(valid());
    await audit.record(valid({ outcome: "denied", reason: "not_owner" }));
    const text = auditMetricsText(audit.counts());
    expect(text).toContain(
      'terrarium_audit_entries_total{action="world.create",outcome="allowed"} 2',
    );
    expect(text).toContain(
      'terrarium_audit_entries_total{action="world.create",outcome="denied"} 1',
    );
    expect(text).toContain("terrarium_audit_write_failures_total 0");
    expect(text).not.toContain("haneul");
    expect(text).not.toContain("w1");
  });

  test("[REQ-054] a store that fails is counted, the log line holds the action and outcome only, and the message says what to do", async () => {
    const lines: unknown[] = [];
    const broken = {
      append: async () => {
        throw new Error("disk /secret/path full");
      },
      ready: async () => {
        throw new Error("read-only /secret/path");
      },
      query: async () => ({ entries: [] }),
      sweep: async () => 0,
    };
    const audit = new Auditor(broken, clock(), (l) => lines.push(l));
    await expect(audit.ready()).rejects.toThrow(NOT_DONE);
    await expect(audit.record(valid())).rejects.toBeInstanceOf(AuditWriteError);
    await expect(audit.record(valid())).rejects.toThrow(DONE_UNRECORDED);
    expect(await audit.tryRecord(valid())).toBe(false);
    expect(audit.counts().failures).toBe(4);
    expect(JSON.stringify(lines)).not.toContain("secret");
    expect(JSON.stringify(lines)).not.toContain("haneul");
    for (const l of lines) expect(Object.keys(l as object).sort()).toEqual(["action", "outcome"]);
  });
});

describe("the one removal [REQ-054]", () => {
  test("[REQ-054] the sweep takes what is older than the setting and writes an entry saying how many, as the server", async () => {
    const store = new MemoryAuditStore();
    await store.append("2025-01-01T00:00:00.000Z", valid());
    await store.append("2026-10-28T00:00:00.000Z", valid());
    const audit = new Auditor(store, clock());
    expect(await audit.sweep(30)).toBe(1);
    const entries = (await store.query({ limit: 10 })).entries;
    expect(entries.map((e) => e.action)).toEqual(["audit.sweep", "world.create"]);
    expect(entries[0]).toMatchObject({
      subject: { kind: "system" },
      detail: { removed: 1, retentionDays: 30 },
    });
    expect(await new Auditor(store, clock()).sweep(0)).toBe(0);
    expect((await store.query({ limit: 10 })).entries).toHaveLength(2);
  });

  test("[REQ-054] nothing in the server removes or changes an entry but the sweep: the SQL that touches the table is read in full", () => {
    const root = path.resolve(__dirname, "..");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.ts$/.test(f.name) && !/\.test\.ts$/.test(f.name)) files.push(p);
      }
    };
    walk(root);
    const touching = files.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .filter((l) =>
          /\b(DELETE\s+FROM|UPDATE|DROP\s+TABLE|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE)\b[^`"']*audit_log/i.test(
            l,
          ),
        )
        .map((l) => `${path.basename(f)}: ${l.trim()}`),
    );
    expect(touching).toEqual([
      `sqlite-audit.ts: return Number(this.sql("DELETE FROM audit_log WHERE at < ?").run(cutoff).changes);`,
    ]);
  });

  test("[REQ-054] every action of the closed list can be written", async () => {
    const audit = new Auditor(new MemoryAuditStore(), clock());
    for (const action of AUDIT_ACTIONS) await audit.record(valid({ action }));
    expect([...audit.counts().entries.keys()].length).toBe(AUDIT_ACTIONS.length);
  });
});
