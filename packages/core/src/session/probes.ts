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
import { Session, type SessionConfig } from "./session";

type Config = Omit<SessionConfig, "tools" | "seed"> & { readonly seed?: number };

const SETTLE_SECONDS = 60;
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
  /** The tool that did it. */
  readonly how?: "failover_service" | "migrate_vm";
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

/** Try the ways of moving a service that need no repair of the machine, and say which one works. */
export function recoveryPath(config: Config): RecoveryPath {
  if (config.scenario.scoring !== "recovery")
    return { applicable: false, ok: true, note: "서비스가 없는 시나리오라 옮길 것이 없어요" };
  const s = open(config, ALL_TOOLS);
  const hurt = troubled(s);
  if (hurt.length === 0)
    return { applicable: true, ok: false, note: "시작할 때 멈추거나 느린 서비스가 없어요" };
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
  return {
    applicable: true,
    ok: false,
    note: "장비를 고치지 못해도 서비스를 옮길 수 있는 길(대기 쪽이나 다른 서버)이 없어요",
  };
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
