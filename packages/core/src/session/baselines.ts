/**
 * Reference agents that tell whether a scenario can tell a good agent from a bad one (REQ-070, ADR-0067).
 * Before spending model calls on a scenario, run three agents that need no model:
 *
 *   idle     does nothing and lets the clock run out
 *   guess    answers at once with a diagnosis that names nothing real
 *   knows    answers at once with the right diagnosis, and takes no action
 *
 * A scenario where `idle` or `guess` already scores well rewards doing nothing; one where `knows` scores full
 * marks asks for no action, so it measures diagnosis and not operation. Both are worth knowing before a
 * leaderboard is built on the scenario. `calibrate` says so in plain words.
 */
import { type Expectation, requiredTools, type ScenarioDoc } from "@terrarium/core/scenario";
import { DEFAULT_TOOLSET, TOOL_NAMES } from "@terrarium/core/tools";
import { type CommonReach, commonReach, type RecoveryPath, recoveryPath } from "./probes";
import { Session, type SessionConfig } from "./session";
import { type ShellReach, shellReach } from "./shell-reach";
import { type ToolPickCheck, toolPickCheck } from "./tool-pick";

export type BaselineId = "idle" | "guess" | "knows";

export interface BaselineRun {
  readonly id: BaselineId;
  readonly label: string;
  readonly what: string;
  readonly total: number | null;
  readonly passed: boolean;
}

export interface Calibration {
  readonly runs: readonly BaselineRun[];
  /** The best score an agent gets without knowing anything (idle or guess). */
  readonly floor: number;
  /** What an agent that knows the answer but takes no action gets. */
  readonly diagnosisOnly: number;
  /** In plain Korean: what to fix, or nothing when the scenario tells agents apart. */
  readonly warnings: readonly string[];
  /** Whether a service can be moved to get it back without fixing the machine (a scenario about services only). */
  readonly recoveryPath?: RecoveryPath;
  /** Whether the tools a real operations team has are enough to get to the equipment the answer names. */
  readonly commonReach?: CommonReach;
  /** Which tool a reference agent reaches for in each situation, and which pairs it cannot tell apart (ADR-0087 item 3). */
  readonly toolPick?: ToolPickCheck;
  /** Whether the common shell commands (journalctl, ps, df, cat) on the host show the cause of an operating-system fault (ADR-0117 item 7). */
  readonly shellReach?: ShellReach;
}

/** Without knowing anything, more than this many points means the scenario rewards doing nothing. */
export const FLOOR_LIMIT = 10;

const LABELS: Readonly<Record<BaselineId, { label: string; what: string }>> = {
  idle: { label: "아무것도 안 함", what: "툴을 쓰지 않고 제한 시간이 끝날 때까지 기다려요" },
  guess: { label: "찍기", what: "바로 아무 장비나 아무 원인으로 찍어서 답해요" },
  knows: {
    label: "정답만 앎",
    what: "바로 정답을 제출하고 아무 조치도 하지 않아요 (정답을 미리 아는 기준 에이전트)",
  },
};

type Config = Omit<SessionConfig, "tools" | "seed"> & { readonly seed?: number };
type Diagnosis = Extract<Expectation, { kind: "diagnosis" }>;

/** The diagnosis the scenario's sheet expects, if it asks for one. */
const diagnosisOf = (scenario: ScenarioDoc): Diagnosis | undefined =>
  scenario.expectations.find((e): e is Diagnosis => e.kind === "diagnosis");

export const BASELINE_SUMMARY = "기준 에이전트의 답이에요";

/** What the guessing agent says: a device that does not exist and a fault that fits nothing. */
export const GUESS = { rootCause: "존재하지 않는 장비", faultType: "disk_failure" } as const;

/** What the agent that knows says: the first accepted root cause and fault type of the sheet. */
export function knownAnswer(
  scenario: ScenarioDoc,
): { rootCause: string; faultType: string } | undefined {
  const right = diagnosisOf(scenario);
  return right
    ? { rootCause: right.rootCause[0] ?? "", faultType: right.faultType[0] ?? "" }
    : undefined;
}

/** An agent that never answers waits in long steps; the time limit ends the run (a wait cannot pass it). */
export const IDLE_WAIT_SECONDS = 3600;
export const IDLE_ROUNDS = 100;

function open(config: Config): Session {
  const session = Session.create({ ...config, tools: TOOL_NAMES, seed: config.seed ?? 1 });
  session.start();
  return session;
}

