/**
 * What each route does, as one table keyed by the contract's route names. A handler gets the parsed
 * input and the viewer and returns the response body; the app takes care of HTTP.
 */
import { toJsonl } from "@terrarium/core/analysis";
import type { ParsedBodyOf, ParsedQueryOf, Responses, RouteName } from "@terrarium/core/contract";
import type { PresetKind } from "@terrarium/core/experiments";
import { NotFoundError } from "@terrarium/core/kernel";
import { describeSlots } from "@terrarium/core/physics/slots";
import { type Platform, type ReportFormat, sightOf, type Viewer } from "../runtime";

export interface HandlerInput<N extends RouteName> {
  readonly params: Readonly<Record<string, string>>;
  readonly query: ParsedQueryOf<N>;
  readonly body: ParsedBodyOf<N>;
  readonly viewer: Viewer;
  /** How people reach this server (for share links). */
  readonly baseUrl: string;
  /** How people are told apart (shown on `meta`, so the screen can say when it is only a typed name). */
  readonly identityMode: "proxy" | "self-declared";
}

/** Routes that stay open and push events; app.ts answers them itself. */
export type StreamRoute = "experimentEvents" | "worldActivity";

export type Handler<N extends RouteName> = (
  platform: Platform,
  input: HandlerInput<N>,
) => Promise<Responses[N]>;

type Handlers = { readonly [N in Exclude<RouteName, StreamRoute>]: Handler<N> };

const id = (input: { params: Readonly<Record<string, string>> }) => input.params.id as string;
const agentId = (input: { params: Readonly<Record<string, string>> }) =>
  input.params.agentId as string;
/** A version number in the address; anything else is a version that does not exist. */
const versionNo = (input: { params: Readonly<Record<string, string>> }) => {
  const n = Number(input.params.n);
  if (!Number.isInteger(n) || n < 1) throw new NotFoundError("버전을 찾을 수 없어요");
  return n;
};

