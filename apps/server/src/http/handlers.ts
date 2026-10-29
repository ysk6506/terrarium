/**
 * What each route does, as one table keyed by the contract's route names. A handler gets the parsed
 * input and the viewer and returns the response body; the app takes care of HTTP.
 */
import { toJsonl } from "@terrarium/core/analysis";
import type { ParsedBodyOf, ParsedQueryOf, Responses, RouteName } from "@terrarium/core/contract";
import type { Platform, ReportFormat, Viewer } from "../runtime";

export interface HandlerInput<N extends RouteName> {
  readonly params: Readonly<Record<string, string>>;
  readonly query: ParsedQueryOf<N>;
  readonly body: ParsedBodyOf<N>;
  readonly viewer: Viewer;
  /** How people reach this server (for share links). */
  readonly baseUrl: string;
}

export type Handler<N extends RouteName> = (
  platform: Platform,
  input: HandlerInput<N>,
) => Promise<Responses[N]>;

type Handlers = { readonly [N in Exclude<RouteName, "experimentEvents">]: Handler<N> };

const id = (input: { params: Readonly<Record<string, string>> }) => input.params.id as string;

export const HANDLERS: Handlers = {
  meta: (p, i) => p.meta(i.viewer),

  listWorlds: (p) => p.worlds.list(),
  getWorld: (p, i) => p.worlds.get(id(i)),
  createWorld: (p, i) => p.worlds.create(i.viewer, i.body),
  generateWorld: (p, i) => p.worlds.generate(i.viewer, i.body),
  importWorld: (p, i) => p.worlds.import(i.viewer, i.body),
  updateWorld: (p, i) => p.worlds.update(i.viewer, id(i), i.body),
  deleteWorld: (p, i) => p.worlds.delete(i.viewer, id(i)),

  listScenarios: (p, i) => p.scenarios.list(i.query.worldId),
  getScenario: (p, i) => p.scenarios.get(id(i)),
  createScenario: (p, i) => p.scenarios.create(i.viewer, i.body),
  updateScenario: (p, i) => p.scenarios.update(i.viewer, id(i), i.body),
  deleteScenario: (p, i) => p.scenarios.delete(i.viewer, id(i)),
  dryRunScenario: (p, i) => p.scenarios.dryRun(id(i), i.body.seed),

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