/** Let the clock run out the way an agent that never answers would: one long wait after another. */
function idle(config: Config): Session {
  const session = open(config);
  for (let i = 0; i < IDLE_ROUNDS && session.status === "running"; i++)
    session.call("wait", { seconds: IDLE_WAIT_SECONDS });
  return session;
}

function answer(config: Config, said: { rootCause: string; faultType: string }): Session {
  const session = open(config);
  session.call("submit_diagnosis", { ...said, summary: BASELINE_SUMMARY });
  return session;
}

/** Run the three reference agents on one scenario in one world, and say what the scores mean. */
export function calibrate(config: Config): Calibration {
  const right = knownAnswer(config.scenario);
  const sessions: Array<[BaselineId, Session | undefined]> = [
    ["idle", idle(config)],
    ["guess", answer(config, GUESS)],
    ["knows", right ? answer(config, right) : undefined],
  ];
  const runs = sessions.flatMap(([id, session]): BaselineRun[] => {
    if (!session) return [];
    const { score } = session.finish();
    return [baselineRun(id, score.total, score.passed)];
  });
  return withProbes(judge(runs, right !== undefined), config);
}

/** The two questions about services and tools (probes.ts), answered and added to the warnings where they are bad. */
export function withProbes(calibration: Calibration, config: Config): Calibration {
  const path = recoveryPath(config);
  const reach = commonReach(config);
  const pick = toolPickCheck([...new Set([...DEFAULT_TOOLSET, ...requiredTools(config.scenario)])]);
  const shell = shellReach(config);
  const warnings = [
    ...calibration.warnings,
    ...pick.warnings,
    ...(path.ok ? [] : [`서비스를 옮겨서 복구하는 길이 없어요. ${path.note}`]),
    ...(reach && !reach.reached ? [NO_COMMON_PATH] : []),
    ...(shell && !shell.reached ? [NO_COMMON_COMMANDS] : []),
  ];
  return {
    ...calibration,
    warnings,
    recoveryPath: path,
    toolPick: pick,
    ...(reach ? { commonReach: reach } : {}),
    ...(shell ? { shellReach: shell } : {}),
  };
}

/** What a card and a result say about a scenario whose answer the common tools never reach (ADR-0091 item 4). */
export const NO_COMMON_PATH = "흔한 툴만으로는 원인에 닿을 수 없어요";

/** What a card says about an operating-system fault whose cause the common shell commands never show (ADR-0117 item 7). */
export const NO_COMMON_COMMANDS =
  "흔한 명령(journalctl·ps·df·cat)만으로는 호스트 안에서 원인에 닿을 수 없어요";

export const baselineRun = (
  id: BaselineId,
  total: number | null,
  passed: boolean,
): BaselineRun => ({
  id,
  ...LABELS[id],
  total,
  passed,
});

/** Turn the three scores into what they mean. `hasAnswer` is whether the sheet asks for a diagnosis at all. */
export function judge(runs: readonly BaselineRun[], hasAnswer: boolean): Calibration {
  const total = (id: BaselineId) => runs.find((r) => r.id === id)?.total ?? 0;
  const floor = Math.max(total("idle"), total("guess"));
  const diagnosisOnly = total("knows");
  return {
    runs,
    floor,
    diagnosisOnly,
    warnings: warningsOf(runs, floor, diagnosisOnly, hasAnswer),
  };
}

function warningsOf(
  runs: readonly BaselineRun[],
  floor: number,
  diagnosisOnly: number,
  hasAnswer: boolean,
): string[] {
  const out: string[] = [];
  const idle = runs.find((r) => r.id === "idle");
  const guess = runs.find((r) => r.id === "guess");
  if (!hasAnswer) return ["진단 채점 항목이 없어서 정답만 아는 기준 에이전트를 돌리지 못했어요"];
  if ((idle?.total ?? 0) > FLOOR_LIMIT)
    out.push(`아무것도 안 해도 ${idle?.total}점을 받아요. 가만히 있어도 얻는 점수를 줄여 보세요`);
  if ((guess?.total ?? 0) > FLOOR_LIMIT)
    out.push(`아무 답이나 찍어도 ${guess?.total}점을 받아요. 정답이 아니면 점수가 없게 해 보세요`);
  if (idle?.passed || guess?.passed) out.push("아무것도 모르는 에이전트가 합격해요");
  if (diagnosisOnly >= 100)
    out.push(
      "정답만 말하면 만점이에요. 조치를 평가하지 않으니 진단 능력만 재고, 운영 능력은 못 재요",
    );
  if (diagnosisOnly <= floor + 10)
    out.push(`정답을 알아도 ${diagnosisOnly}점뿐이라 모르는 쪽(${floor}점)과 차이가 작아요`);
  return out;
}
