import { describe, expect, test } from "vitest";
import {
  type AuditFilter,
  isResourceKind,
  type NewAuditEntry,
  registerResourceKind,
  resourceKinds,
} from "./audit";
import { MemoryAuditStore } from "./audit-memory";

const entry = (who: string, over: Partial<NewAuditEntry> = {}): NewAuditEntry => ({
  requestId: "r",
  subject: { kind: "person", id: who, name: who, admin: false },
  action: "world.create",
  outcome: "allowed",
  resource: { kind: "world", id: "w1", owner: who },
  ...over,
});

async function filled() {
  const store = new MemoryAuditStore();
  for (let i = 0; i < 10; i++)
    await store.append(
      `2026-10-0${(i % 9) + 1}T00:00:00.000Z`,
      entry(i % 2 ? "omar" : "olivia", i === 3 ? { outcome: "denied", reason: "not_owner" } : {}),
    );
  return store;
}
const q = (f: Partial<AuditFilter> = {}): AuditFilter => ({ limit: 100, ...f });

describe("the audit store in memory [REQ-054]", () => {
  test("[REQ-054] newest first, each entry given a number and the time it was written with", async () => {
    const store = await filled();
    const { entries } = await store.query(q());
    expect(entries.map((e) => e.seq)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(entries[0]?.at).toBe("2026-10-01T00:00:00.000Z");
  });

  test("[REQ-054] filters on who, outcome, time and owner, together", async () => {
    const store = await filled();
    expect(
      (await store.query(q({ subject: "omar" }))).entries.every((e) => e.subject.id === "omar"),
    ).toBe(true);
    expect((await store.query(q({ outcome: "denied" }))).entries).toHaveLength(1);
    expect(
      (await store.query(q({ from: "2026-10-05T00:00:00.000Z" }))).entries.every(
        (e) => e.at >= "2026-10-05",
      ),
    ).toBe(true);
    expect(
      (await store.query(q({ to: "2026-10-05T00:00:00.000Z" }))).entries.every(
        (e) => e.at < "2026-10-05",
      ),
    ).toBe(true);
    expect(
      (await store.query(q({ subject: "omar", outcome: "denied" }))).entries.map((e) => e.seq),
    ).toEqual([4]);
    expect((await store.query(q({ owner: "olivia" }))).entries).toHaveLength(5);
  });

  test("[REQ-054] pages hand back a cursor until the last, with nothing twice and nothing missed", async () => {
    const store = await filled();
    const seen: number[] = [];
    let before: number | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const page = await store.query(q({ limit: 3, ...(before ? { before } : {}) }));
      seen.push(...page.entries.map((e) => e.seq));
      if (page.next === undefined) break;
      before = page.next;
    }
    expect(seen).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  test("[REQ-054] what is read back is a copy: changing it changes nothing in the store", async () => {
    const store = await filled();
    const first = (await store.query(q())).entries[0];
    (first as { outcome: string }).outcome = "failed";
    expect((await store.query(q())).entries[0]?.outcome).toBe("allowed");
  });

  test("[REQ-054] the one removal is the sweep, which takes what is older than the cut and nothing else", async () => {
    const store = await filled();
    const removed = await store.sweep("2026-10-05T00:00:00.000Z");
    expect(removed).toBe(5);
    expect((await store.query(q())).entries.every((e) => e.at >= "2026-10-05")).toBe(true);
    expect(await store.sweep("2000-01-01T00:00:00.000Z")).toBe(0);
    expect(store).not.toHaveProperty("delete");
    expect(store).not.toHaveProperty("update");
  });
});

describe("the kinds of thing an entry can be about [REQ-054]", () => {
  test("[REQ-054] the kinds of today are known, and a kind of the future is added once and then known", () => {
    for (const k of ["world", "scenario", "experiment", "model", "connection", "audit", "session"])
      expect(isResourceKind(k), k).toBe(true);
    expect(isResourceKind("workflow_case")).toBe(false);
    registerResourceKind("workflow_case");
    expect(isResourceKind("workflow_case")).toBe(true);
    expect(resourceKinds()).toContain("workflow_case");
  });
});
