/**
 * Real runs for analysis tests: scripted agents play built-in scenarios on the sample world through
 * a Session, and the results are wrapped in experiment records the way the server would store them.
 */
import {
  applyRunEvent,
  benchmarkKey,
  type Experiment,
  type HarnessRunInfo,
  newRun,
  type Recipe,
  type RunRecord,
  type Snapshot,
} from "@terrarium/core/experiments";
import { SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { type RunResult, Session } from "@terrarium/core/session";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { BlueprintIndex, blueprintDigest } from "@terrarium/core/world";
import { sampleBlueprint } from "../../world/test-support/sample";

/** What a scripted agent does once it has the task. */
export type Script = (session: Session) => void;

export const SCRIPTS = {
  /** Looks at the alarms and the failed unit, then names it correctly. */
  good: (s: Session) => {
    s.call("list_alarms", { severity: "critical" });
    s.call("get_impact", { id: "crah-1" });
    s.call("submit_diagnosis", {
      rootCause: "crah-1",
      faultType: "cooling_unit_failure",
      summary: "CRAH-1이 멈춰 hall 온도가 오른다",
    });
  },
  /** Right unit, wrong kind of fault. */
  partial: (s: Session) => {
    s.call("list_alarms", {});
    s.call("submit_diagnosis", {
      rootCause: "crah-1",
      faultType: "breaker_trip",
      summary: "CRAH-1 전원 문제",
    });
  },
  /** Blames a server for overheating, and stumbles on a missing id on the way. */
  wrong: (s: Session) => {
    s.call("list_alarms", {});
    s.call("get_entity", { id: "srv-zz-9" });
    s.call("get_entity", { id: "srv-zz-10" });
    s.call("submit_diagnosis", {
      rootCause: "srv-a1",
      faultType: "fan_failure",
      summary: "<script>alert(1)</script> 팬 고장 | 확인 필요",
    });
  },
  /** Never answers. */
  silent: (s: Session) => {
    s.call("list_alarms", {});
  },
} satisfies Record<string, Script>;

export function play(script: Script, seed = 1, templateId = "cooling-failure"): RunResult {
  const template = SCENARIO_TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new Error(templateId);
  const blueprint = sampleBlueprint();
  const session = Session.create({
    blueprint,
    scenario: template.build(new BlueprintIndex(blueprint), "sample"),
    tools: DEFAULT_TOOLSET,
    seed,
  });
  session.start();
  script(session);
  return session.finish("agent_finished");
}

export interface ExperimentSpec {
  readonly id: string;
  readonly owner?: string;
  readonly createdAt?: string;
  readonly harnessId?: string;
  readonly agentId?: string;
  readonly tools?: readonly string[];
  readonly time?: Recipe["time"];
  readonly templateId?: string;
  readonly parentId?: string;
  /** One script per run; "fail" and "cancel" make runs that never finished. */
  readonly runs: readonly (Script | "fail" | "cancel")[];
  readonly harness?: HarnessRunInfo;
}

export function snapshotFor(templateId = "cooling-failure"): Snapshot {
  const result = play(SCRIPTS.silent, 1, templateId);
  return {
    worldDigest: blueprintDigest(sampleBlueprint()),
    worldName: "샘플 세계",
    scenarioDigest: result.digests.scenario,
    scenarioName: templateId,
    oracle: result.digests.oracle,
  };
}

const AT = "2026-10-29T00:00:00.000Z";

export function experimentOf(spec: ExperimentSpec, snapshot = snapshotFor(spec.templateId)) {
  const recipe: Recipe = {
    worldId: "w-sample",
    scenarioId: spec.templateId ?? "cooling-failure",
    harnessId: spec.harnessId ?? "h-plain",
    agentId: spec.agentId ?? "triage",
    tools: spec.tools ?? DEFAULT_TOOLSET,
    seeds: spec.runs.map((_, i) => i + 1),
    time: spec.time ?? { kind: "lockstep", secondsPerCall: 30 },
    profiles: {},
  };
  const experiment: Experiment = {
    id: spec.id,
    name: `실험 ${spec.id}`,
    owner: spec.owner ?? "yeonsu",
    createdAt: spec.createdAt ?? AT,
    recipe,
    snapshot,
    benchmarkKey: benchmarkKey(snapshot, recipe),
    ...(spec.parentId ? { parentId: spec.parentId } : {}),
  };
  const runs: RunRecord[] = spec.runs.map((script, i) => {
    const queued = newRun(`${spec.id}-r${i}`, spec.id, i, i + 1, AT);
    if (script === "cancel") return applyRunEvent(queued, { type: "cancel", at: AT });
    const started = applyRunEvent(queued, { type: "start", at: AT });
    if (script === "fail")
      return applyRunEvent(started, { type: "fail", at: AT, error: "하네스 연결 끊김" });
    return applyRunEvent(started, {
      type: "complete",
      at: AT,
      result: play(script, i + 1, spec.templateId),
      ...(spec.harness ? { harness: spec.harness } : {}),
    });
  });
  return { experiment, runs };
}
