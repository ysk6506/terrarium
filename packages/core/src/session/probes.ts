/**
 * Two questions the calibration asks of every scenario about services and tools (REQ-088, ADR-0091 items 3 and 4),
 * answered by scripted agents that need no model:
 *
 *   recoveryPath  can the service be brought back by moving it, even when the machine cannot be fixed?
 *                 (`failover_service`, or `migrate_vm` for a service on a VM)
 *   commonReach   can an agent that has only the tools a real operations team has (realism `common`) get to the
 *                 equipment the answer names? It starts from the alarms and the service list and follows the names
 *                 that equipment details and service status give, a few steps; it never lists the whole world.
 */
import type { ScenarioDoc } from "@terrarium/core/scenario";
import { TOOL_SPECS } from "@terrarium/core/tools";
import { domainInfo, faultDomain, formatSpan, standsOnCluster } from "@terrarium/core/world";
import { Session, type SessionConfig } from "./session";

type Config = Omit<SessionConfig, "tools" | "seed"> & { readonly seed?: number };

const SETTLE_SECONDS = 60;
const HOUR_S = 3600;
const ALL_TOOLS = TOOL_SPECS.map((t) => t.name);

function open(config: Config, tools: readonly string[]): Session {
  const session = Session.create({ ...config, tools, seed: config.seed ?? 1 });
  session.start();
  return session;
}

interface ServiceRow {
  readonly id: string;
  readonly status: string;
  readonly runsOn: readonly string[];
}

const servicesOf = (s: Session): ServiceRow[] => {
  const r = s.call("list_services", {});
  return r.ok ? (r.data as ServiceRow[]) : [];
};

const troubled = (s: Session) => servicesOf(s).filter((r) => r.status !== "healthy");

export interface RecoveryPath {
  /** False for a scenario that is not about services: there is nothing to move. */
  readonly applicable: boolean;
  /** Whether moving the services brought them all back. */
  readonly ok: boolean;
  /** The tool that did it; `escalate` when only the team that owns the fault can bring them back. */
  readonly how?:
    | "failover_service"
    | "migrate_vm"
    | "db_failover"
    | "db_promote"
    | "storage_path_switch"
    | "db_restore"
    | "sdn_failover"
    | "sdn_sync"
    | "policy_revert"
    | "ingress_restart"
    | "cni_restart"
    | "kubectl_rollout_restart"
    | "kubectl_scale"
    | "kubectl_drain"
    | "run_command"
    | "escalate";
  /** In plain Korean: how it works, or what is missing. */
  readonly note: string;
}

/** Move the VM a service runs on to another server, trying the servers one after another. */
function migrateAway(s: Session, vm: string): boolean {
  const rows = s.call("list_entities", { kind: "server" });
  const servers = rows.ok ? (rows.data as Array<{ id: string }>) : [];
  return servers.some((e) => s.call("migrate_vm", { vm, host: e.id }).ok);
}

function migrateVms(s: Session): boolean {
  const vms = troubled(s)
    .flatMap((row) => row.runsOn)
    .filter(
      (id) => (s.call("get_entity", { id }).data as { kind?: string } | undefined)?.kind === "vm",
    );
  return vms.map((vm) => migrateAway(s, vm)).some(Boolean);
}

const idsOf = (s: Session, kind: string): string[] => {
  const r = s.call("list_entities", { kind });
  return r.ok ? (r.data as Array<{ id: string }>).map((e) => e.id) : [];
};

/** How long the database tools need to settle: a standby that starts, a copy that catches up. */
const DB_SETTLE_SECONDS = 240;
/** A restore takes twenty minutes; a damaged backup fails after four, so the older one gets as long again. */
const RESTORE_SETTLE_SECONDS = 1500;

/**
 * The ways back that need no repair of the machine but are the database's and the storage's own (REQ-095): make the
 * cluster fail over, switch the storage path to the other controller, restore what is down from a backup (an older one
 * when the newest turns out damaged). Returns the first that brings every service back.
 */
