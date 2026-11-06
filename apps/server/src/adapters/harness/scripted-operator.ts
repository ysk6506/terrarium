/**
 * The built-in reference agent for work that has to be handed to another team (REQ-093, ADR-0100): `operator`.
 * It keeps the services alive while a team works, hands the cause to the team that owns it, waits for the team with
 * `events_since`, and puts back what it moved. It is the yardstick the scenarios "내 도메인 밖이 원인" are calibrated
 * with: what a careful operator does with a wait of hours or days.
 *
 *   1  for each service that is not well: a VM goes to another server, any other service to its standby
 *   2  the cause is read from the reason the service gives: bad memory is the server team's, a cable that does not
 *      answer is the network team's; the matching domain is handed over with `escalate`
 *   3  wait with `wait` and look at `events_since` until the team is done
 *   4  undo what was moved, and answer
 */
import type {
  AgentInfo,
  AgentRunOutcome,
  AgentRunRequest,
  ToolEndpoint,
} from "@terrarium/core/experiments";

export const OPERATOR_AGENT: AgentInfo = {
  id: "operator",
  name: "운영 (규칙 기반)",
  description:
    "멈춘 서비스를 임시로 살리고, 내 도메인 밖의 원인은 맡은 팀에 넘겨요. 팀이 끝내면 옮긴 것을 되돌려요. 운영 모드에서는 5분마다 새 알람을 확인하며 계속 지켜봐요.",
};

interface ServiceRow {
  readonly id: string;
  readonly status: string;
  readonly runsOn: readonly string[];
  readonly why?: string;
}

/** What was moved to keep a service alive, and how to put it back. */
type Undo =
  | { readonly tool: "migrate_vm"; readonly args: Record<string, unknown> }
  | { readonly tool: "failover_service"; readonly args: Record<string, unknown> };

const HOUR_S = 3600;
const MAX_WAITS = 120;

const has = (tools: ToolEndpoint, name: string) => tools.specs.some((s) => s.name === name);

async function data<T>(
  tools: ToolEndpoint,
  name: string,
  args: Record<string, unknown>,
): Promise<T | undefined> {
  const r = await tools.call(name, args);
  return r.ok ? (r.data as T) : undefined;
}

const troubled = async (tools: ToolEndpoint): Promise<ServiceRow[]> =>
  ((await data<ServiceRow[]>(tools, "list_services", {})) ?? []).filter(
    (s) => s.status !== "healthy",
  );

/** Move a VM to another server; what it takes to move it back, or nothing if the move did not work. */
async function moveVm(tools: ToolEndpoint, vm: string): Promise<Undo | undefined> {
  const servers =
    (await data<Array<{ id: string }>>(tools, "list_entities", { kind: "server" })) ?? [];
  for (const s of servers) {
    const moved = await tools.call("migrate_vm", { vm, host: s.id });
    const from = (moved.data as { from?: string } | undefined)?.from;
    if (moved.ok && from) return { tool: "migrate_vm", args: { vm, host: from } };
  }
  return undefined;
}

/** Move the service out of harm's way: its VM to another server, else the service to its standby. */
async function keepAlive(tools: ToolEndpoint, row: ServiceRow): Promise<Undo | undefined> {
  const host = row.runsOn[0];
  const entity = host ? await data<{ kind: string }>(tools, "get_entity", { id: host }) : undefined;
  if (host && entity?.kind === "vm" && has(tools, "migrate_vm")) return moveVm(tools, host);
  if (
    has(tools, "failover_service") &&
    (await tools.call("failover_service", { service: row.id })).ok
  )
    return { tool: "failover_service", args: { service: row.id } };
  return undefined;
}

/** The domain to hand over and the cause, read from the reason a service gives. */
function causeOf(
  rows: readonly ServiceRow[],
): { domain: string; rootCause: string; faultType: string } | undefined {
  for (const row of rows) {
    const memory = /(\S+) 메모리 불량/.exec(row.why ?? "");
    if (memory)
      return { domain: "server", rootCause: memory[1] as string, faultType: "memory_failure" };
    const cable = /(\S+?)에 네트워크로 닿지/.exec(row.why ?? "");
    if (cable) return { domain: "network", rootCause: cable[1] as string, faultType: "link_down" };
  }
  return undefined;
}

/** Wait, an hour at a time, until the team says it is done. */
async function untilDone(tools: ToolEndpoint, signal: AbortSignal): Promise<void> {
  let cursor = 0;
  for (let i = 0; i < MAX_WAITS && !signal.aborted; i++) {
    await tools.call("wait", { seconds: HOUR_S });
    const news = await data<{ cursor: number; events: Array<{ type: string }> }>(
      tools,
      "events_since",
      { cursor },
    );
    cursor = news?.cursor ?? cursor;
    if (news?.events.some((e) => e.type === "done")) return;
  }
}

/** The services in trouble, waiting a little when the world has not shown any yet. */
async function firstTrouble(tools: ToolEndpoint, signal: AbortSignal): Promise<ServiceRow[]> {
  let hurt = await troubled(tools);
  for (let tries = 0; hurt.length === 0 && tries < 3 && !signal.aborted; tries++) {
    await tools.call("wait", { seconds: 300 });
    hurt = await troubled(tools);
  }
  return hurt;
}

/** Hand the cause over, wait for the team, and put back what was moved. */
async function handOver(
  req: AgentRunRequest,
  rows: readonly ServiceRow[],
  cause: { domain: string },
  undo: readonly Undo[],
): Promise<void> {
  const { tools, signal } = req;
  await tools.call("escalate", {
    domain: cause.domain,
    note: `${rows.map((r) => r.id).join(", ")}가 멈췄어요`,
  });
  await untilDone(tools, signal);
  for (const u of undo) await tools.call(u.tool, u.args);
}

