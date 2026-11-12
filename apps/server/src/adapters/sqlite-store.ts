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
  type AgentHistory,
  type CalibrationMark,
  type ConnectionRecord,
  type CurrentProcessRecord,
  type Experiment,
  type ExperimentFilter,
  type ExperimentStore,
  type Journal,
  type JournalEntry,
  type LlmModelRecord,
  matchesMetadata,
  matchesText,
  type PresetKind,
  type PresetRecord,
  type RunRecord,
  type ScenarioRecord,
  type ServiceCardRecord,
  type ShareRecord,
  type Sight,
  seen,
  type TitleAward,
  type WorldLike,
  type WorldRecord,
  type WorldSummary,
} from "@terrarium/core/experiments";
import type { Blueprint, EntityKind } from "@terrarium/core/world";
import { AUDIT_SCHEMA, AuditTables } from "./sqlite-audit";
import { CommunityTables } from "./sqlite-community";
import { addRepeatColumn, runOf } from "./sqlite-migrate";
import { RecordTable } from "./sqlite-records";
import { addScopeColumns, scopeColumns, visibleSql } from "./sqlite-scope";

const SCHEMA_VERSION = 4;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY, record TEXT NOT NULL, counts TEXT NOT NULL,
  updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, owner TEXT, scope TEXT, grp TEXT);
CREATE TABLE IF NOT EXISTS world_versions (
  id TEXT NOT NULL, digest TEXT NOT NULL, blueprint TEXT NOT NULL, PRIMARY KEY (id, digest));
CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY, world_id TEXT NOT NULL, record TEXT NOT NULL,
  updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, owner TEXT, scope TEXT, grp TEXT);
CREATE TABLE IF NOT EXISTS scenario_versions (
  id TEXT NOT NULL, digest TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (id, digest));
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, benchmark_key TEXT NOT NULL, parent_id TEXT,
  world_id TEXT NOT NULL, scenario_id TEXT NOT NULL, created_at TEXT NOT NULL, record TEXT NOT NULL,
  scope TEXT, grp TEXT);
