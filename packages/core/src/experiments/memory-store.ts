/** An ExperimentStore in memory, for tests and for running without a database. Values are copied in and out. */
import type { Blueprint, EntityKind } from "@terrarium/core/world";
import type { AgentHistory } from "./agent-version";
import type { CalibrationMark, TitleAward, WorldLike } from "./community";
import type { Journal, JournalEntry } from "./journal";
import type { LlmModelRecord } from "./llm-models";
import type { Experiment, RunRecord, ScenarioRecord, WorldRecord } from "./model";
import type {
  ConnectionRecord,
  ExperimentFilter,
  ExperimentStore,
  ShareRecord,
  WorldSummary,
} from "./ports";
import type { PresetKind, PresetRecord } from "./presets";
import type { ServiceCardRecord } from "./service-cards";

const copy = <T>(value: T): T => structuredClone(value);

function countKinds(bp: Blueprint): Partial<Record<EntityKind, number>> {
  const out: Partial<Record<EntityKind, number>> = {};
  for (const e of bp.entities) out[e.kind] = (out[e.kind] ?? 0) + 1;
  return out;
}

/** Every word of `text` appears in the experiment's name or note. */
export function matchesText(
  e: Pick<Experiment, "name" | "note">,
  text: string | undefined,
): boolean {
  if (text === undefined) return true;
  const hay = `${e.name}\n${e.note ?? ""}`.toLowerCase();
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

/** The experiment, or the connection it ran on, carries `name=value` (or just `name`) as metadata. */
export function matchesMetadata(
  e: Pick<Experiment, "metadata" | "subject">,
  meta: string | undefined,
): boolean {
  if (meta === undefined) return true;
  const at = meta.indexOf("=");
  const key = (at < 0 ? meta : meta.slice(0, at)).trim();
  const value = at < 0 ? undefined : meta.slice(at + 1).trim();
  return [e.metadata, e.subject?.harness.metadata].some(
    (m) => m !== undefined && key in m && (value === undefined || m[key] === value),
  );
}

function matches(e: Experiment, f: ExperimentFilter): boolean {
  return (
    matchesText(e, f.text) &&
    matchesMetadata(e, f.meta) &&
    (f.owner === undefined || e.owner === f.owner) &&
    (f.benchmarkKey === undefined || e.benchmarkKey === f.benchmarkKey) &&
    (f.parentId === undefined || e.parentId === f.parentId) &&
    (f.worldId === undefined || e.recipe.worldId === f.worldId) &&
    (f.scenarioId === undefined || e.recipe.scenarioId === f.scenarioId)
  );
}

export class MemoryStore implements ExperimentStore {
  private readonly worlds = new Map<string, WorldRecord>();
  private readonly worldVersions = new Map<string, Blueprint>();
  private readonly scenarios = new Map<string, ScenarioRecord>();
  private readonly scenarioVersions = new Map<string, ScenarioRecord["doc"]>();
  private readonly experiments = new Map<string, Experiment>();
  private readonly runs = new Map<string, RunRecord>();
  private readonly shares = new Map<string, ShareRecord>();
  private readonly connections = new Map<string, ConnectionRecord>();
  private readonly histories = new Map<string, AgentHistory>();
  private readonly journals = new Map<string, { entries: JournalEntry[]; lastAt?: string }>();
  private readonly presets = new Map<string, PresetRecord>();
  private readonly models = new Map<string, LlmModelRecord>();
  private readonly serviceCards = new Map<string, ServiceCardRecord>();
  private readonly likes = new Map<string, WorldLike>();
  private readonly marks = new Map<string, CalibrationMark>();
  private readonly awards = new Map<string, TitleAward>();

  async putWorld(world: WorldRecord): Promise<void> {
    this.worlds.set(world.id, copy(world));
    this.worldVersions.set(`${world.id}@${world.digest}`, copy(world.blueprint));
  }

  async getWorld(id: string): Promise<WorldRecord | undefined> {
    const w = this.worlds.get(id);
    return w && copy(w);
  }

  async listWorlds(): Promise<WorldSummary[]> {
    return [...this.worlds.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ blueprint, ...rest }) => ({ ...copy(rest), counts: countKinds(blueprint) }));
  }

  async worldVersion(id: string, digest: string): Promise<Blueprint | undefined> {
    const v = this.worldVersions.get(`${id}@${digest}`);
    return v && copy(v);
  }

  async deleteWorld(id: string): Promise<boolean> {
    return this.worlds.delete(id);
  }

  async putScenario(scenario: ScenarioRecord): Promise<void> {
    this.scenarios.set(scenario.id, copy(scenario));
    this.scenarioVersions.set(`${scenario.id}@${scenario.digest}`, copy(scenario.doc));
  }

  async getScenario(id: string): Promise<ScenarioRecord | undefined> {
    const s = this.scenarios.get(id);
    return s && copy(s);
  }

  async listScenarios(worldId?: string): Promise<ScenarioRecord[]> {
    return [...this.scenarios.values()]
      .filter((s) => worldId === undefined || s.worldId === worldId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(copy);
  }

  async scenarioVersion(id: string, digest: string): Promise<ScenarioRecord["doc"] | undefined> {
    const v = this.scenarioVersions.get(`${id}@${digest}`);
    return v && copy(v);
  }

  async deleteScenario(id: string): Promise<boolean> {
    return this.scenarios.delete(id);
  }

  async putExperiment(experiment: Experiment): Promise<void> {
    this.experiments.set(experiment.id, copy(experiment));
  }

  async getExperiment(id: string): Promise<Experiment | undefined> {
    const e = this.experiments.get(id);
    return e && copy(e);
  }

  async listExperiments(filter: ExperimentFilter = {}): Promise<Experiment[]> {
    const found = [...this.experiments.values()]
      .filter((e) => matches(e, filter))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return found.slice(0, filter.limit ?? found.length).map(copy);
  }

  async putRun(run: RunRecord): Promise<void> {
    this.runs.set(run.id, copy(run));
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    const r = this.runs.get(id);
    return r && copy(r);
  }

  async listRuns(experimentId: string): Promise<RunRecord[]> {
    return [...this.runs.values()]
      .filter((r) => r.experimentId === experimentId)
      .sort((a, b) => a.index - b.index)
      .map(copy);
  }

  async listActiveRuns(): Promise<RunRecord[]> {
    return [...this.runs.values()]
      .filter((r) => r.status === "queued" || r.status === "running")
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt) || a.index - b.index)
      .map(copy);
  }

  async putShare(share: ShareRecord): Promise<void> {
    this.shares.set(share.token, copy(share));
  }

  async getShare(token: string): Promise<ShareRecord | undefined> {
    const s = this.shares.get(token);
    return s && copy(s);
  }

  async deleteShare(token: string): Promise<boolean> {
    return this.shares.delete(token);
  }

  async putConnection(connection: ConnectionRecord): Promise<void> {
    this.connections.set(connection.id, copy(connection));
  }

  async listConnections(): Promise<ConnectionRecord[]> {
    return [...this.connections.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(copy);
  }

  async deleteConnection(id: string): Promise<boolean> {
    return this.connections.delete(id);
  }

  async getAgentHistory(harnessId: string, agentId: string): Promise<AgentHistory | undefined> {
    const h = this.histories.get(JSON.stringify([harnessId, agentId]));
    return h && copy(h);
  }

  async putAgentHistory(history: AgentHistory): Promise<void> {
    this.histories.set(JSON.stringify([history.harnessId, history.agentId]), copy(history));
  }

  async listAgentHistories(harnessId: string): Promise<AgentHistory[]> {
    return [...this.histories.values()]
      .filter((h) => h.harnessId === harnessId)
      .sort((a, b) => a.agentId.localeCompare(b.agentId))
      .map(copy);
  }

  async deleteAgentHistories(harnessId: string): Promise<number> {
    let removed = 0;
    for (const [key, h] of this.histories)
      if (h.harnessId === harnessId) {
        this.histories.delete(key);
        removed++;
      }
    return removed;
  }
  async appendJournal(runId: string, entries: readonly JournalEntry[], at: string): Promise<void> {
    const j = this.journals.get(runId) ?? { entries: [] };
    j.entries.push(...copy(entries));
    j.lastAt = at;
    this.journals.set(runId, j);
  }

  async readJournal(runId: string): Promise<Journal> {
    const j = this.journals.get(runId);
    return j
      ? { entries: j.entries.slice(), ...(j.lastAt ? { lastAt: j.lastAt } : {}) }
      : { entries: [] };
  }

  async deleteJournal(runId: string): Promise<void> {
    this.journals.delete(runId);
  }

  async putPreset(preset: PresetRecord): Promise<void> {
    this.presets.set(preset.id, copy(preset));
  }

  async getPreset(id: string): Promise<PresetRecord | undefined> {
    const p = this.presets.get(id);
    return p && copy(p);
  }

  async listPresets(owner: string, kind?: PresetKind): Promise<PresetRecord[]> {
    return [...this.presets.values()]
      .filter((p) => p.owner === owner && (kind === undefined || p.kind === kind))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(copy);
  }

  async deletePreset(id: string): Promise<boolean> {
    return this.presets.delete(id);
  }

  async putModel(model: LlmModelRecord): Promise<void> {
    this.models.set(model.id, copy(model));
  }

  async getModel(id: string): Promise<LlmModelRecord | undefined> {
    const m = this.models.get(id);
    return m && copy(m);
  }

  async listModels(): Promise<LlmModelRecord[]> {
    return [...this.models.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(copy);
  }

  async deleteModel(id: string): Promise<boolean> {
    return this.models.delete(id);
  }

  async putServiceCard(card: ServiceCardRecord): Promise<void> {
    this.serviceCards.set(card.id, copy(card));
  }

  async getServiceCard(id: string): Promise<ServiceCardRecord | undefined> {
    const c = this.serviceCards.get(id);
    return c && copy(c);
  }

  async listServiceCards(): Promise<ServiceCardRecord[]> {
    return [...this.serviceCards.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(copy);
  }

  async deleteServiceCard(id: string): Promise<boolean> {
    return this.serviceCards.delete(id);
  }

  async putLike(like: WorldLike): Promise<void> {
    const key = `${like.worldId}\u0000${like.user}`;
    if (!this.likes.has(key)) this.likes.set(key, copy(like));
  }

  async deleteLike(worldId: string, user: string): Promise<boolean> {
    return this.likes.delete(`${worldId}\u0000${user}`);
  }

  async listLikes(): Promise<WorldLike[]> {
    return [...this.likes.values()].map(copy);
  }

  async putCalibrationMark(mark: CalibrationMark): Promise<void> {
    this.marks.set(`${mark.scenarioId}\u0000${mark.digest}`, copy(mark));
  }

  async listCalibrationMarks(): Promise<CalibrationMark[]> {
    return [...this.marks.values()].map(copy);
  }

  async listTitleAwards(): Promise<TitleAward[]> {
    return [...this.awards.values()].sort((a, b) => a.earnedAt.localeCompare(b.earnedAt)).map(copy);
  }

  async putTitleAwards(awards: readonly TitleAward[]): Promise<void> {
    for (const a of awards) {
      const key = `${a.user}\u0000${a.key}`;
      if (!this.awards.has(key)) this.awards.set(key, copy(a));
    }
  }
}
