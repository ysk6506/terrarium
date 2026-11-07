/**
 * What the built-in `operator` and `triage` know about the layers above the servers (REQ-108, ADR-0131): the site and DR
 * layer, the GPU layer and the power and cooling faults. Each is a short script, not a clever one: recognise the alarm,
 * look once with the layer's status tool, act once with the layer's own tool, wait for it to take, then answer.
 *
 *   site   hot and multi-active move by themselves, so wait (hands-off.ts) · warm: `dr_failover` · cold: hand it to the
 *          facility team and start `dr_failover` too · stuck: `dr_failover` again · split brain: keep the primary ·
 *          cut line: hand it to the network team, no failover · broken copy: restart the replicator, or hand a broken
 *          volume copy to the storage team · `dr_failback` once the team is done and the primary is back
 *   gpu    `gpu_status`, then `gpu_reset`; a failed or paused job gets `job_resume`
 *   power  `substation_status`, then `transfer_feed` to the feed that has voltage · `cdu_status`, then `cdu_pump_switch`
 *
 * Whatever the script would change, it first waits out an automatic recovery (`Watch.holdOff`) and looks again whether
 * the alarm is still there.
 */
import type { ToolEndpoint } from "@terrarium/core/experiments";
import { type AlarmRow, alarmsOf, codeOf, data, has, SETTLE_S, type Watch } from "./hands-off";

/** Alarm codes of these layers, and the fault each one means: what `triage` and `operator` name as the cause. */
export const LAYER_CODES: Readonly<Record<string, string>> = {
  site_split_brain: "split_brain",
  dr_failover_stuck: "dr_failover_stuck",
  site_down: "site_power_loss",
  wan_down: "wan_link_down",
  wan_degraded: "wan_degraded",
  replication_broken: "replication_broken",
  db_quorum_lost: "db_quorum_lost",
  substation_down: "utility_feed_loss",
  cdu_pump_failed: "cdu_pump_failure",
  gpu_down: "gpu_xid_error",
  job_paused: "job_stuck_checkpoint",
};

/** The order they are looked at in: a whole site before the copies and services that fell with it. */
const PRIORITY = Object.keys(LAYER_CODES);

export interface Finding {
  readonly fault: string;
  /** The entity the alarm sits on, which is what the answer names. */
  readonly root: string;
  readonly code: string;
}

/** The layer fault the alarms point at, if one of these layers is the trouble. */
export function findLayerCause(alarms: readonly AlarmRow[]): Finding | undefined {
  for (const code of PRIORITY) {
    const hit = alarms
      .filter((a) => codeOf(a) === code)
      .sort((a, b) => a.entityId.localeCompare(b.entityId))[0];
    if (hit) return { fault: LAYER_CODES[code] as string, root: hit.entityId, code };
  }
  return undefined;
}

/** A stream of a volume's copy is a storage matter; the same alarm on a service's copy is the replicator's. */
export async function refineFault(tools: ToolEndpoint, finding: Finding): Promise<Finding> {
  if (finding.fault !== "replication_broken") return finding;
  const streams = await data<{ streams: Array<{ id: string; copies: string }> }>(
    tools,
    "replication_status",
  );
  const copies = streams?.streams.find((s) => s.id === finding.root)?.copies;
  const kind = copies
    ? (await data<{ kind: string }>(tools, "get_entity", { id: copies }))?.kind
    : undefined;
  return kind === "volume" ? { ...finding, fault: "geo_replica_broken" } : finding;
}

const WAIT_MAX_S = 3600;
const SETTLE_AFTER_ACT_S = SETTLE_S;

interface Site {
  readonly id: string;
  readonly role: string;
  readonly status: string;
  readonly mode: string;
  readonly serversUp: number;
  readonly serversTotal: number;
}
interface Plan {
  readonly id: string;
  readonly mode: string;
  readonly servingSite: string;
  readonly phase: string;
  readonly movingTo?: string;
  readonly movesByItself: boolean;
}
interface SiteView {
  readonly sites: readonly Site[];
  readonly plans: readonly Plan[];
}

/** What the agent did, for the answer. */
export interface Done {
  readonly actions: string[];
  readonly handedTo?: string;
  readonly note: string;
  /** What the move turned out to be, when it is not what the alarm said (a failover that stopped halfway). */
  readonly fault?: { readonly type: string; readonly root: string };
}

const none = (note: string): Done => ({ actions: [], note });

async function escalate(tools: ToolEndpoint, domain: string, note: string): Promise<boolean> {
  return has(tools, "escalate") && (await tools.call("escalate", { domain, note })).ok;
}

/** `wait` takes an hour at most, so a long wait is a few calls. */
async function sitWaiting(tools: ToolEndpoint, seconds: number): Promise<void> {
  if (!has(tools, "wait")) return;
  for (let left = seconds; left > 0; left -= WAIT_MAX_S)
    if (!(await tools.call("wait", { seconds: Math.min(left, WAIT_MAX_S) })).ok) return;
}