/** The five-minute rhythm of the resident loop (ADR-0094 item 5): short enough to see an alarm soon, long enough to be cheap. */
export const WATCH_SECONDS = 300;
const WAKE_SLICE_SECONDS = 60;

/** One domain's open hand-over: what was moved to keep services alive, to be put back when the team is done. */
interface Open {
  readonly undo: Undo[];
  readonly services: Set<string>;
}

/** Sleep until it is time to look again; with alarms pushed, a new alarm cuts the sleep short. */
async function sleepUntilLook(req: AgentRunRequest, woken: { value: boolean }): Promise<boolean> {
  const slice = req.operation?.wake ? WAKE_SLICE_SECONDS : WATCH_SECONDS;
  for (let slept = 0; slept < WATCH_SECONDS && !req.signal.aborted; slept += slice) {
    const r = await req.tools.call("wait", { seconds: slice });
    if (r.ended || (!r.ok && /ended/.test(r.error ?? ""))) return false;
    if (woken.value) break;
  }
  woken.value = false;
  return !req.signal.aborted;
}

/** The services in trouble, with the reason each gives. */
async function hurtRows(tools: ToolEndpoint): Promise<ServiceRow[]> {
  const hurt = await troubled(tools);
  return Promise.all(
    hurt.map((h) =>
      data<ServiceRow>(tools, "service_status", { service: h.id }).then((s) => s ?? h),
    ),
  );
}

/** Keep each hurt service alive once, and hand the cause over to its team the first time it is seen. */
async function keepAndHandOver(
  tools: ToolEndpoint,
  rows: readonly ServiceRow[],
  open: Map<string, Open>,
): Promise<void> {
  const cause = causeOf(rows);
  const mine = cause ? (open.get(cause.domain) ?? { undo: [], services: new Set() }) : undefined;
  for (const row of rows) {
    if (mine?.services.has(row.id)) continue;
    const done = await keepAlive(tools, row);
    mine?.services.add(row.id);
    if (done) mine?.undo.push(done);
  }
  if (!cause || !mine || open.has(cause.domain) || !has(tools, "escalate")) return;
  open.set(cause.domain, mine);
  await tools.call("escalate", {
    domain: cause.domain,
    note: `${rows.map((r) => r.id).join(", ")}가 멈췄어요`,
  });
}

/** Look at what is new; keep what is hurt alive; hand the cause over once; put things back when a team is done. */
async function lookAndAct(
  req: AgentRunRequest,
  state: { cursor: number; open: Map<string, Open> },
): Promise<void> {
  const { tools } = req;
  const news = await data<{ cursor: number; events: Array<{ type: string }> }>(
    tools,
    "events_since",
    { cursor: state.cursor },
  );
  state.cursor = news?.cursor ?? state.cursor;
  await keepAndHandOver(tools, await hurtRows(tools), state.open);
  if (!news?.events.some((e) => e.type === "done")) return;
  for (const [domain, open] of state.open) {
    for (const u of open.undo) await tools.call(u.tool, u.args);
    state.open.delete(domain);
  }
}

/**
 * The resident loop of an operation (ADR-0094 items 5 and 6): every five minutes, `events_since`; services first, then
 * the cause; hand over what is not mine; put back what was moved; otherwise `wait`. It never answers with a diagnosis:
 * an operation ends when its hours are used or a person stops it.
 */
async function resident(req: AgentRunRequest): Promise<AgentRunOutcome> {
  const state = { cursor: 0, open: new Map<string, Open>() };
  const woken = { value: false };
  const off = req.operation?.wake?.subscribe(() => {
    woken.value = true;
  });
  try {
    await lookAndAct(req, state);
    while (await sleepUntilLook(req, woken)) await lookAndAct(req, state);
  } finally {
    off?.();
  }
  return { status: "finished", message: "운영 시간이 끝나 멈췄어요" };
}

export async function operator(req: AgentRunRequest): Promise<AgentRunOutcome> {
  if (req.operation) return resident(req);
  const { tools } = req;
  const hurt = await firstTrouble(tools, req.signal);
  if (hurt.length === 0)
    return { status: "finished", message: "멈춘 서비스가 없어 할 일이 없었어요" };
  const rows = await Promise.all(
    hurt.map((h) =>
      data<ServiceRow>(tools, "service_status", { service: h.id }).then((s) => s ?? h),
    ),
  );
  const undo: Undo[] = [];
  for (const row of rows) {
    const done = await keepAlive(tools, row);
    if (done) undo.push(done);
  }
  const cause = causeOf(rows);
  if (cause && has(tools, "escalate") && has(tools, "events_since"))
    await handOver(req, rows, cause, undo);
  await tools.call("submit_diagnosis", diagnosisOf(cause, rows, undo));
  return { status: "finished" };
}

/** What the operator answers with when it has done what it can. */
function diagnosisOf(
  cause: ReturnType<typeof causeOf>,
  rows: readonly ServiceRow[],
  undo: readonly Undo[],
) {
  return {
    rootCause: cause?.rootCause ?? rows[0]?.runsOn[0] ?? "알 수 없음",
    faultType: cause?.faultType ?? "unknown",
    summary: cause
      ? `${cause.rootCause}이(가) 원인이라 ${cause.domain} 도메인 팀에 넘겼어요. 그동안 서비스를 옮겨 살렸고, 끝난 뒤 되돌렸어요.`
      : "서비스를 옮겨 살렸어요. 원인은 찾지 못했어요.",
    actions: undo.map((u) => u.tool),
    confidence: cause ? 0.8 : 0.2,
  };
}