export const HANDLERS: Handlers = {
  meta: (p, i) => p.meta(i.viewer, i.identityMode),

  listConnectors: async (p) => p.connections.specs(),
  listTelemetryAdapters: async (p) => p.connections.telemetryAdapters(),
  listConnections: (p, i) => p.connections.views(i.viewer),
  tryConnection: (p, i) => p.connections.talk(i.viewer, id(i), i.body),
  checkConnection: (p, i) => p.connections.check(i.viewer, i.body, i.baseUrl),
  createConnection: (p, i) => p.connections.create(i.viewer, i.body),
  updateConnection: (p, i) => p.connections.update(i.viewer, id(i), i.body),
  keepConnection: (p, i) => p.connections.keep(i.viewer, id(i)),
  recheckConnection: (p, i) => p.connections.recheck(i.viewer, id(i)),
  deleteConnection: (p, i) => p.connections.remove(i.viewer, id(i)),
  listAgentVersions: (p, i) => p.agentVersions.history(i.viewer, id(i), agentId(i)),
  addAgentVersion: (p, i) => p.agentVersions.add(i.viewer, id(i), agentId(i), i.body),
  editAgentVersion: (p, i) =>
    p.agentVersions.edit(i.viewer, id(i), agentId(i), versionNo(i), i.body),
  deleteAgentVersion: (p, i) => p.agentVersions.remove(i.viewer, id(i), agentId(i), versionNo(i)),

  listPresets: (p, i) => p.presets.list(i.viewer, i.query.kind as PresetKind | undefined),
  savePreset: (p, i) => p.presets.save(i.viewer, i.body),
  importPresets: (p, i) => p.presets.import(i.viewer, i.body),
  renamePreset: (p, i) => p.presets.rename(i.viewer, id(i), i.body),
  deletePreset: (p, i) => p.presets.remove(i.viewer, id(i)),
  restorePreset: (p, i) => p.presets.restore(i.viewer, id(i)),

  listModels: (p, i) => p.models.list(i.viewer),
  createModel: (p, i) => p.models.create(i.viewer, i.body),
  updateModel: (p, i) => p.models.update(i.viewer, id(i), i.body),
  deleteModel: (p, i) => p.models.remove(i.viewer, id(i)),
  checkModel: (p, i) => p.models.check(i.viewer, id(i)),
  setDefaultModel: (p, i) => p.models.setDefault(i.viewer, id(i)),
  askMoss: (p, i) => p.moss.ask(i.body),
  listServiceCards: (p, i) => p.serviceCards.list(i.viewer),
  createServiceCard: (p, i) => p.serviceCards.create(i.viewer, i.body),
  updateServiceCard: (p, i) => p.serviceCards.update(i.viewer, id(i), i.body),
  copyServiceCard: (p, i) => p.serviceCards.copy(i.viewer, id(i), i.body),
  deleteServiceCard: (p, i) => p.serviceCards.remove(i.viewer, id(i)),
  quickExperiment: (p, i) => p.experiments.quick(i.viewer, id(i), i.body),
  getCurrentProcess: (p, i) => p.processes.get(i.viewer, id(i)),
  putCurrentProcess: (p, i) => p.processes.put(i.viewer, id(i), i.body),
  experimentProcess: (p, i) => p.processes.compare(i.viewer, id(i)),
  worldOntology: (p, i) => p.processes.ontology(i.viewer, id(i), i.query),

  listWorlds: (p, i) => p.board.list(i.viewer, i.query.sort),
  likeWorld: (p, i) => p.board.like(i.viewer, id(i)),
  unlikeWorld: (p, i) => p.board.unlike(i.viewer, id(i)),
  userTitles: async (p, i) => ({ user: id(i), titles: await p.titles.of(id(i)) }),
  getWorld: async (p, i) => p.worlds.seenBy(i.viewer, await p.gate.world(i.viewer, id(i))),
  listWorldTemplates: (p, i) => p.worlds.templates(i.viewer),
  createWorld: (p, i) => p.worlds.create(i.viewer, i.body),
  generateWorld: (p, i) => p.worlds.generate(i.viewer, i.body),
  importWorld: (p, i) => p.worlds.import(i.viewer, i.body),
  updateWorld: async (p, i) => {
    await p.gate.world(i.viewer, id(i));
    return p.worlds.update(i.viewer, id(i), i.body);
  },
  deleteWorld: async (p, i) => {
    await p.gate.world(i.viewer, id(i));
    return p.worlds.delete(i.viewer, id(i));
  },
  listPhysicsSlots: async () => describeSlots(),
  getWorldPhysics: async (p, i) => {
    await p.gate.world(i.viewer, id(i));
    return p.worlds.physics(id(i));
  },
  putWorldPhysics: async (p, i) => {
    await p.gate.world(i.viewer, id(i));
    return p.worlds.setPhysics(i.viewer, id(i), i.body);
  },

  listScenarios: async (p, i) =>
    (await p.scenarios.list(i.viewer, i.query.worldId)).map((s) => p.scenarios.seenBy(i.viewer, s)),
  getScenario: async (p, i) => p.scenarios.seenBy(i.viewer, await p.gate.scenario(i.viewer, id(i))),
  createScenario: (p, i) => p.scenarios.create(i.viewer, i.body),
  updateScenario: async (p, i) => {
    await p.gate.scenario(i.viewer, id(i));
    return p.scenarios.update(i.viewer, id(i), i.body);
  },
  deleteScenario: async (p, i) => {
    await p.gate.scenario(i.viewer, id(i));
    return p.scenarios.delete(i.viewer, id(i));
  },
  dryRunScenario: async (p, i) => {
    await p.gate.scenario(i.viewer, id(i));
    return p.scenarios.dryRun(id(i), i.body.seed);
  },
  calibrateScenario: async (p, i) => {
    await p.gate.scenario(i.viewer, id(i));
    return p.scenarios.calibrate(i.viewer, id(i), i.body.seed);
  },

  // Experiments are looked up through `gate` inside the service (view, cancel, fork, addRuns, setScope, listShares); the
  // routes below that hold only an id ask the gate here, so a missing and an unseen experiment answer alike.
  listExperiments: (p, i) => p.experiments.list(i.viewer, i.query),
  getExperiment: (p, i) => p.experiments.view(i.viewer, id(i)),
  createExperiment: (p, i) => p.experiments.create(i.viewer, i.body),
  cancelExperiment: (p, i) => p.experiments.cancel(i.viewer, id(i)),
  forkExperiment: (p, i) => p.experiments.fork(i.viewer, id(i), i.body),
  addRuns: (p, i) => p.experiments.addRuns(i.viewer, id(i), i.body),
  setExperimentScope: (p, i) => p.experiments.setScope(i.viewer, id(i), i.body),
  experimentReport: async (p, i) => {
    await p.gate.experiment(i.viewer, id(i));
    return p.results.report(
      id(i),
      i.query.format as ReportFormat,
      sightOf(i.viewer),
      `${i.baseUrl}/experiments/${id(i)}`,
    );
  },
  experimentDiagnoses: async (p, i) => {
    await p.gate.experiment(i.viewer, id(i));
    return p.results.diagnoses(id(i));
  },
  createShare: async (p, i) => {
    await p.gate.experiment(i.viewer, id(i));
    return p.results.createShare(i.viewer, id(i), i.body, i.baseUrl);
  },
  listShares: (p, i) => p.results.listShares(i.viewer, id(i), i.baseUrl),
  deleteShare: (p, i) => p.results.deleteShare(i.viewer, i.params.token as string),

  getRun: async (p, i) => {
    await p.gate.run(i.viewer, id(i));
    return p.results.run(id(i));
  },
  runbookDraft: async (p, i) => {
    await p.gate.scenario(i.viewer, id(i));
    return p.scenarios.runbookDraft(i.viewer, id(i));
  },
  listEscalations: async (p, i) => {
    const cards = p.escalations.list();
    const shown = await Promise.all(
      cards.map((c) => p.gate.canSeeExperiment(i.viewer, c.experimentId)),
    );
    return cards.filter((_, n) => shown[n]);
  },
  answerEscalation: async (p, i) => {
    await p.gate.run(i.viewer, id(i));
    const card = await p.escalations.answer(i.viewer, id(i), i.body);
    return card ? { card } : {};
  },
  runEvents: async (p, i) => {
    await p.gate.run(i.viewer, id(i));
    return p.results.runEvents(id(i), i.query);
  },
  runWorld: async (p, i) => {
    await p.gate.run(i.viewer, id(i));
    return p.results.runWorld(id(i));
  },
  runTelemetry: async (p, i) => {
    await p.gate.run(i.viewer, id(i));
    return p.results.telemetry(id(i));
  },

  leaderboards: (p, i) => p.results.leaderboards(i.query),

  twinDiagnoses: async (p, i) => toJsonl(await p.results.twinRecords(i.viewer, i.query)),
  twinBrief: (p, i) => p.results.twinBrief(i.viewer, i.query),

  sharedReport: (p, i) =>
    p.results.shared(
      i.params.token as string,
      i.query.format as ReportFormat,
      `${i.baseUrl}/r/${i.params.token}`,
    ),
};