function databasePath(config: Config): RecoveryPath | undefined {
  const world = open(config, ALL_TOOLS).world.index;
  // a world without a database has nothing to fail over, and waiting here would only let a cluster heal by itself
  if (world.ofKind("db_cluster").length === 0 && world.ofKind("storage_pool").length === 0)
    return undefined;
  const tries: Array<[RecoveryPath["how"], string, (s: Session) => void]> = [
    [
      "db_failover",
      "클러스터를 페일오버하면 돌아와요",
      (s) => {
        for (const cluster of idsOf(s, "db_cluster")) s.call("db_failover", { cluster });
      },
    ],
    [
      "db_promote",
      "남길 인스턴스를 골라 승격하면 돌아와요",
      (s) => {
        for (const cluster of idsOf(s, "db_cluster")) {
          const r = s.call("db_status", { cluster });
          const first = r.ok
            ? (r.data as { instances: Array<{ id: string }> }).instances[0]
            : undefined;
          if (first) s.call("db_promote", { instance: first.id });
        }
      },
    ],
    [
      "storage_path_switch",
      "스토리지 경로를 다른 컨트롤러로 바꾸면 돌아와요",
      (s) => {
        for (const controller of idsOf(s, "storage_controller"))
          s.call("storage_path_switch", { controller });
      },
    ],
  ];
  for (const [how, note, act] of tries) {
    const s = open(config, ALL_TOOLS);
    if (troubled(s).length === 0) return undefined;
    act(s);
    s.call("wait", { seconds: DB_SETTLE_SECONDS });
    if (troubled(s).length === 0) return { applicable: true, ok: true, how, note };
  }
  const s = open(config, ALL_TOOLS);
  const instances = idsOf(s, "db_instance");
  if (instances.length === 0 || s.remaining() < RESTORE_SETTLE_SECONDS) return undefined;
  for (const instance of instances) s.call("db_restore", { instance, backup: "latest" });
  s.call("wait", { seconds: DB_SETTLE_SECONDS + 60 });
  for (const instance of instances) s.call("db_restore", { instance, backup: "backup-2" });
  s.call("wait", { seconds: RESTORE_SETTLE_SECONDS });
  return troubled(s).length === 0
    ? {
        applicable: true,
        ok: true,
        how: "db_restore",
        note: "백업에서 복원하면 돌아와요(최신 백업이 깨져 있으면 더 오래된 백업으로)",
      }
    : undefined;
}

const SDN_SETTLE_SECONDS = 150;

/** The ids of what a tool lists under `key`, for the tools of the overlay that answer with a list. */
const listed = (s: Session, tool: string, key: string): Array<Record<string, unknown>> => {
  const r = s.call(tool, {});
  return r.ok ? ((r.data as Record<string, Array<Record<string, unknown>>>)[key] ?? []) : [];
};

/**
 * The ways back that are the overlay's and the cloud-native layer's own (REQ-097): move to the standby controller, push the
 * configuration to every switch again, put a policy back, restart the ingress, restart the plug-in of a node. Returns the
 * first that brings every service back.
 */
function overlayPath(config: Config): RecoveryPath | undefined {
  const tries: Array<[RecoveryPath["how"], string, (s: Session) => void]> = [
    [
      "sdn_sync",
      "스위치에 설정을 다시 밀면 돌아와요",
      (s) => {
        for (const v of listed(s, "evpn_sessions", "sessions"))
          s.call("sdn_sync", { switch: String(v.switch) });
      },
    ],
    ["sdn_failover", "스탠바이 컨트롤러로 넘기면 돌아와요", (s) => void s.call("sdn_failover", {})],
    [
      "policy_revert",
      "네트워크 정책을 되돌리면 돌아와요",
      (s) => {
        for (const p of listed(s, "policy_list", "policies"))
          if (p.blocking === true) s.call("policy_revert", { policy: String(p.id) });
      },
    ],
    [
      "ingress_restart",
      "인그레스를 다시 시작하면 돌아와요",
      (s) => void s.call("ingress_restart", {}),
    ],
    [
      "cni_restart",
      "노드의 CNI 플러그인을 다시 시작하면 돌아와요",
      (s) => {
        const r = s.call("list_entities", { kind: "cni" });
        const ids = r.ok ? (r.data as Array<{ id: string }>).map((e) => e.id) : [];
        for (const id of ids) {
          const host = (
            s.call("get_entity", { id }).data as { connections?: Record<string, string[]> }
          )?.connections?.hosted_on_to?.[0];
          if (host) s.call("run_command", { host, cmd: "systemctl restart calico-node" });
        }
      },
    ],
  ];
  for (const [how, note, act] of tries) {
    const s = open(config, ALL_TOOLS);
    if (troubled(s).length === 0) return undefined;
    act(s);
    s.call("wait", { seconds: SDN_SETTLE_SECONDS });
    if (troubled(s).length === 0) return { applicable: true, ok: true, how, note };
  }
  return undefined;
}

/** How long the container tools need to settle: a new pod pulls its image and starts, a rollout goes pod by pod. */
const K8S_SETTLE_SECONDS = 120;

/**
 * The ways back that are the cluster's own (REQ-096): restart the rollout of every workload, make room by scaling a
 * batch workload to nothing, drain a node one at a time, restart the kubelet and the network plugin on a node, clean the
 * disk of a node and let it take pods again. Returns the first that brings every service back.
 */