/**
 * Move the services to `site` and wait the time the tool says it takes, in two halves: a move that stops halfway
 * (`dr_failover_stuck`) shows as a phase of `stuck` after the first half, and is pressed once more.
 */
async function move(tools: ToolEndpoint, site: string): Promise<{ ok: boolean; stuck?: string }> {
  const r = await tools.call("dr_failover", { site });
  const eta = (r.data as { etaSeconds?: number } | undefined)?.etaSeconds;
  if (!r.ok || !eta) return { ok: r.ok };
  await sitWaiting(tools, Math.ceil(eta / 2) + 15);
  const plan = (await data<SiteView>(tools, "site_status"))?.plans[0];
  if (plan?.phase !== "stuck") {
    await sitWaiting(tools, Math.floor(eta / 2) + 15);
    return { ok: true };
  }
  const again = await tools.call("dr_failover", { site });
  const rest = (again.data as { etaSeconds?: number } | undefined)?.etaSeconds ?? eta;
  await sitWaiting(tools, rest + 30);
  return { ok: true, stuck: plan.id };
}

/** Give a change a minute to take hold before the answer is given. */
const settle = (tools: ToolEndpoint) => sitWaiting(tools, SETTLE_AFTER_ACT_S);

type SiteRow = SiteView["sites"][number];

/** The primary site, or when both think they lead, the first one that is up by id. */
function leadingSite(sites: readonly SiteRow[]): SiteRow | undefined {
  return (
    sites.find((s) => s.role === "primary") ??
    [...sites].filter((s) => s.status !== "down").sort((a, b) => a.id.localeCompare(b.id))[0]
  );
}

type SitePlan = SiteView["plans"][number];

/** The faults that are not a lost site: a cut line, two sites that both think they lead, a move that stopped. */
async function siteSpecial(
  tools: ToolEndpoint,
  f: Finding,
  plan: SitePlan,
  dr: SiteRow | undefined,
  primary: SiteRow | undefined,
): Promise<Done | undefined> {
  if (f.fault === "wan_link_down") {
    await data(tools, "wan_status");
    const handed = await escalate(tools, "network", "사이트 사이 회선이 끊겼어요");
    return {
      ...none("회선 문제라 전환하지 않고 네트워크 팀에 넘겼어요"),
      ...(handed ? { handedTo: "network" } : {}),
    };
  }
  if (f.fault === "split_brain") {
    if (primary && (await move(tools, primary.id)).ok)
      return { actions: ["dr_failover"], note: `남길 사이트로 ${primary.id}를 골라 전환했어요` };
    return none("남길 사이트를 정하지 못했어요");
  }
  if (f.fault === "dr_failover_stuck") {
    const to = plan.movingTo ?? dr?.id;
    if (to && (await move(tools, to)).ok)
      return { actions: ["dr_failover"], note: "멈춘 전환을 다시 눌러 마저 끝냈어요" };
    return none("멈춘 전환을 끝내지 못했어요");
  }
  return undefined;
}

async function siteResponse(tools: ToolEndpoint, f: Finding): Promise<Done> {
  const view = await data<SiteView>(tools, "site_status");
  const plan = view?.plans[0];
  if (!view || !plan) return none("사이트 상태를 읽지 못했어요");
  const dr = view.sites.find((s) => s.role !== "primary" && s.status !== "down");
  const primary = leadingSite(view.sites);
  const special = await siteSpecial(tools, f, plan, dr, primary);
  if (special) return special;
  // site_power_loss: a plan that moves by itself was waited for already
  if (plan.movesByItself) return none("복구 사이트로 알아서 넘어가는 걸 기다렸어요");
  const actions: string[] = [];
  let handedTo: string | undefined;
  if (plan.mode === "cold" && (await escalate(tools, "facility", "본 사이트의 전기가 끊겼어요")))
    handedTo = "facility";
  const moved = dr ? await move(tools, dr.id) : undefined;
  if (moved?.ok) actions.push("dr_failover");
  return {
    actions,
    ...(moved?.stuck ? { fault: { type: "dr_failover_stuck", root: moved.stuck } } : {}),
    ...(handedTo ? { handedTo } : {}),
    note: `${plan.mode === "cold" ? "콜드" : "웜"} 사이트라 사람이 복구 사이트로 전환했어요`,
  };
}

/** Put the services back once the primary is up and nobody is moving them. */
export async function failbackIfPrimaryBack(tools: ToolEndpoint): Promise<boolean> {
  const view = await data<SiteView>(tools, "site_status");
  const plan = view?.plans[0];
  const primary = view?.sites.find((s) => s.role === "primary");
  if (!plan || !primary || plan.phase !== "idle" || plan.movesByItself) return false;
  if (primary.status !== "ok" || plan.servingSite === primary.id) return false;
  return (await tools.call("dr_failback", {})).ok;
}

