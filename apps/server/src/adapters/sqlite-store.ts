/**
 * The ExperimentStore on SQLite (ADR-0025), using Node's built-in driver: one file, no native build,
 * WAL so readers never wait for the writer. Records are JSON documents; the columns beside them are
 * only what lists filter and sort on. Versions of worlds and scenarios are kept by digest forever,
 * because experiments point at them.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  type Experiment,
  type ExperimentFilter,
  type ExperimentStore,
  matchesText,
  type RunRecord,
  type ScenarioRecord,
  type ShareRecord,
  type WorldRecord,
  type WorldSummary,
} from "@terrarium/core/experiments";
import type { Blueprint, EntityKind } from "@terrarium/core/world";

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY, record TEXT NOT NULL, counts TEXT NOT NULL,
  updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS world_versions (
  id TEXT NOT NULL, digest TEXT NOT NULL, blueprint TEXT NOT NULL, PRIMARY KEY (id, digest));
CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY, world_id TEXT NOT NULL, record TEXT NOT NULL,
  updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS scenario_versions (
  id TEXT NOT NULL, digest TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (id, digest));
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, benchmark_key TEXT NOT NULL, parent_id TEXT,
  world_id TEXT NOT NULL, scenario_id TEXT NOT NULL, created_at TEXT NOT NULL, record TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS experiments_created ON experiments (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS experiments_benchmark ON experiments (benchmark_key);
CREATE INDEX IF NOT EXISTS experiments_parent ON experiments (parent_id);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL, idx INTEGER NOT NULL, status TEXT NOT NULL,
  queued_at TEXT NOT NULL, record TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS runs_experiment ON runs (experiment_id, idx);
CREATE INDEX IF NOT EXISTS runs_status ON runs (status);
CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, experiment_id TEXT NOT NULL, record TEXT NOT NULL);
`;

type Row = Record<string, unknown>;
const parse = <T>(text: unknown): T => JSON.parse(String(text)) as T;

function countKinds(bp: Blueprint): Partial<Record<EntityKind, number>> {
  const out: Partial<Record<EntityKind, number>> = {};
  for (const e of bp.entities) out[e.kind] = (out[e.kind] ?? 0) + 1;
  return out;
}

/** Filters that map to columns; the text filter is applied after (names are short, lists are small). */
const COLUMN_FILTERS: ReadonlyArray<[keyof ExperimentFilter, string]> = [
  ["owner", "owner"],
  ["benchmarkKey", "benchmark_key"],
  ["parentId", "parent_id"],
  ["worldId", "world_id"],
  ["scenarioId", "scenario_id"],
];

export class SqliteStore implements ExperimentStore {
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();