function k8sPath(config: Config): RecoveryPath | undefined {
  const index = open(config, ALL_TOOLS).world.index;
  const nodes = index.ofKind("k8s_node").map((n) => n.id);
  if (nodes.length === 0) return undefined;
  const workloads = index.ofKind("k8s_workload");
  const hostOf = (node: string) => index.outgoing(node, "hosted_on")[0]?.to as string;
  const tries: Array<[NonNullable<RecoveryPath["how"]>, string, Array<(s: Session) => void>]> = [
    [
      "kubectl_rollout_restart",
      "워크로드를 롤아웃 재시작하면 돌아와요",
      [
        (s) => {
          for (const w of workloads) s.call("kubectl_rollout_restart", { workload: w.id });
        },
      ],
    ],
    [
      "kubectl_scale",
      "덜 중요한 워크로드를 줄여 자리를 만들면 돌아와요",
      [
        (s) => {
          for (const w of workloads.filter((x) => x.name === "batch" || x.name === "report"))
            s.call("kubectl_scale", { workload: w.id, replicas: 0 });
        },
      ],
    ],
    [
      "run_command",
      "노드의 kubelet·containerd를 다시 시작하면 돌아와요",
      nodes.map((n) => (s: Session) => {
        for (const unit of ["kubelet", "containerd"])
          s.call("run_command", { host: hostOf(n), cmd: `systemctl restart ${unit}` });
      }),
    ],
    [
      "run_command",
      "노드의 디스크를 비우고 uncordon 하면 돌아와요",
      nodes.map((n) => (s: Session) => {
        s.call("run_command", { host: hostOf(n), cmd: "rm /var/log/messages-old" });
        s.call("kubectl_uncordon", { node: n });
      }),
    ],
    [
      "kubectl_drain",
      "고장 난 노드를 drain 하면 돌아와요",
      nodes.map((n) => (s: Session) => s.call("kubectl_drain", { node: n })),
    ],
  ];
  for (const [how, note, acts] of tries) {
    // a step is tried alone when there are several (one node after the other), and all together once
    for (const act of acts.length > 1
      ? [
          ...acts,
          (s: Session) => {
            for (const a of acts) a(s);
          },
        ]
      : acts) {
      const s = open(config, ALL_TOOLS);
      if (troubled(s).length === 0) return undefined;
      act(s);
      s.call("wait", { seconds: K8S_SETTLE_SECONDS });
      if (troubled(s).length === 0) return { applicable: true, ok: true, how, note };
    }
  }
  return undefined;
}

/**
 * Hand each domain that has a fault to its team and wait out the longest lead time (ADR-0100 item 5): the way back
 * for a fault that nothing the agent's own tools do can clear. Not ok when the task's time limit comes first.
 */
function handOver(config: Config): RecoveryPath | undefined {
  const s = open(config, ALL_TOOLS);
  const domains = [...new Set(s.world.faults().map((f) => faultDomain(f.type)))];
  if (domains.length === 0) return undefined;
  const waits = domains.map((d) => {
    const r = s.call("escalate", { domain: d });
    const faults = r.ok ? (r.data as { faults: Array<{ etaSeconds: number }> }).faults : [];
    return Math.max(0, ...faults.map((f) => f.etaSeconds));
  });
  const longest = Math.max(...waits);
  const teams = domains.map((d) => domainInfo(d).team).join(", ");
  if (longest + SETTLE_SECONDS > s.remaining())
    return {
      applicable: true,
      ok: false,
      note: `${teams}에 넘겨도 ${formatSpan(longest)} 걸려서 제한 시간 안에 돌아오지 않아요`,
    };
  for (let left = longest + SETTLE_SECONDS; left > 0; left -= HOUR_S)
    s.call("wait", { seconds: Math.min(HOUR_S, left) });
  return troubled(s).length === 0
    ? {
        applicable: true,
        ok: true,
        how: "escalate",
        note: `${teams}에 넘기면 ${formatSpan(longest)} 뒤에 돌아와요`,
      }
    : undefined;
}

const NO_WAY: RecoveryPath = {
  applicable: true,
  ok: false,
  note: "서비스를 옮길 길(대기 쪽이나 다른 서버)도, 그 고장의 도메인 팀에 넘겨서 돌아오는 길도 없어요",
};

/** Try the ways of moving a service that need no repair of the machine, and say which one works. */
export function recoveryPath(config: Config): RecoveryPath {
  if (config.scenario.scoring !== "recovery")
    return { applicable: false, ok: true, note: "서비스가 없는 시나리오라 옮길 것이 없어요" };
  const s = open(config, ALL_TOOLS);
  const hurt = troubled(s);
  if (hurt.length === 0)
    return { applicable: true, ok: false, note: "시작할 때 멈추거나 느린 서비스가 없어요" };
  // a service that stands on pods has no standby and no VM of its own to move: the cluster's tools are its way back
  if (hurt.every((row) => standsOnCluster(s.world, row.id))) return layerPath(config);
  return moveService(s, hurt) ?? layerPath(config);
}

