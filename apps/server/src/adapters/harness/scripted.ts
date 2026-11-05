/**
 * The built-in harness: rule-based reference agents that use only Terrarium's tools (REQ-008).
 * They give every benchmark a floor and a yardstick before any real agent is connected, keep a fresh
 * server useful, and exercise the whole run path in tests and capacity measurement.
 *
 *   triage  follows alarms upstream: the alarmed thing that explains the most other alarms is the cause
 *   guess   names a random alarmed entity and a random fault type: what chance scores
 *   idle    looks at the alarms and stops: what doing nothing scores
 */
import type {
  AgentInfo,
  AgentRunOutcome,
  AgentRunRequest,
  HarnessInfo,
  HarnessPort,
  ToolEndpoint,
} from "@terrarium/core/experiments";
import { SeededRng } from "@terrarium/core/kernel";

const pick = <T>(rng: SeededRng, xs: readonly T[]): T =>
  xs[Math.floor(rng.random() * xs.length)] as T;

interface AlarmRow {
  readonly entityId: string;
  readonly code: string;
  readonly severity: "warning" | "critical";
}

/** Alarm codes that point at a cause, and the fault they mean. */
export const CAUSE_CODES: Readonly<Record<string, string>> = {
  cooling_stopped: "cooling_unit_failure",
  cooling_overload: "cooling_unit_degraded",
  breaker_tripped: "breaker_trip",
  ups_on_battery: "grid_outage",
  ups_battery_low: "ups_battery_degraded",
  fan_failed: "fan_failure",
  psu_failed: "psu_failure",
  vm_cpu_high: "vm_cpu_spike",
  switch_down: "switch_failure",
  disk_failed: "disk_failure",
  link_down: "link_down",
};

/** "link_down.l-7" → "link_down". */
const codeOf = (a: AlarmRow) => a.code.split(".")[0] as string;

const AGENTS: readonly AgentInfo[] = [
  {
    id: "triage",
    name: "알람 추적 (규칙 기반)",
    description:
      "알람을 의존 방향으로 따라 올라가, 다른 알람을 가장 많이 설명하는 장비를 원인으로 봐요.",
  },
  {
    id: "guess",
    name: "무작위 추측",
    description: "알람이 난 장비와 고장 종류을 무작위로 골라요. 운으로 받는 점수.",
  },
  {
    id: "idle",
    name: "아무것도 안 함",
    description: "알람만 보고 끝내요. 진단하지 않았을 때의 점수.",
  },
];

async function alarms(tools: ToolEndpoint): Promise<AlarmRow[]> {
  const r = await tools.call("list_alarms", {});
  return r.ok ? (r.data as AlarmRow[]) : [];
}

/** Alarms, waiting a little if the world has not shown anything yet. */
async function firstAlarms(tools: ToolEndpoint, signal: AbortSignal): Promise<AlarmRow[]> {
  for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
    const found = await alarms(tools);
    if (found.length > 0) return found;
    if (!tools.specs.some((s) => s.name === "wait")) return [];
    await tools.call("wait", { seconds: 300 });
  }
  return [];
}

interface Candidate {
  readonly id: string;
  readonly explains: number;
  readonly cause: boolean;
  readonly critical: boolean;
}

async function candidates(tools: ToolEndpoint, found: readonly AlarmRow[]): Promise<Candidate[]> {
  const alarmed = [...new Set(found.map((a) => a.entityId))];
  const withCause = alarmed.filter((id) =>
    found.some((a) => a.entityId === id && CAUSE_CODES[codeOf(a)]),
  );
  const pool = (withCause.length > 0 ? withCause : alarmed).slice(0, 8);
  const canImpact = tools.specs.some((s) => s.name === "get_impact");
  const out: Candidate[] = [];
  for (const id of pool) {
    const impact = canImpact ? await tools.call("get_impact", { id }) : undefined;
    const dependents = impact?.ok
      ? ((impact.data as { dependents: string[] }).dependents ?? [])
      : [];
    out.push({
      id,
      explains: alarmed.filter((other) => other !== id && dependents.includes(other)).length,
      cause: withCause.includes(id),
      critical: found.some((a) => a.entityId === id && a.severity === "critical"),
    });
  }
  return out.sort(
    (a, b) =>
      b.explains - a.explains ||
      Number(b.cause) - Number(a.cause) ||
      Number(b.critical) - Number(a.critical) ||
      a.id.localeCompare(b.id),
  );
}

function faultFor(id: string, found: readonly AlarmRow[]): string {
  const mine = found.filter((a) => a.entityId === id).map(codeOf);
  for (const code of mine) if (CAUSE_CODES[code]) return CAUSE_CODES[code] as string;
  // A server that looks hot while nothing around it does: the sensor is lying.
  if (mine.includes("inlet_high") && found.filter((a) => codeOf(a) === "inlet_high").length === 1)
    return "sensor_drift";
  if (mine.includes("cpu_high")) return "cpu_runaway";
  return "unknown";
}

async function triage(req: AgentRunRequest): Promise<AgentRunOutcome> {
  const found = await firstAlarms(req.tools, req.signal);
  if (found.length === 0) return { status: "finished", message: "알람이 없어 진단하지 않았어요" };
  const [best] = await candidates(req.tools, found);
  if (!best || req.signal.aborted) return { status: "cancelled" };
  const faultType = faultFor(best.id, found);
  await req.tools.call("submit_diagnosis", {
    rootCause: best.id,
    faultType,
    summary: `${best.id}의 알람이 다른 알람 ${best.explains}개를 설명해요 (${faultType}).`,
    actions: [],
    confidence: best.explains > 0 ? 0.7 : 0.4,
  });
  return { status: "finished" };
}

async function guess(req: AgentRunRequest): Promise<AgentRunOutcome> {
  const rng = new SeededRng(req.seed);
  const found = await alarms(req.tools);
  const ids = [...new Set(found.map((a) => a.entityId))].sort();
  if (ids.length === 0) return { status: "finished", message: "알람이 없어 추측할 것이 없어요" };
  const types = [...new Set(Object.values(CAUSE_CODES))].sort();
  await req.tools.call("submit_diagnosis", {
    rootCause: pick(rng, ids),
    faultType: pick(rng, types),
    summary: "무작위로 골랐어요.",
    actions: [],
    confidence: 0,
  });
  return { status: "finished" };
}

async function idle(req: AgentRunRequest): Promise<AgentRunOutcome> {
  await alarms(req.tools);
  return { status: "finished", message: "알람만 확인했어요" };
}

const PLAYS: Readonly<Record<string, (req: AgentRunRequest) => Promise<AgentRunOutcome>>> = {
  triage,
  guess,
  idle,
};

export class ScriptedHarness implements HarnessPort {
  readonly info: HarnessInfo;

  constructor(id: string, name: string) {
    this.info = {
      id,
      name,
      kind: "scripted",
      description:
        "테라리움에 들어 있는 규칙 기반 기준 에이전트. 다른 에이전트와 비교할 바닥과 잣대가 돼요.",
      toolTransport: "in-process",
      telemetry: "none",
    };
  }

  async agents(): Promise<readonly AgentInfo[]> {
    return AGENTS;
  }

  async run(req: AgentRunRequest): Promise<AgentRunOutcome> {
    const play = PLAYS[req.agentId];
    if (!play)
      return { status: "error", message: `내장 하네스에 '${req.agentId}' 에이전트가 없어요` };
    return play(req);
  }
}