  /** `file` is a path, or ":memory:" for tests. */
  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;",
    );
    this.migrate();
  }

  private migrate(): void {
    const version = Number((this.db.prepare("PRAGMA user_version").get() as Row).user_version);
    if (version > SCHEMA_VERSION)
      throw new Error(`데이터 파일이 더 새 버전(${version})이다. 서버를 업데이트한다`);
    this.db.exec(SCHEMA);
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  private sql(text: string): StatementSync {
    let s = this.statements.get(text);
    if (!s) {
      s = this.db.prepare(text);
      this.statements.set(text, s);
    }
    return s;
  }

  close(): void {
    this.db.close();
  }

  async putWorld(world: WorldRecord): Promise<void> {
    const { blueprint, ...rest } = world;
    this.db.exec("BEGIN");
    try {
      this.sql(
        "INSERT INTO worlds (id, record, counts, updated_at, deleted) VALUES (?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET record = excluded.record, counts = excluded.counts, updated_at = excluded.updated_at, deleted = 0",
      ).run(world.id, JSON.stringify(rest), JSON.stringify(countKinds(blueprint)), world.updatedAt);
      this.sql("INSERT OR IGNORE INTO world_versions (id, digest, blueprint) VALUES (?, ?, ?)").run(
        world.id,
        world.digest,
        JSON.stringify(blueprint),
      );
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async getWorld(id: string): Promise<WorldRecord | undefined> {
    const row = this.sql("SELECT record FROM worlds WHERE id = ? AND deleted = 0").get(id) as
      | Row
      | undefined;
    if (!row) return undefined;
    const rest = parse<Omit<WorldRecord, "blueprint">>(row.record);
    const blueprint = await this.worldVersion(id, rest.digest);
    return blueprint && { ...rest, blueprint };
  }

  async listWorlds(): Promise<WorldSummary[]> {
    const rows = this.sql(
      "SELECT record, counts FROM worlds WHERE deleted = 0 ORDER BY updated_at DESC",
    ).all() as Row[];
    return rows.map((r) => ({
      ...parse<Omit<WorldRecord, "blueprint">>(r.record),
      counts: parse(r.counts),
    }));
  }

  async worldVersion(id: string, digest: string): Promise<Blueprint | undefined> {
    const row = this.sql("SELECT blueprint FROM world_versions WHERE id = ? AND digest = ?").get(
      id,
      digest,
    ) as Row | undefined;
    return row && parse<Blueprint>(row.blueprint);
  }

  async deleteWorld(id: string): Promise<boolean> {
    return (
      Number(
        this.sql("UPDATE worlds SET deleted = 1 WHERE id = ? AND deleted = 0").run(id).changes,
      ) > 0
    );
  }

  async putScenario(scenario: ScenarioRecord): Promise<void> {
    this.sql(
      "INSERT INTO scenarios (id, world_id, record, updated_at, deleted) VALUES (?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET world_id = excluded.world_id, record = excluded.record, updated_at = excluded.updated_at, deleted = 0",
    ).run(scenario.id, scenario.worldId, JSON.stringify(scenario), scenario.updatedAt);
    this.sql("INSERT OR IGNORE INTO scenario_versions (id, digest, doc) VALUES (?, ?, ?)").run(
      scenario.id,
      scenario.digest,
      JSON.stringify(scenario.doc),
    );
  }

  async getScenario(id: string): Promise<ScenarioRecord | undefined> {
    const row = this.sql("SELECT record FROM scenarios WHERE id = ? AND deleted = 0").get(id) as
      | Row
      | undefined;
    return row && parse<ScenarioRecord>(row.record);
  }

  async listScenarios(worldId?: string): Promise<ScenarioRecord[]> {
    const rows = (
      worldId === undefined
        ? this.sql("SELECT record FROM scenarios WHERE deleted = 0 ORDER BY updated_at DESC").all()
        : this.sql(
            "SELECT record FROM scenarios WHERE deleted = 0 AND world_id = ? ORDER BY updated_at DESC",
          ).all(worldId)
    ) as Row[];
    return rows.map((r) => parse<ScenarioRecord>(r.record));
  }

  async scenarioVersion(id: string, digest: string): Promise<ScenarioRecord["doc"] | undefined> {
    const row = this.sql("SELECT doc FROM scenario_versions WHERE id = ? AND digest = ?").get(
      id,
      digest,
    ) as Row | undefined;
    return row && parse<ScenarioRecord["doc"]>(row.doc);
  }

  async deleteScenario(id: string): Promise<boolean> {
    return (
      Number(
        this.sql("UPDATE scenarios SET deleted = 1 WHERE id = ? AND deleted = 0").run(id).changes,
      ) > 0
    );
  }

  async putExperiment(e: Experiment): Promise<void> {
    this.sql(
      "INSERT OR REPLACE INTO experiments (id, owner, benchmark_key, parent_id, world_id, scenario_id, created_at, record) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      e.id,
      e.owner,
      e.benchmarkKey,
      e.parentId ?? null,
      e.recipe.worldId,
      e.recipe.scenarioId,
      e.createdAt,
      JSON.stringify(e),
    );
  }

  async getExperiment(id: string): Promise<Experiment | undefined> {
    const row = this.sql("SELECT record FROM experiments WHERE id = ?").get(id) as Row | undefined;
    return row && parse<Experiment>(row.record);
  }

  async listExperiments(filter: ExperimentFilter = {}): Promise<Experiment[]> {
    const used = COLUMN_FILTERS.filter(([key]) => filter[key] !== undefined);
    const where =
      used.length > 0 ? `WHERE ${used.map(([, col]) => `${col} = ?`).join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT record FROM experiments ${where} ORDER BY created_at DESC, id DESC`)
      .all(...used.map(([key]) => String(filter[key]))) as Row[];
    const found = rows
      .map((r) => parse<Experiment>(r.record))
      .filter((e) => matchesText(e, filter.text));
    return found.slice(0, filter.limit ?? found.length);
  }

  async putRun(run: RunRecord): Promise<void> {
    this.sql(
      "INSERT OR REPLACE INTO runs (id, experiment_id, idx, status, queued_at, record) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(run.id, run.experimentId, run.index, run.status, run.queuedAt, JSON.stringify(run));
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    const row = this.sql("SELECT record FROM runs WHERE id = ?").get(id) as Row | undefined;
    return row && parse<RunRecord>(row.record);
  }

  async listRuns(experimentId: string): Promise<RunRecord[]> {
    const rows = this.sql("SELECT record FROM runs WHERE experiment_id = ? ORDER BY idx").all(
      experimentId,
    ) as Row[];
    return rows.map((r) => parse<RunRecord>(r.record));
  }

  async listActiveRuns(): Promise<RunRecord[]> {
    const rows = this.sql(
      "SELECT record FROM runs WHERE status IN ('queued', 'running') ORDER BY queued_at, idx",
    ).all() as Row[];
    return rows.map((r) => parse<RunRecord>(r.record));
  }

  async putShare(share: ShareRecord): Promise<void> {
    this.sql("INSERT OR REPLACE INTO shares (token, experiment_id, record) VALUES (?, ?, ?)").run(
      share.token,
      share.experimentId,
      JSON.stringify(share),
    );
  }

  async getShare(token: string): Promise<ShareRecord | undefined> {
    const row = this.sql("SELECT record FROM shares WHERE token = ?").get(token) as Row | undefined;
    return row && parse<ShareRecord>(row.record);
  }

  async deleteShare(token: string): Promise<boolean> {
    return Number(this.sql("DELETE FROM shares WHERE token = ?").run(token).changes) > 0;
  }
}
