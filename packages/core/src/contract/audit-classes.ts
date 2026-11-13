/**
 * What the audit log records for each route (ADR-0193, permissions.md section 6). The table is keyed by every route of the
 * contract and typed to need all of them: a route added without a line here does not compile, and a test says so too.
 *
 * - `change`: a call that succeeds always writes one `allowed` entry (every route that changes something, and the
 *   reading of the audit log itself). One that fails closed when it cannot be written, if it is not a plain read.
 * - `read-override`: a read; written only when an administrator reads what another person keeps for themselves
 *   ("나만", or "우리 파트" of a group they are not in). The maker's own reads, and anyone's reads of what is for everyone, are not.
 * - `none`: nothing is written when the call succeeds; the reason says why. A refusal on any route is written all the same.
 *
 * `id` says where the id of the thing comes from: the address (`param`), the answer (`response`) or what the server found when
 * it looked the thing up (`note`). A route never names an id that nobody checked: a refusal before the lookup has none.
 */
import type { AuditAction } from "@terrarium/core/experiments";
import type { RouteName } from "./routes";

export type IdSource = "param" | "response" | "note";

export interface Recorded {
  readonly records: "change" | "read-override";
  readonly action: AuditAction;
  /** The kind of thing (a word of the registry of resource kinds). */
  readonly resource: string;
  readonly id?: IdSource;
  /** A list: one entry says how many of another person's private things it held. */
  readonly list?: true;
}

export interface Unrecorded {
  readonly records: "none";
  readonly reason: string;
  /** What a refusal is called, when a decision about a record can refuse this route. */
  readonly action?: AuditAction;
  readonly resource?: string;
  readonly id?: IdSource;
}

export type RouteAudit = Recorded | Unrecorded;

const change = (action: AuditAction, resource: string, id?: IdSource): RouteAudit => ({
  records: "change",
  action,
  resource,
  ...(id ? { id } : {}),
});
const reads = (action: AuditAction, resource: string, id?: IdSource): RouteAudit => ({
  records: "read-override",
  action,
  resource,
  ...(id ? { id } : {}),
});
const lists = (action: AuditAction, resource: string): RouteAudit => ({
  records: "read-override",
  action,
  resource,
  list: true,
});
const none = (reason: string, action?: AuditAction, resource?: string): RouteAudit => ({
  records: "none",
  reason,
  ...(action ? { action } : {}),
  ...(resource ? { resource } : {}),
});

const PLAIN = "목록이 늘 같고 누구의 것도 아니에요";
const OWN_ONLY = "만든 사람 자신의 것만 보여요";