CREATE INDEX IF NOT EXISTS experiments_created ON experiments (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS experiments_benchmark ON experiments (benchmark_key);
CREATE INDEX IF NOT EXISTS experiments_parent ON experiments (parent_id);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL, idx INTEGER NOT NULL, status TEXT NOT NULL,
  queued_at TEXT NOT NULL, record TEXT NOT NULL, repeat_no INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS runs_experiment ON runs (experiment_id, idx);
CREATE INDEX IF NOT EXISTS runs_status ON runs (status);
CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, experiment_id TEXT NOT NULL, record TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, record TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_histories (
  harness_id TEXT NOT NULL, agent_id TEXT NOT NULL, record TEXT NOT NULL,
  PRIMARY KEY (harness_id, agent_id));
CREATE TABLE IF NOT EXISTS run_journal (
  run_id TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL, entries TEXT NOT NULL,
  PRIMARY KEY (run_id, seq));
CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, record TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS presets_owner ON presets (owner, kind);
CREATE TABLE IF NOT EXISTS llm_models (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, record TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS service_cards (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, record TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS current_processes (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, record TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS world_likes (
  world_id TEXT NOT NULL, user_name TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (world_id, user_name));
CREATE TABLE IF NOT EXISTS calibration_marks (
  scenario_id TEXT NOT NULL, digest TEXT NOT NULL, at TEXT NOT NULL, clean INTEGER NOT NULL,
  PRIMARY KEY (scenario_id, digest));
CREATE TABLE IF NOT EXISTS title_awards (
  user_name TEXT NOT NULL, key TEXT NOT NULL, earned_at TEXT NOT NULL, PRIMARY KEY (user_name, key));
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
      throw new Error(`데이터 파일이 더 새 버전(${version})이에요. 서버를 업데이트해 주세요`);
    // Version 2 (ADR-0158) gave runs a repeat number; the runs of a version-1 file are the first run of their seed.
    if (version === 1) addRepeatColumn(this.db);
    // Version 3 (permissions step 나) gave worlds, scenarios and experiments an owner, scope and group column; old rows read as everyone's.
    if (version > 0 && version < 3) addScopeColumns(this.db);
    // Version 4 (permissions step 다) added the audit table; the schema creates it in a file that lacks it.
    this.db.exec(SCHEMA);
    this.db.exec(AUDIT_SCHEMA);
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
        "INSERT INTO worlds (id, record, counts, updated_at, deleted, owner, scope, grp) VALUES (?, ?, ?, ?, 0, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record, counts = excluded.counts, updated_at = excluded.updated_at, deleted = 0, owner = excluded.owner, scope = excluded.scope, grp = excluded.grp",
      ).run(
        world.id,
        JSON.stringify(rest),
        JSON.stringify(countKinds(blueprint)),
        world.updatedAt,
        world.owner,
        ...scopeColumns(world),
      );
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

  async listWorlds(visibleTo?: Sight): Promise<WorldSummary[]> {
    const visible = visibleSql(visibleTo);
    const rows = this.db
      .prepare(
        `SELECT record, counts FROM worlds WHERE deleted = 0${visible ? ` AND ${visible.sql}` : ""} ORDER BY updated_at DESC`,
      )
      .all(...(visible?.params ?? [])) as Row[];
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
      "INSERT INTO scenarios (id, world_id, record, updated_at, deleted, owner, scope, grp) VALUES (?, ?, ?, ?, 0, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET world_id = excluded.world_id, record = excluded.record, updated_at = excluded.updated_at, deleted = 0, owner = excluded.owner, scope = excluded.scope, grp = excluded.grp",
    ).run(
      scenario.id,
      scenario.worldId,
      JSON.stringify(scenario),
      scenario.updatedAt,
      scenario.owner,
      ...scopeColumns(scenario),
    );
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

  async listScenarios(worldId?: string, visibleTo?: Sight): Promise<ScenarioRecord[]> {
    const visible = visibleSql(visibleTo);
    const conditions = ["deleted = 0", ...(worldId === undefined ? [] : ["world_id = ?"])];
    if (visible) conditions.push(visible.sql);
    const rows = this.db
      .prepare(
        `SELECT record FROM scenarios WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC`,
      )
      .all(...(worldId === undefined ? [] : [worldId]), ...(visible?.params ?? [])) as Row[];
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
      "INSERT OR REPLACE INTO experiments (id, owner, benchmark_key, parent_id, world_id, scenario_id, created_at, record, scope, grp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      e.id,
      e.owner,
      e.benchmarkKey,
      e.parentId ?? null,
      e.recipe.worldId,
      e.recipe.scenarioId,
      e.createdAt,
      JSON.stringify(e),
      ...scopeColumns(e),
    );
  }

  async getExperiment(id: string): Promise<Experiment | undefined> {
    const row = this.sql("SELECT record FROM experiments WHERE id = ?").get(id) as Row | undefined;
    return row && parse<Experiment>(row.record);
  }

  async listExperiments(filter: ExperimentFilter = {}): Promise<Experiment[]> {
    const used = COLUMN_FILTERS.filter(([key]) => filter[key] !== undefined);
    const visible = visibleSql(filter.visibleTo);
    const conditions = used.map(([, col]) => `${col} = ?`);
    if (visible) conditions.push(visible.sql);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT record FROM experiments ${where} ORDER BY created_at DESC, id DESC`)
      .all(...used.map(([key]) => String(filter[key])), ...(visible?.params ?? [])) as Row[];
    const found = rows
      .map((r) => parse<Experiment>(r.record))
      .filter((e) => matchesText(e, filter.text) && matchesMetadata(e, filter.meta));
    return found.slice(0, filter.limit ?? found.length);
  }

  async putRun(run: RunRecord): Promise<void> {
    this.sql(
      "INSERT OR REPLACE INTO runs (id, experiment_id, idx, status, queued_at, record, repeat_no) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      run.id,
      run.experimentId,
      run.index,
      run.status,
      run.queuedAt,
      JSON.stringify(run),
      run.repeat,
    );
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    const row = this.sql("SELECT record, repeat_no FROM runs WHERE id = ?").get(id) as
      | Row
      | undefined;
    return row && runOf(row);
  }

  async listRuns(experimentId: string): Promise<RunRecord[]> {
    const rows = this.sql(
      "SELECT record, repeat_no FROM runs WHERE experiment_id = ? ORDER BY idx",
    ).all(experimentId) as Row[];
    return rows.map(runOf);
  }

  async listActiveRuns(): Promise<RunRecord[]> {
    const rows = this.sql(
      "SELECT record, repeat_no FROM runs WHERE status IN ('queued', 'running') ORDER BY queued_at, idx",
    ).all() as Row[];
    return rows.map(runOf);
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

  async listShares(experimentId: string): Promise<ShareRecord[]> {
    const rows = this.sql("SELECT record FROM shares WHERE experiment_id = ?").all(
      experimentId,
    ) as Row[];
    return rows
      .map((r) => parse<ShareRecord>(r.record))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.token.localeCompare(b.token));
  }

  async deleteShare(token: string): Promise<boolean> {
    return Number(this.sql("DELETE FROM shares WHERE token = ?").run(token).changes) > 0;
  }

  async putConnection(connection: ConnectionRecord): Promise<void> {
    this.sql("INSERT OR REPLACE INTO connections (id, created_at, record) VALUES (?, ?, ?)").run(
      connection.id,
      connection.createdAt,
      JSON.stringify(connection),
    );
  }

  async listConnections(visibleTo?: Sight): Promise<ConnectionRecord[]> {
    const rows = this.sql("SELECT record FROM connections ORDER BY created_at, id").all() as Row[];
    return rows
      .map((r) => parse<ConnectionRecord>(r.record))
      .filter((c) => visibleTo === undefined || seen(visibleTo, c));
  }

  async deleteConnection(id: string): Promise<boolean> {
    return Number(this.sql("DELETE FROM connections WHERE id = ?").run(id).changes) > 0;
  }

  async getAgentHistory(harnessId: string, agentId: string): Promise<AgentHistory | undefined> {
    const row = this.sql(
      "SELECT record FROM agent_histories WHERE harness_id = ? AND agent_id = ?",
    ).get(harnessId, agentId) as Row | undefined;
    return row && parse<AgentHistory>(row.record);
  }

  async putAgentHistory(history: AgentHistory): Promise<void> {
    this.sql(
      "INSERT OR REPLACE INTO agent_histories (harness_id, agent_id, record) VALUES (?, ?, ?)",
    ).run(history.harnessId, history.agentId, JSON.stringify(history));
  }

  async listAgentHistories(harnessId: string): Promise<AgentHistory[]> {
    const rows = this.sql(
      "SELECT record FROM agent_histories WHERE harness_id = ? ORDER BY agent_id",
    ).all(harnessId) as Row[];
    return rows.map((r) => parse<AgentHistory>(r.record));
  }

  async deleteAgentHistories(harnessId: string): Promise<number> {
    return Number(
      this.sql("DELETE FROM agent_histories WHERE harness_id = ?").run(harnessId).changes,
    );
  }
  async appendJournal(runId: string, entries: readonly JournalEntry[], at: string): Promise<void> {
    if (entries.length === 0) return;
    this.sql(
      "INSERT INTO run_journal (run_id, seq, at, entries) VALUES (?, COALESCE((SELECT MAX(seq) + 1 FROM run_journal WHERE run_id = ?), 0), ?, ?)",
    ).run(runId, runId, at, JSON.stringify(entries));
  }

  async readJournal(runId: string): Promise<Journal> {
    const rows = this.sql("SELECT at, entries FROM run_journal WHERE run_id = ? ORDER BY seq").all(
      runId,
    ) as Row[];
    const last = rows.at(-1);
    return {
      entries: rows.flatMap((r) => parse<JournalEntry[]>(r.entries)),
      ...(last ? { lastAt: String(last.at) } : {}),
    };
  }

  async deleteJournal(runId: string): Promise<void> {
    this.sql("DELETE FROM run_journal WHERE run_id = ?").run(runId);
  }

  async putPreset(preset: PresetRecord): Promise<void> {
    this.sql(
      "INSERT OR REPLACE INTO presets (id, owner, kind, created_at, record) VALUES (?, ?, ?, ?, ?)",
    ).run(preset.id, preset.owner, preset.kind, preset.createdAt, JSON.stringify(preset));
  }

  async getPreset(id: string): Promise<PresetRecord | undefined> {
    const row = this.sql("SELECT record FROM presets WHERE id = ?").get(id) as Row | undefined;
    return row && parse<PresetRecord>(row.record);
  }

  async listPresets(owner: string, kind?: PresetKind): Promise<PresetRecord[]> {
    const rows = (
      kind
        ? this.sql(
            "SELECT record FROM presets WHERE owner = ? AND kind = ? ORDER BY created_at, id",
          ).all(owner, kind)
        : this.sql("SELECT record FROM presets WHERE owner = ? ORDER BY created_at, id").all(owner)
    ) as Row[];
    return rows.map((r) => parse<PresetRecord>(r.record));
  }

  async deletePreset(id: string): Promise<boolean> {
    return Number(this.sql("DELETE FROM presets WHERE id = ?").run(id).changes) > 0;
  }

  private readonly models = new RecordTable<LlmModelRecord>((q) => this.sql(q), "llm_models");
  putModel = async (m: LlmModelRecord): Promise<void> => this.models.put(m);
  getModel = async (id: string) => this.models.get(id);
  listModels = async (visibleTo?: Sight) =>
    this.models.list().filter((m) => visibleTo === undefined || seen(visibleTo, m));
  deleteModel = async (id: string) => this.models.delete(id);

  private readonly cards = new RecordTable<ServiceCardRecord>((q) => this.sql(q), "service_cards");
  putServiceCard = async (c: ServiceCardRecord): Promise<void> => this.cards.put(c);
  getServiceCard = async (id: string) => this.cards.get(id);
  listServiceCards = async () => this.cards.list();
  deleteServiceCard = async (id: string) => this.cards.delete(id);

  private readonly processes = new RecordTable<CurrentProcessRecord>(
    (q) => this.sql(q),
    "current_processes",
  );
  putCurrentProcess = async (p: CurrentProcessRecord): Promise<void> => this.processes.put(p);
  getCurrentProcess = async (scenarioId: string) => this.processes.get(scenarioId);

  /** The audit log (ADR-0193). A port of its own: whoever holds only the `ExperimentStore` cannot write it. */
  readonly audit = new AuditTables(
    (q) => this.sql(q),
    (q) => this.db.exec(q),
  );

  private readonly community = new CommunityTables((q) => this.sql(q));
  putLike = async (like: WorldLike): Promise<void> => this.community.putLike(like);
  deleteLike = async (worldId: string, user: string) => this.community.deleteLike(worldId, user);
  listLikes = async () => this.community.listLikes();
  putCalibrationMark = async (m: CalibrationMark): Promise<void> =>
    this.community.putCalibrationMark(m);
  listCalibrationMarks = async () => this.community.listCalibrationMarks();
  listTitleAwards = async () => this.community.listTitleAwards();
  putTitleAwards = async (awards: readonly TitleAward[]): Promise<void> =>
    this.community.putTitleAwards(awards);
}
