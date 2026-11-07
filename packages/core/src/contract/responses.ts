/** The JSON each route answers with (one line per route of the table in routes.ts). */

import type { ScenarioRecord, WorldRecord } from "@terrarium/core/experiments";
import type { LikeView, UserTitlesView, WorldCardView } from "./community";
import type {
  AgentHistoryView,
  ConnectionCheck,
  ConnectionView,
  ConnectorSpec,
  TelemetryAdapterList,
  TryResult,
} from "./connections";
import type { LlmModelView } from "./models";
import type { MossAnswerView } from "./moss";
import type { PresetListView, PresetView } from "./presets";
import type { QuickExperimentView, ServiceCardView } from "./service-cards";
import type {
  CalibrationView,
  DryRunView,
  EscalationAnswered,
  EscalationCard,
  ExperimentSummary,
  ExperimentView,
  GeneratedWorld,
  ImportedWorld,
  LeaderboardView,
  MetaView,
  RunbookDraftView,
  RunEventsView,
  RunView,
  RunWorldView,
  SavedScenario,
  SavedWorld,
  ShareView,
  TelemetryView,
  WorldSummary,
} from "./views";

/** JSON response of each route; document routes answer with text. */
export interface Responses {
  meta: MetaView;
  listConnectors: ConnectorSpec[];
  listTelemetryAdapters: TelemetryAdapterList;
  listConnections: ConnectionView[];
  tryConnection: TryResult;
  checkConnection: ConnectionCheck;
  createConnection: ConnectionView;
  updateConnection: ConnectionView;
  keepConnection: ConnectionView;
  recheckConnection: ConnectionView;
  deleteConnection: { readonly deleted: boolean };
  listAgentVersions: AgentHistoryView;
  addAgentVersion: AgentHistoryView;
  editAgentVersion: AgentHistoryView;
  deleteAgentVersion: AgentHistoryView;
  listPresets: PresetListView;
  savePreset: PresetView;
  importPresets: PresetListView;
  renamePreset: PresetView;
  deletePreset: { readonly deleted: boolean };
  restorePreset: PresetView;
  listModels: LlmModelView[];
  createModel: LlmModelView;
  updateModel: LlmModelView;
  deleteModel: { readonly deleted: boolean };
  checkModel: LlmModelView;
  setDefaultModel: LlmModelView;
  askMoss: MossAnswerView;
  listServiceCards: ServiceCardView[];
  createServiceCard: ServiceCardView;
  updateServiceCard: ServiceCardView;
  copyServiceCard: ServiceCardView;
  deleteServiceCard: { readonly deleted: boolean };
  quickExperiment: QuickExperimentView;
  listWorlds: WorldCardView[];
  likeWorld: LikeView;
  unlikeWorld: LikeView;
  userTitles: UserTitlesView;
  listWorldTemplates: WorldSummary[];
  getWorld: WorldRecord;
  createWorld: SavedWorld;
  generateWorld: GeneratedWorld;
  importWorld: ImportedWorld;
  updateWorld: SavedWorld;
  deleteWorld: { readonly deleted: boolean };
  listScenarios: ScenarioRecord[];
  getScenario: ScenarioRecord;
  createScenario: SavedScenario;
  updateScenario: SavedScenario;
  deleteScenario: { readonly deleted: boolean };
  dryRunScenario: DryRunView;
  calibrateScenario: CalibrationView;
  listExperiments: ExperimentSummary[];
  getExperiment: ExperimentView;
  createExperiment: ExperimentView;
  cancelExperiment: ExperimentView;
  forkExperiment: ExperimentView;
  addRuns: ExperimentView;
  experimentEvents: string;
  worldActivity: string;
  experimentReport: string;
  experimentDiagnoses: string;
  createShare: ShareView;
  deleteShare: { readonly deleted: boolean };
  getRun: RunView;
  runbookDraft: RunbookDraftView;
  listEscalations: EscalationCard[];
  answerEscalation: EscalationAnswered;
  runEvents: RunEventsView;
  runWorld: RunWorldView;
  runTelemetry: TelemetryView;
  leaderboards: LeaderboardView[];
  twinDiagnoses: string;
  twinBrief: string;
  sharedReport: string;
}