export const AUDIT_CLASSES = {
  meta: none("누구인지 알려 줄 뿐이에요"),
  listConnectors: none(PLAIN),
  listTelemetryAdapters: none(PLAIN),
  listConnections: lists("connection.read", "connection"),
  checkConnection: none("저장하지 않고 연결해 볼 뿐이에요"),
  createConnection: change("connection.create", "connection", "response"),
  updateConnection: change("connection.update", "connection", "param"),
  tryConnection: change("connection.try", "connection", "param"),
  keepConnection: change("connection.keep", "connection", "param"),
  recheckConnection: change("connection.check", "connection", "param"),
  deleteConnection: change("connection.delete", "connection", "param"),
  listAgentVersions: reads("connection.read", "connection", "param"),
  addAgentVersion: change("connection.agent_version_add", "connection", "param"),
  editAgentVersion: change("connection.agent_version_update", "connection", "param"),
  deleteAgentVersion: change("connection.agent_version_delete", "connection", "param"),
  setConnectionScope: change("scope.change", "connection", "param"),

  listPresets: none(OWN_ONLY),
  savePreset: change("preset.save", "preset", "response"),
  importPresets: change("preset.import", "preset"),
  renamePreset: change("preset.rename", "preset", "param"),
  deletePreset: change("preset.delete", "preset", "param"),
  restorePreset: change("preset.restore", "preset", "param"),

  listModels: lists("model.read", "model"),
  createModel: change("model.create", "model", "response"),
  updateModel: change("model.update", "model", "param"),
  deleteModel: change("model.delete", "model", "param"),
  checkModel: change("model.check", "model", "param"),
  setDefaultModel: change("model.set_default", "model", "param"),
  setModelScope: change("scope.change", "model", "param"),
  askMoss: none("질문에 답할 뿐 아무것도 바꾸지 않아요"),

  listPhysicsSlots: none(PLAIN),
  getWorldPhysics: reads("world.read", "world", "param"),
  putWorldPhysics: change("world.physics_update", "world", "param"),
  listWorlds: lists("world.read", "world"),
  likeWorld: change("world.like", "world", "param"),
  unlikeWorld: change("world.unlike", "world", "param"),
  userTitles: none("칭호는 모두에게 보이는 것만 세어 줘요"),
  listWorldTemplates: lists("world.read", "world"),
  getWorld: reads("world.read", "world", "param"),
  createWorld: change("world.create", "world", "response"),
  generateWorld: change("world.generate", "world", "response"),
  updateWorld: change("world.update", "world", "param"),
  deleteWorld: change("world.delete", "world", "param"),
  setWorldScope: change("scope.change", "world", "param"),
  worldOntology: reads("world.read", "world", "param"),
  worldActivity: reads("world.read", "world", "param"),

  listServiceCards: none("내 것과 공유된 것만 보여요"),
  createServiceCard: change("service_card.create", "service_card", "response"),
  updateServiceCard: change("service_card.update", "service_card", "param"),
  copyServiceCard: change("service_card.copy", "service_card", "response"),
  deleteServiceCard: change("service_card.delete", "service_card", "param"),

  listScenarios: lists("scenario.read", "scenario"),
  getScenario: reads("scenario.read", "scenario", "param"),
  createScenario: change("scenario.create", "scenario", "response"),
  updateScenario: change("scenario.update", "scenario", "param"),
  deleteScenario: change("scenario.delete", "scenario", "param"),
  setScenarioScope: change("scope.change", "scenario", "param"),
  dryRunScenario: none("저장하지 않고 미리 볼 뿐이에요", "scenario.read", "scenario"),
  calibrateScenario: change("scenario.calibrate", "scenario", "param"),
  runbookDraft: reads("scenario.read", "scenario", "param"),
  getCurrentProcess: reads("scenario.read", "scenario", "param"),
  putCurrentProcess: change("scenario.process_update", "scenario", "param"),

  listExperiments: lists("experiment.read", "experiment"),
  getExperiment: reads("experiment.read", "experiment", "param"),
  createExperiment: change("experiment.start", "experiment", "response"),
  quickExperiment: change("experiment.start", "experiment", "response"),
  forkExperiment: change("experiment.fork", "experiment", "response"),
  addRuns: change("experiment.add_runs", "experiment", "param"),
  cancelExperiment: change("experiment.cancel", "experiment", "param"),
  setExperimentScope: change("scope.change", "experiment", "param"),
  experimentProcess: reads("experiment.read", "experiment", "param"),
  experimentEvents: reads("experiment.read", "experiment", "param"),
  experimentReport: reads("experiment.read", "experiment", "param"),
  experimentDiagnoses: reads("experiment.read", "experiment", "param"),
  createShare: change("share.create", "experiment", "param"),
  listShares: reads("share.list", "experiment", "param"),
  deleteShare: change("share.revoke", "experiment", "note"),

  getRun: reads("run.read", "run", "param"),
  runEvents: reads("run.read", "run", "param"),
  runWorld: reads("run.read", "run", "param"),
  runTelemetry: reads("run.read", "run", "param"),
  listEscalations: none("카드는 실험의 범위로 걸러 줘요. 관리자가 본 수는 세지 않아요"),
  answerEscalation: change("run.escalation_answer", "run", "param"),

  leaderboards: none("범위가 모두인 실험만 세요"),
  twinDiagnoses: none("여러 실험을 합쳐 읽는 길이라 한 사람의 것을 따로 가릴 수 없어요"),
  twinBrief: none("여러 실험을 합쳐 읽는 길이라 한 사람의 것을 따로 가릴 수 없어요"),

  listAudit: change("audit.read", "audit"),
  exportAudit: change("audit.export", "audit"),
  listAuditMine: change("audit.read_own", "audit"),

  sharedReport: none("주소 안의 토큰이 지키는 공개 길이에요"),
} as const satisfies Record<RouteName, RouteAudit>;

export const auditOf = (name: RouteName): RouteAudit => AUDIT_CLASSES[name];

/** A change that stops when its entry cannot be written: a route that writes and is not a plain read. */
export function failsClosed(name: RouteName, method: string): boolean {
  return AUDIT_CLASSES[name].records === "change" && method !== "GET";
}
