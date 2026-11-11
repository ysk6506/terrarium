/**
 * Visibility scopes in the stores (ADR-0174, permissions.md section 8): a data file from before scopes opens and its records read
 * as everyone's, and the SQL that filters a list agrees with the rule of core row by row, as the in-memory store applies it.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MemoryStore, type Scope, type Sight, seen } from "@terrarium/core/experiments";
import { afterAll, describe, expect, test } from "vitest";
import { SqliteStore } from "./sqlite-store";

const dir = mkdtempSync(path.join(tmpdir(), "terrarium-scope-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The tables of schema version 2, before scopes: no scope or group column, no owner on worlds and scenarios. */
const VERSION_2 = `
CREATE TABLE worlds (id TEXT PRIMARY KEY, record TEXT NOT NULL, counts TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE scenarios (id TEXT PRIMARY KEY, world_id TEXT NOT NULL, record TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE experiments (id TEXT PRIMARY KEY, owner TEXT NOT NULL, benchmark_key TEXT NOT NULL, parent_id TEXT, world_id TEXT NOT NULL, scenario_id TEXT NOT NULL, created_at TEXT NOT NULL, record TEXT NOT NULL);
CREATE TABLE connections (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, record TEXT NOT NULL);
CREATE TABLE llm_models (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, record TEXT NOT NULL);`;

const AT = "2026-11-01T00:00:00.000Z";

const BLUEPRINT = { entities: [], relations: [] };
const whole = (w: object) => ({ ...w, digest: "d1", blueprint: BLUEPRINT }) as never;

const stranger: Sight = { id: "stranger", groups: [], admin: false };

function oldFile(name: string): string {
  const file = path.join(dir, name, "terrarium.db");
  mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec(VERSION_2);
  raw
    .prepare("INSERT INTO worlds VALUES (?,?,?,?,0)")
    .run(
      "w1",
      JSON.stringify({ id: "w1", name: "예전 세계", owner: "olivia", updatedAt: AT }),
      "{}",
      AT,
    );
  raw
    .prepare("INSERT INTO scenarios VALUES (?,?,?,?,0)")
    .run(
      "s1",
      "w1",
      JSON.stringify({ id: "s1", worldId: "w1", owner: "olivia", updatedAt: AT }),
      AT,
    );
  raw.prepare("INSERT INTO experiments VALUES (?,?,?,?,?,?,?,?)").run(
    "e1",
    "olivia",
    "k",
    null,
    "w1",
    "s1",
    AT,
    JSON.stringify({
      id: "e1",
      owner: "olivia",
      benchmarkKey: "k",
      createdAt: AT,
      recipe: { worldId: "w1", scenarioId: "s1" },
    }),
  );
  raw
    .prepare("INSERT INTO connections VALUES (?,?,?)")
    .run("c1", AT, JSON.stringify({ id: "c1", owner: "olivia", createdAt: AT }));
  raw
    .prepare("INSERT INTO llm_models VALUES (?,?,?)")
    .run("m1", AT, JSON.stringify({ id: "m1", owner: "olivia", createdAt: AT }));
  raw.exec("PRAGMA user_version = 2");
  raw.close();
  return file;
}

