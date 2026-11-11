/**
 * What each route does, as one table keyed by the contract's route names. A handler gets the parsed
 * input and the viewer and returns the response body; the app takes care of HTTP.
 */
import { toJsonl } from "@terrarium/core/analysis";
import type { ParsedBodyOf, ParsedQueryOf, Responses, RouteName } from "@terrarium/core/contract";
import type { PresetKind } from "@terrarium/core/experiments";
import { NotFoundError } from "@terrarium/core/kernel";
import { describeSlots } from "@terrarium/core/physics/slots";
import type { Platform, ReportFormat, Viewer } from "../runtime";

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
  listConnections: (p) => p.connections.views(),
  tryConnection: (p, i) => p.connections.talk(i.viewer, id(i), i.body),
  checkConnection: (p, i) => p.connections.check(i.viewer, i.body, i.baseUrl),
  createConnection: (p, i) => p.connections.create(i.viewer, i.body),
  updateConnection: (p, i) => p.connections.update(i.viewer, id(i), i.body),
  keepConnection: (p, i) => p.connections.keep(i.viewer, id(i)),
  recheckConnection: (p, i) => p.connections.recheck(i.viewer, id(i)),
  deleteConnection: (p, i) => p.connections.remove(i.viewer, id(i)),
  listAgentVersions: (p, i) => p.agentVersions.history(id(i), agentId(i)),
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

  listModels: (p) => p.models.list(),
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
  experimentProcess: (p, i) => p.processes.compare(id(i)),
  worldOntology: (p, i) => p.processes.ontology(id(i), i.query),

  listWorlds: (p, i) => p.board.list(i.viewer, i.query.sort),
  likeWorld: (p, i) => p.board.like(i.viewer, id(i)),
  unlikeWorld: (p, i) => p.board.unlike(i.viewer, id(i)),
  userTitles: async (p, i) => ({ user: id(i), titles: await p.titles.of(id(i)) }),
  getWorld: (p, i) => p.worlds.get(id(i)),
  listWorldTemplates: (p) => p.worlds.templates(),
  createWorld: (p, i) => p.worlds.create(i.viewer, i.body),
  generateWorld: (p, i) => p.worlds.generate(i.viewer, i.body),
  importWorld: (p, i) => p.worlds.import(i.viewer, i.body),
  updateWorld: (p, i) => p.worlds.update(i.viewer, id(i), i.body),
  deleteWorld: (p, i) => p.worlds.delete(i.viewer, id(i)),
  listPhysicsSlots: async () => describeSlots(),
  getWorldPhysics: (p, i) => p.worlds.physics(id(i)),
  putWorldPhysics: (p, i) => p.worlds.setPhysics(i.viewer, id(i), i.body),

  listScenarios: (p, i) => p.scenarios.list(i.query.worldId),
  getScenario: (p, i) => p.scenarios.get(id(i)),
  createScenario: (p, i) => p.scenarios.create(i.viewer, i.body),
  updateScenario: (p, i) => p.scenarios.update(i.viewer, id(i), i.body),
  deleteScenario: (p, i) => p.scenarios.delete(i.viewer, id(i)),
  dryRunScenario: (p, i) => p.scenarios.dryRun(id(i), i.body.seed),
  calibrateScenario: (p, i) => p.scenarios.calibrate(i.viewer, id(i), i.body.seed),

  listExperiments: (p, i) => p.experiments.list(i.query),
  getExperiment: (p, i) => p.experiments.view(i.viewer, id(i)),
  createExperiment: (p, i) => p.experiments.create(i.viewer, i.body),
  cancelExperiment: (p, i) => p.experiments.cancel(i.viewer, id(i)),
  forkExperiment: (p, i) => p.experiments.fork(i.viewer, id(i), i.body),
  addRuns: (p, i) => p.experiments.addRuns(i.viewer, id(i), i.body),
  experimentReport: (p, i) =>
    p.results.report(id(i), i.query.format as ReportFormat, `${i.baseUrl}/experiments/${id(i)}`),
  experimentDiagnoses: (p, i) => p.results.diagnoses(id(i)),
  createShare: (p, i) => p.results.createShare(i.viewer, id(i), i.body, i.baseUrl),
  deleteShare: (p, i) => p.results.deleteShare(i.viewer, i.params.token as string),

  getRun: (p, i) => p.results.run(id(i)),
  runbookDraft: (p, i) => p.scenarios.runbookDraft(id(i)),
  listEscalations: async (p) => p.escalations.list(),
  answerEscalation: async (p, i) => {
    const card = await p.escalations.answer(i.viewer, id(i), i.body);
    return card ? { card } : {};
  },
  runEvents: (p, i) => p.results.runEvents(id(i), i.query),
  runWorld: (p, i) => p.results.runWorld(id(i)),
  runTelemetry: (p, i) => p.results.telemetry(id(i)),

  leaderboards: (p, i) => p.results.leaderboards(i.query),

  twinDiagnoses: async (p, i) => toJsonl(await p.results.twinRecords(i.query)),
  twinBrief: (p, i) => p.results.twinBrief(i.query),

  sharedReport: (p, i) =>
    p.results.shared(
      i.params.token as string,
      i.query.format as ReportFormat,
      `${i.baseUrl}/r/${i.params.token}`,
    ),
};
