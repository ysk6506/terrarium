import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { newRun } from "@terrarium/core/experiments";
import { afterAll, describe, expect, test } from "vitest";
import { SqliteStore } from "./sqlite-store";

const dir = mkdtempSync(path.join(tmpdir(), "terrarium-repeat-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The runs table as the first version of the data file made it: no repeat number. */
const VERSION_1_RUNS = `
CREATE TABLE runs (
  id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL, idx INTEGER NOT NULL, status TEXT NOT NULL,
  queued_at TEXT NOT NULL, record TEXT NOT NULL);`;

describe("runs keep their repeat number in the SQLite store [REQ-118]", () => {
  test("a data file from before repeats is opened, and its runs are the first of their seed", async () => {
    const file = path.join(dir, "old", "terrarium.db");
    mkdirSync(path.dirname(file), { recursive: true });
    const raw = new DatabaseSync(file);
    raw.exec(VERSION_1_RUNS);
    const old = {
      id: "r1",
      experimentId: "e1",
      index: 0,
      seed: 3,
      status: "queued",
      queuedAt: "t",
    };
    raw
      .prepare(
        "INSERT INTO runs (id, experiment_id, idx, status, queued_at, record) VALUES (?,?,?,?,?,?)",
      )
      .run("r1", "e1", 0, "queued", "t", JSON.stringify(old));
    raw.exec("PRAGMA user_version = 1");
    raw.close();

    const store = new SqliteStore(file);
    expect(await store.listRuns("e1")).toEqual([{ ...old, repeat: 1 }]);
    expect(await store.getRun("r1")).toMatchObject({ seed: 3, repeat: 1 });
    // the same file takes new runs with their repeat number, and survives another opening
    await store.putRun(newRun("r2", "e1", 1, 3, "t", 2));
    store.close();
    const again = new SqliteStore(file);
    expect((await again.listRuns("e1")).map((r) => [r.seed, r.repeat])).toEqual([
      [3, 1],
      [3, 2],
    ]);
    expect((await again.listActiveRuns()).map((r) => r.repeat)).toEqual([1, 2]);
    again.close();
  });

  test("a new data file stores the repeat number", async () => {
    const store = new SqliteStore(":memory:");
    await store.putRun(newRun("r1", "e1", 0, 1, "t", 3));
    expect(await store.getRun("r1")).toMatchObject({ seed: 1, repeat: 3 });
    store.close();
  });
});
