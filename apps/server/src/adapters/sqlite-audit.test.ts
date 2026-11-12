/**
 * The audit log in SQLite (ADR-0193): it answers as the in-memory store does, it survives a restart, a data file of the
 * version before it opens with the log added and nothing else touched, and the log has indexes and only one way to remove.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type AuditFilter,
  type AuditStore,
  MemoryAuditStore,
  type NewAuditEntry,
} from "@terrarium/core/experiments";
import { afterAll, describe, expect, test } from "vitest";
import { SqliteStore } from "./sqlite-store";

const dir = mkdtempSync(path.join(tmpdir(), "terrarium-audit-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const entry = (who: string, i: number): NewAuditEntry => ({
  requestId: `r${i}`,
  subject: { kind: "person", id: who, name: `이름 ${who}`, source: "proxy", admin: who === "boss" },
  action: i % 3 === 0 ? "world.update" : "world.create",
  outcome: i === 4 ? "denied" : "allowed",
  ...(i === 4 ? { reason: "not_owner" as const } : {}),
  route: "createWorld",
  resource: {
    kind: "world",
    id: `w${i % 4}`,
    name: "홀",
    owner: "olivia",
    scope: "group",
    group: "part-a",
  },
  fields: ["name", "scope"],
  ...(i === 2
    ? { changes: [{ field: "scope" as const, before: "private", after: "everyone" }] }
    : {}),
  ...(i === 5 ? { remoteAddress: "10.0.0.7", detail: { count: 2 } } : {}),
});

async function fill(store: AuditStore) {
  for (let i = 0; i < 12; i++)
    await store.append(
      `2026-10-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
      entry(["olivia", "omar", "boss"][i % 3] as string, i),
    );
}

const FILTERS: Partial<AuditFilter>[] = [
  {},
  { subject: "omar" },
  { action: "world.update" },
  { outcome: "denied" },
  { resourceKind: "world", resourceId: "w1" },
  { from: "2026-10-15T00:00:00.000Z" },
  { to: "2026-10-15T00:00:00.000Z" },
  { from: "2026-10-12T00:00:00.000Z", to: "2026-10-18T00:00:00.000Z", subject: "olivia" },
  { owner: "olivia" },
  { owner: "nobody" },
  { before: 6 },
];

describe("[REQ-054] the audit log in SQLite", () => {
  test("[REQ-054] it answers every filter and every page as the in-memory store does", async () => {
    const sql = new SqliteStore(":memory:");
    const memory = new MemoryAuditStore();
    await fill(sql.audit);
    await fill(memory);
    for (const f of FILTERS) {
      for (const limit of [3, 100]) {
        const a = await sql.audit.query({ ...f, limit });
        const b = await memory.query({ ...f, limit });
        expect(a, JSON.stringify(f)).toEqual(b);
      }
    }
    sql.close();
  });

  test("[REQ-054] an entry comes back whole: its before and after, its fields, the address, the detail", async () => {
    const sql = new SqliteStore(":memory:");
    await fill(sql.audit);
    const all = (await sql.audit.query({ limit: 100 })).entries;
    expect(all.find((e) => e.requestId === "r2")?.changes).toEqual([
      { field: "scope", before: "private", after: "everyone" },
    ]);
    expect(all.find((e) => e.requestId === "r5")).toMatchObject({
      remoteAddress: "10.0.0.7",
      detail: { count: 2 },
    });
    expect(all.find((e) => e.requestId === "r4")).toMatchObject({
      outcome: "denied",
      reason: "not_owner",
    });
    expect(all[0]?.at).toBe("2026-10-21T00:00:00.000Z");
    sql.close();
  });

  test("[REQ-054] it is still there after the file is closed and opened again", async () => {
    const file = path.join(dir, "keep", "terrarium.db");
    const first = new SqliteStore(file);
    await fill(first.audit);
    first.close();
    const again = new SqliteStore(file);
    expect((await again.audit.query({ limit: 100 })).entries).toHaveLength(12);
    again.close();
  });

  test("[REQ-054] the sweep removes what is older than the cut and nothing newer", async () => {
    const sql = new SqliteStore(":memory:");
    await fill(sql.audit);
    expect(await sql.audit.sweep("2026-10-15T00:00:00.000Z")).toBe(5);
    const left = (await sql.audit.query({ limit: 100 })).entries;
    expect(left).toHaveLength(7);
    expect(left.every((e) => e.at >= "2026-10-15T00:00:00.000Z")).toBe(true);
    sql.close();
  });

  test("[REQ-054] it has a way to be asked whether a write would work, and it works when the file does", async () => {
    const sql = new SqliteStore(":memory:");
    await expect(sql.audit.ready()).resolves.toBeUndefined();
    sql.close();
    await expect(sql.audit.ready()).rejects.toBeDefined();
  });

  test("[REQ-054] the log is indexed by time, by who and by what, and by the owner", () => {
    const file = path.join(dir, "idx", "terrarium.db");
    new SqliteStore(file).close();
    const raw = new DatabaseSync(file);
    const idx = (
      raw
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='audit_log'")
        .all() as { name: string }[]
    ).map((r) => r.name);
    raw.close();
    for (const part of ["time", "subject", "resource", "owner"])
      expect(
        idx.some((n) => n.includes(part)),
        part,
      ).toBe(true);
  });

  test("[REQ-054] a data file of the version before it opens with the log added, and the rest as it was", async () => {
    const file = path.join(dir, "v3", "terrarium.db");
    const before = new SqliteStore(file);
    await before.putWorld({
      id: "w1",
      name: "예전 세계",
      owner: "olivia",
      updatedAt: "2026-10-01T00:00:00.000Z",
      digest: "d",
      blueprint: { entities: [], relations: [] },
    } as never);
    before.close();
    // what version 3 was: the same tables with no audit table
    const raw = new DatabaseSync(file);
    raw.exec("DROP TABLE audit_log; PRAGMA user_version = 3");
    raw.close();

    const store = new SqliteStore(file);
    expect((await store.listWorlds({ id: "x", groups: [], admin: true })).map((w) => w.id)).toEqual(
      ["w1"],
    );
    expect((await store.audit.query({ limit: 10 })).entries).toEqual([]);
    await store.audit.append("2026-11-01T00:00:00.000Z", entry("olivia", 1));
    expect((await store.audit.query({ limit: 10 })).entries).toHaveLength(1);
    store.close();

    const check = new DatabaseSync(file);
    expect(
      (check.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    ).toBe(4);
    check.close();
    // and opening it once more neither fails nor loses the entry
    const again = new SqliteStore(file);
    expect((await again.audit.query({ limit: 10 })).entries).toHaveLength(1);
    again.close();
  });

  test("[REQ-054] the table has one writer: the store type offers append and sweep to remove, and no update or delete", () => {
    const sql = new SqliteStore(":memory:");
    for (const name of ["update", "delete", "remove", "clear", "put"])
      expect(sql.audit).not.toHaveProperty(name);
    sql.close();
  });
});