/** The ways back that are a layer's own tools: the database, the cluster, the overlay, and at last the team. */
function layerPath(config: Config): RecoveryPath {
  return (
    databasePath(config) ?? k8sPath(config) ?? overlayPath(config) ?? handOver(config) ?? NO_WAY
  );
}

/** Move the services to their standby, and failing that move their VMs; undefined when neither brings them back. */
function moveService(s: Session, hurt: readonly ServiceRow[]): RecoveryPath | undefined {
  for (const row of hurt) s.call("failover_service", { service: row.id });
  s.call("wait", { seconds: SETTLE_SECONDS });
  if (troubled(s).length === 0)
    return {
      applicable: true,
      ok: true,
      how: "failover_service",
      note: "서비스를 대기 쪽으로 옮기면 돌아와요",
    };
  if (migrateVms(s)) {
    s.call("wait", { seconds: SETTLE_SECONDS });
    if (troubled(s).length === 0)
      return {
        applicable: true,
        ok: true,
        how: "migrate_vm",
        note: "VM을 다른 서버로 옮기면 돌아와요",
      };
  }
  return undefined;
}

export interface CommonReach {
  /** Whether the equipment the answer names showed up in what the tools said. */
  readonly reached: boolean;
  /** Calls it spent (all it was allowed, when it did not get there). */
  readonly calls: number;
  /** The way, from where it started: "알람" → "장비 상세" … */
  readonly via: readonly string[];
}

/** How many calls the walker may spend following names: about what a person tries before asking someone. */
export const REACH_CALLS = 16;

const TOKEN = /[^\s"'`,;()[\]{}<>]+/g;

/** The ids of `known` that a tool's answer names, in the order they come. */
function namesIn(data: unknown, known: ReadonlySet<string>): string[] {
  const text = JSON.stringify(data) ?? "";
  return [...new Set((text.match(TOKEN) ?? []).filter((t) => known.has(t)))];
}

/** Where a name was first seen: by which tool, and while looking at which other name. */
interface Seen {
  readonly tool: string;
  readonly from?: string;
}

/** The blocks that only shape the story; any other block puts something wrong into the world. */
const STORY_BLOCKS: ReadonlySet<string> = new Set([
  "start",
  "wait",
  "wait_until",
  "branch",
  "random",
  "note",
  "agent_task",
]);
const hasIncident = (scenario: ScenarioDoc) =>
  scenario.nodes.some((n) => !STORY_BLOCKS.has(n.type));

/**
 * Whether the equipment the scenario's answer names can be reached with the common tools; `undefined` for a scenario
 * that asks for no diagnosis, or is a task and not an incident, where there is no cause to reach.
 */
export function commonReach(config: Config): CommonReach | undefined {
  const answers = config.scenario.expectations.flatMap((e) =>
    e.kind === "diagnosis" ? e.rootCause : [],
  );
  if (answers.length === 0 || !hasIncident(config.scenario)) return undefined;
  const common = TOOL_SPECS.filter((t) => t.realism === "common").map((t) => t.name);
  const s = open(config, common);
  const known = new Set(config.blueprint.entities.map((e) => e.id));
  const seen = new Map<string, Seen>();
  const queue: string[] = [];
  let calls = 0;
  // `scan` picks what of the answer counts as evidence: a service that is fine says nothing about the trouble
  const look = (
    tool: string,
    args: Record<string, unknown>,
    from?: string,
    scan: (data: unknown) => unknown = (data) => data,
  ) => {
    calls++;
    const r = s.call(tool, args);
    for (const id of r.ok ? namesIn(scan(r.data), known) : [])
      if (!seen.has(id)) {
        seen.set(id, { tool, ...(from ? { from } : {}) });
        queue.push(id);
      }
    return r;
  };
  look("list_alarms", {});
  const listed = look("list_services", {}, undefined, (data) =>
    (data as ServiceRow[]).filter((r) => r.status !== "healthy"),
  );
  const services = new Set(((listed.data as ServiceRow[] | undefined) ?? []).map((r) => r.id));
  const found = () => answers.find((a) => seen.has(a));
  while (queue.length > 0 && calls < REACH_CALLS && !found()) {
    const id = queue.shift() as string;
    if (services.has(id)) look("service_status", { service: id }, id);
    else look("get_entity", { id }, id);
  }
  const hit = found();
  const via: string[] = [];
  for (let at = hit; at !== undefined; at = seen.get(at)?.from)
    via.unshift(seen.get(at)?.tool ?? "");
  return { reached: hit !== undefined, calls, via };
}