describe("[REQ-054] a data file from before scopes", () => {
  test("[REQ-054] opens, and every old record reads as everyone's, whatever its kind", async () => {
    const store = new SqliteStore(oldFile("old"));
    expect((await store.listWorlds(stranger)).map((w) => w.id)).toEqual(["w1"]);
    expect((await store.listScenarios(undefined, stranger)).map((s) => s.id)).toEqual(["s1"]);
    expect((await store.listExperiments({ visibleTo: stranger })).map((e) => e.id)).toEqual(["e1"]);
    expect((await store.listConnections(stranger)).map((c) => c.id)).toEqual(["c1"]);
    expect((await store.listModels(stranger)).map((m) => m.id)).toEqual(["m1"]);
    store.close();
    // the owner column of worlds and scenarios was filled from the stored records, and the version is raised
    const raw = new DatabaseSync(path.join(dir, "old", "terrarium.db"));
    expect((raw.prepare("SELECT owner FROM worlds").get() as { owner: string }).owner).toBe(
      "olivia",
    );
    expect((raw.prepare("SELECT owner FROM scenarios").get() as { owner: string }).owner).toBe(
      "olivia",
    );
    expect(
      (raw.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    ).toBeGreaterThanOrEqual(3);
    raw.close();
  });

  test("[REQ-054] the owner of an old world is found in its record, so narrowing it later keeps the maker's sight", async () => {
    const file = oldFile("narrow");
    const store = new SqliteStore(file);
    // the old world is saved again, now private: its maker (found in the record, not in a column of the old file) still sees it
    await store.putWorld(
      whole({ id: "w1", name: "예전 세계", owner: "olivia", updatedAt: AT, scope: "private" }),
    );
    expect(
      (await store.listWorlds({ id: "olivia", groups: [], admin: false })).map((w) => w.id),
    ).toEqual(["w1"]);
    expect(await store.listWorlds(stranger)).toEqual([]);
    store.close();
    // and the file opens again without trying to add the columns twice
    const again = new SqliteStore(file);
    expect((await again.listWorlds({ id: "x", groups: [], admin: true })).map((w) => w.id)).toEqual(
      ["w1"],
    );
    again.close();
  });

  test("[REQ-054] everyone's records are stored without scope fields, as old records are", async () => {
    const store = new SqliteStore(oldFile("same"));
    await store.putWorld(whole({ id: "w1", name: "예전 세계", owner: "olivia", updatedAt: AT }));
    store.close();
    const raw = new DatabaseSync(path.join(dir, "same", "terrarium.db"));
    const row = raw.prepare("SELECT record, scope FROM worlds WHERE id = 'w1'").get() as {
      record: string;
      scope: string | null;
    };
    expect(row.scope).toBeNull();
    expect(row.record).not.toContain("scope");
    raw.close();
  });
});

describe("[REQ-054] the SQL filter and the rule of core agree", () => {
  const OWNERS = ["olivia", "mina", "omar"];
  const SCOPES: readonly (Scope | undefined)[] = [undefined, "everyone", "private", "group"];
  const GROUPS: readonly (string | undefined)[] = [undefined, "part-a", "part-b"];
  const SIGHTS: readonly Sight[] = [
    { id: "olivia", groups: ["part-a"], admin: false },
    { id: "mina", groups: ["part-a", "x"], admin: false },
    { id: "omar", groups: ["part-b"], admin: false },
    { id: "boss", groups: [], admin: true },
    { id: "lone", groups: [], admin: false },
  ];

  test("[REQ-054] for every combination of owner, scope and group, each person gets the same worlds from both stores", async () => {
    const sqlite = new SqliteStore(":memory:");
    const memory = new MemoryStore();
    const records = OWNERS.flatMap((owner) =>
      SCOPES.flatMap((scope) =>
        GROUPS.map((group) => ({
          id: `w-${owner}-${scope ?? "none"}-${group ?? "none"}`,
          name: "세계",
          owner,
          updatedAt: AT,
          ...(scope ? { scope } : {}),
          ...(group ? { group } : {}),
        })),
      ),
    );
    for (const w of records) {
      await sqlite.putWorld(whole(w));
      await memory.putWorld(whole(w));
    }
    for (const sight of SIGHTS) {
      const expected = records
        .filter((r) => seen(sight, r))
        .map((r) => r.id)
        .sort();
      const fromSql = (await sqlite.listWorlds(sight)).map((w) => w.id).sort();
      const fromMemory = (await memory.listWorlds(sight)).map((w) => w.id).sort();
      expect(fromSql, sight.id).toEqual(expected);
      expect(fromMemory, sight.id).toEqual(expected);
    }
    sqlite.close();
  });
});