async function copyResponse(tools: ToolEndpoint, f: Finding): Promise<Done> {
  if (f.fault === "geo_replica_broken") {
    const handed = await escalate(tools, "storage", "다른 사이트의 볼륨 복사본이 깨졌어요");
    return {
      ...none("볼륨 복사본은 스토리지 팀이 다시 만들어요"),
      ...(handed ? { handedTo: "storage" } : {}),
    };
  }
  const entity = await data<{ connections?: { hosted_on_to?: string[] } }>(tools, "get_entity", {
    id: f.root,
  });
  const host = entity?.connections?.hosted_on_to?.[0];
  if (host && has(tools, "run_command")) {
    const r = await tools.call("run_command", { host, cmd: "systemctl restart replicad" });
    if (r.ok) return { actions: ["run_command"], note: `${host}에서 복제기를 다시 시작했어요` };
  }
  return none("복제기를 다시 시작하지 못했어요");
}

async function quorumResponse(tools: ToolEndpoint, alarms: readonly AlarmRow[]): Promise<Done> {
  await data(tools, "db_cluster_status");
  const actions: string[] = [];
  for (const a of alarms.filter((x) => codeOf(x) === "db_node_down"))
    if ((await tools.call("db_node_restart", { node: a.entityId })).ok)
      actions.push("db_node_restart");
  return { actions, note: "멈춘 합의 DB 노드를 다시 시작했어요" };
}

async function gpuResponse(
  tools: ToolEndpoint,
  f: Finding,
  alarms: readonly AlarmRow[],
): Promise<Done> {
  const actions: string[] = [];
  await data(tools, "gpu_status");
  const gpu = /^(.*)-gpu(\d+)$/.exec(f.code === "gpu_down" ? f.root : "");
  if (gpu && (await tools.call("gpu_reset", { server: gpu[1], gpu: f.root })).ok)
    actions.push("gpu_reset");
  const job = alarms.find((a) => ["job_failed", "job_paused"].includes(codeOf(a)));
  if (job && (await tools.call("job_resume", { job: job.entityId })).ok) actions.push("job_resume");
  if (actions.length > 0) await settle(tools);
  return { actions, note: "GPU를 리셋하고 잡을 이어 갔어요" };
}

async function acted(tools: ToolEndpoint, tool: string): Promise<string[]> {
  await settle(tools);
  return [tool];
}

async function feedResponse(tools: ToolEndpoint, f: Finding): Promise<Done> {
  const view = await data<{
    substations: Array<{
      id: string;
      feeds: Array<{ feed: number; voltage: boolean; active: boolean }>;
    }>;
  }>(tools, "substation_status", { substation: f.root });
  const next = view?.substations
    .find((x) => x.id === f.root)
    ?.feeds.find((x) => x.voltage && !x.active);
  if (next && (await tools.call("transfer_feed", { substation: f.root, feed: next.feed })).ok)
    return {
      actions: await acted(tools, "transfer_feed"),
      note: `수전을 ${next.feed}번 줄로 옮겼어요`,
    };
  return none("옮길 수전 줄이 없어요");
}

async function pumpResponse(tools: ToolEndpoint, alarms: readonly AlarmRow[]): Promise<Done> {
  await data(tools, "cdu_status");
  const actions: string[] = [];
  for (const a of alarms.filter((x) => codeOf(x) === "cdu_pump_failed"))
    if ((await tools.call("cdu_pump_switch", { cdu: a.entityId })).ok)
      actions.push("cdu_pump_switch");
  if (actions.length > 0) await settle(tools);
  return { actions, note: "CDU 예비 펌프를 돌렸어요" };
}

async function script(tools: ToolEndpoint, f: Finding, alarms: readonly AlarmRow[]): Promise<Done> {
  switch (f.fault) {
    case "site_power_loss":
    case "wan_link_down":
    case "split_brain":
    case "dr_failover_stuck":
      return siteResponse(tools, f);
    case "replication_broken":
    case "geo_replica_broken":
      return copyResponse(tools, f);
    case "db_quorum_lost":
      return quorumResponse(tools, alarms);
    case "gpu_xid_error":
    case "job_stuck_checkpoint":
      return gpuResponse(tools, f, alarms);
    case "utility_feed_loss":
      return feedResponse(tools, f);
    case "cdu_pump_failure":
      return pumpResponse(tools, alarms);
    default:
      return none("이 고장은 따로 정해 둔 조치가 없어요");
  }
}

/**
 * Respond to a layer fault: wait out what the system does by itself, look again, and only if the alarm is still there
 * run the script. Returns what was done.
 */
export async function respond(
  tools: ToolEndpoint,
  watch: Watch,
  finding: Finding,
  alarms: readonly AlarmRow[],
): Promise<Done> {
  const held = await watch.holdOff(alarms);
  let current = alarms;
  if (held.waited) {
    // what the system brought back is left alone: a reset of a GPU would kill the job that runs again without it
    const services = await data<Array<{ status: string }>>(tools, "list_services");
    if (services?.every((s) => s.status === "healthy"))
      return none("알아서 복구돼서 손대지 않았어요");
    current = await alarmsOf(tools);
  }
  return script(tools, finding, current);
}
