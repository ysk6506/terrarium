/** An ExperimentStore in memory, for tests and for running without a database. Values are copied in and out. */
import type { Blueprint, EntityKind } from "@terrarium/core/world";
import type { Experiment, RunRecord, ScenarioRecord, WorldRecord } from "./model";
import type { ExperimentFilter, ExperimentStore, ShareRecord, WorldSummary } from "./ports";

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

function matches(e: Experiment, f: ExperimentFilter): boolean {
  return (
    matchesText(e, f.text) &&
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
}
