/**
 * The scenario an operation run plays (REQ-090, ADR-0094 item 3): nothing but the agent's task, handed over at the
 * start and open until the hours are used up. The faults do not come from the flow but from the generator, which keeps
 * them out of the scenario's digest: the same scenario serves every preset and every seed.
 */
import { emptyScenario, type ScenarioDoc } from "@terrarium/core/scenario";
import type { OperationConfig } from "./config";

export const DEFAULT_OPERATION_CALLS = 5_000;

/** What every operation run starts with, before the experiment's own instruction. */
export const OPERATION_BRIEF =
  "당신은 이 데이터센터의 운영 담당이에요. 정해진 시간 동안 계속 지켜보다가 문제가 생기면 서비스부터 복구하세요. " +
  "세계는 알람을 밀어 주지 않아요. `events_since`, `list_alarms`, `service_status`로 직접 확인해야 하고, 조용할 때는 `wait`로 기다릴 수 있어요. " +
  "`submit_diagnosis`는 사건 하나를 닫는 용도이고 운영은 시간이 다 되거나 사람이 멈출 때 끝나요.";

/** What the agent is told when it files a diagnosis in an operation: the run is not over. */
export const DIAGNOSIS_NOTE = "진단을 기록했어요. 운영은 계속돼요.";

/** The answer to `submit_diagnosis` in an operation carries a note, so the agent does not take it for the end. Anything else is untouched. */
export function withDiagnosisNote<R extends { ok: boolean; data?: unknown }>(
  tool: string,
  result: R,
  operating: boolean,
): R {
  if (!operating || tool !== "submit_diagnosis" || !result.ok) return result;
  return { ...result, data: { ...(result.data as object), note: DIAGNOSIS_NOTE } };
}

export function operationPrompt(c: OperationConfig): string {
  const instruction = c.instruction.trim();
  return instruction === "" ? OPERATION_BRIEF : `${OPERATION_BRIEF}\n\n${instruction}`;
}

/** The scenario for an operation of this config on this world. */
export function operationScenario(id: string, worldId: string, c: OperationConfig): ScenarioDoc {
  const base = emptyScenario(id, worldId, "운영");
  return {
    ...base,
    description: `${c.hours}시간 운영`,
    nodes: [
      ...base.nodes,
      {
        id: "task",
        type: "agent_task",
        params: {
          prompt: operationPrompt(c),
          // the editor's range stops at 500; an operation's own limit is applied by the session
          maxToolCalls: 500,
          timeLimitSeconds: c.hours * 3_600,
        },
        position: { x: 200, y: 0 },
      },
    ],
    edges: [{ id: "e1", from: "start", port: "next", to: "task" }],
    template: "operation",
  };
}
