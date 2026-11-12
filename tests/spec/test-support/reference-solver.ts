/**
 * The reference solver (REQ-110, ADR-0133): plays the canonical solution of a scenario's fault through the same tools an
 * agent has. It is allowed to know the truth (the fault the sheet injects, where, and what the sheet accepts as the
 * answer); it is not an agent, is registered nowhere, and exists so that the grader can be held to "the right solution
 * scores 100 and every wrong variant scores less". `operator` never sees any of this.
 */
import { Catalog } from "@terrarium/core/catalog";
import {
  REFERENCE_PATHS,
  REFERENCE_VARIANTS,
  type ReferencePath,
  type ReferenceStep,
} from "@terrarium/core/oracle";
import type { ScenarioDoc } from "@terrarium/core/scenario";
import { type RunResult, Session } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import {
  type Blueprint,
  BlueprintIndex,
  servicesOfWorkload,
  workloadsOfCluster,
} from "@terrarium/core/world";
import { namedServers, type Truth, truthOf } from "./reference-truth";

export { type Truth, truthOf };

/** A wrong way to play the path, for the soundness tests. */
export type Mutation =
  | { readonly kind: "skip_fix" }
  | { readonly kind: "wrong_target"; readonly decoy: string }
  | { readonly kind: "reverse_fix" }
  | { readonly kind: "worsen"; readonly victim: string }
  | { readonly kind: "wrong_root" }
  | { readonly kind: "wrong_type" }
  | { readonly kind: "too_slow"; readonly seconds: number };

export interface Solved {
  readonly result: RunResult;
  readonly calls: ReadonlyArray<{ name: string; args: Record<string, unknown>; ok: boolean }>;
  readonly truth: Truth;
  readonly path: ReferencePath;
}

/** What the sheet's block, and the switch's configuration the solver has read, give to a step's arguments. */
interface Bind {
  readonly target: string;
  readonly params: Readonly<Record<string, string>>;
  readonly config: string;
  readonly index: BlueprintIndex;
  readonly alarms: ReadonlyArray<{ entityId: string; code: string }>;
  /** The data the last call of each tool returned. */
  readonly last: Readonly<Record<string, unknown>>;
}

/** Entities of a kind by id: `{nth:db_instance:1}` is the second one. */
const nth = (b: Bind, kind: string, i: number): string =>
  [...b.index.ofKind(kind as never)].map((e) => e.id).sort()[i] ?? "";

/** The other entity of the target's kind, for a path that moves to the one that still works. */
function sibling(b: Bind): string {
  const kind = b.index.find(b.target)?.kind;
  return kind
    ? ([...b.index.ofKind(kind)]
        .map((e) => e.id)
        .sort()
        .find((id) => id !== b.target) ?? "")
    : "";
}

/**
 * `{@tool/key/key=value/-1/key}`: a value out of the data the last call of `tool` returned. A segment is a key, an index
 * (negative from the end), `k=v` (the first element whose `k` is `v`) or `k!=v` (the first whose is not).
 */
function pick(b: Bind, spec: string, fill: (s: string) => string): string {
  const [tool, ...segs] = spec.split("/");
  let cur: unknown = b.last[tool as string];
  for (const raw of segs) {
    const seg = fill(raw);
    const m = /^(\w+)(!?=)(.*)$/.exec(seg);
    if (m && Array.isArray(cur)) {
      cur = cur.find(
        (x) => (String((x as Record<string, unknown>)[m[1] as string]) === m[3]) === (m[2] === "="),
      );
    } else if (/^-?\d+$/.test(seg) && Array.isArray(cur)) {
      cur = cur.at(Number(seg));
    } else cur = (cur as Record<string, unknown> | undefined)?.[seg];
  }
  return typeof cur === "string" || typeof cur === "number" ? String(cur) : "";
}

/** The server a fault sits on: the target itself, or the server end of a cable. */
function serverOf(b: Bind): string {
  const link = b.index.allLinks().find((l) => l.id === b.target);
  if (!link) return b.target;
  return [link.from, link.to].find((id) => b.index.find(id)?.kind === "server") ?? b.target;
}

/** A workload of the target's cluster that no service waits on: the one that can give up its room. */
function idleWorkload(b: Bind): string {
  return (
    workloadsOfCluster(b.index, b.target)
      .filter((w) => servicesOfWorkload(b.index, w.id).length === 0)
      .map((w) => w.id)
      .sort()[0] ?? ""
  );
}

/** The first VM that runs on that server. */
const vmOn = (b: Bind): string => b.index.incoming(serverOf(b), "runs_on")[0]?.from ?? "";

/** Another server to move a VM to. */
const spareFor = (b: Bind): string =>
  [...b.index.ofKind("server")]
    .map((e) => e.id)
    .sort()
    .find((id) => id !== serverOf(b)) ?? "";

/**
 * Where a VM is moved to keep its service alive: the server the service's standby stands on (the host of a standby VM),
 * else another server.
 */
function havenFor(b: Bind): string {
  const standby = pick(b, "service_status/standby/0", (x) => x);
  const host =
    b.index.find(standby)?.kind === "vm" ? b.index.outgoing(standby, "runs_on")[0]?.to : standby;
  return host && b.index.find(host)?.kind === "server" ? host : spareFor(b);
}

/** The nearest machine (a VM, else a server) the target runs on, following `hosted_on`/`runs_on` upward. */
function machineOf(b: Bind): string {
  let id = b.target;
  for (let i = 0; i < 6; i++) {
    const kind = b.index.find(id)?.kind;
    if (i > 0 && (kind === "vm" || kind === "server")) return id;
    const up = b.index.outgoing(id, "hosted_on")[0] ?? b.index.outgoing(id, "runs_on")[0];
    if (!up) return id;
    id = up.to;
  }
  return id;
}

/**
 * The interface of the switch whose description names the peer, in the configuration just read. A switch describes a port
 * by the name of the device cabled to it, which some worlds spell as the id and some as the display name.
 */
function portIn(config: string, peer: readonly string[]): string {
  const blocks = config.split(/\n(?=interface )/);
  const literal = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mine = blocks.find((b) =>
    peer.some((p) => new RegExp(`description ${literal(p)}\\b`).test(b)),
  );
  return /^interface (\S+)/.exec(mine ?? "")?.[1] ?? "";
}

/** The neighbor whose own section says `shutdown` (NX-OS), or "". */
function nxShutNeighbor(config: string): string {
  let neighbor = "";
  for (const line of config.split("\n")) {
    const found = /^\s+neighbor (\S+)\s*$/.exec(line);
    if (found) neighbor = found[1] as string;
    else if (neighbor && /^\s+shutdown\s*$/.test(line)) return neighbor;
  }
  return "";
}

function routeCmd(route: string | undefined): string {
  const m = /^(\S+\/\d+) via (\S+)$/.exec(route ?? "");
  return m ? `${m[1]} ${m[2]}` : "";
}

interface CapRow {
  id: string;
  idleW: number;
  maxW: number;
}
const capRacks = (b: Bind) =>
  (b.last.power_cap_status as { racks?: Array<{ limitW: number; servers: CapRow[] }> } | undefined)
    ?.racks ?? [];

/** An even share of the rack limit, a little under it so the rack ends inside. */
function rackShare(b: Bind): number {
  const rack = capRacks(b).find((r) => r.servers.some((s) => s.id === b.target));
  return rack ? Math.floor((rack.limitW - 350) / rack.servers.length) : 0;
}

/** A cap a tenth of the way from idle to maximum: the heat falls far enough that a room with no cooling keeps its servers up. */
function lowCap(b: Bind): number {
  const row = capRacks(b)
    .flatMap((r) => r.servers)
    .find((s) => s.id === nodeOf(b));
  return row ? Math.floor(row.idleW + (row.maxW - row.idleW) / 10) : 0;
}

const CATALOG = new Catalog();

/** The lowest setpoint the cooling unit the sheet wants turned down allows: its model says where it stops. */
function minSetpoint(t: Truth, b: Bind): number {
  const model = CATALOG.getOf(b.index.find(t.required)?.modelId ?? "", "cooling_unit");
  return model.minSetpointC;
}

/** The replicas a pool can run, as the job status says. */
function poolReplicas(b: Bind): number {
  const p = b.last.job_status as { pools?: Array<{ id: string; capacity?: number }> } | undefined;
  return p?.pools?.find((x) => x.id === b.target)?.capacity ?? 0;
}

/** The GPU server a GPU, NVLink domain or fabric link stands in. */
const nodeOf = (b: Bind): string => String(b.index.find(b.target)?.props.server ?? b.target);

const fillString = (s: string, t: Truth, b: Bind): string =>
  s
    .replaceAll("{target}", b.target)
    .replaceAll("{sibling}", sibling(b))
    .replaceAll("{host}", machineOf(b))
    .replaceAll("{vmOn}", vmOn(b))
    .replaceAll("{spare}", spareFor(b))
    .replaceAll("{haven}", () => havenFor(b))
    .replaceAll("{idle}", () => idleWorkload(b))
    .replaceAll(/\{@([^}]+)\}/g, (_, spec: string) =>
      pick(b, spec, (x) => x.replaceAll("{target}", b.target)),
    )
    .replaceAll(/\{nth:(\w+):(\d+)\}/g, (_, k: string, i: string) => nth(b, k, Number(i)))
    .replaceAll(
      /\{alarm:(\w+)\}/g,
      (_, c: string) => b.alarms.find((a) => a.code.split(".")[0] === c)?.entityId ?? "",
    )
    .replaceAll("{peer}", b.params.peer ?? t.peer)
    .replaceAll("{port}", () => {
      const peer = b.params.peer ?? t.peer;
      return portIn(b.config, [peer, b.index.find(peer)?.name ?? peer]);
    })
    .replaceAll("{vlan}", /^vlan (\d+)/m.exec(b.config)?.[1] ?? "")
    .replaceAll("{asn}", /^router bgp (\d+)/m.exec(b.config)?.[1] ?? "")
    .replaceAll("{shutNeighbor}", /neighbor (\S+) shutdown/.exec(b.config)?.[1] ?? "")
    .replaceAll("{nxShutNeighbor}", () => nxShutNeighbor(b.config))
    .replaceAll("{routeCmd}", routeCmd(b.params.route))
    .replaceAll(/\{p\.(\w+)\}/g, (_, k: string) => b.params[k] ?? "")
    .replaceAll("{node}", nodeOf(b))
    .replaceAll("{rackShare}", () => String(rackShare(b)))
    .replaceAll("{lowCap}", () => String(lowCap(b)))
    .replaceAll("{poolReplicas}", () => String(poolReplicas(b)))
    .replaceAll("{minSetpoint}", () => String(minSetpoint(t, b)))
    .replaceAll("{service}", t.service)
    .replaceAll("{required}", t.required)
    .replaceAll("{answer}", t.answerRoot);

const NUMERIC = /^\{(rackShare|lowCap|poolReplicas|minSetpoint)\}$/;

function fillValue(v: unknown, t: Truth, b: Bind): unknown {
  if (typeof v === "string")
    return NUMERIC.test(v) ? Number(fillString(v, t, b)) : fillString(v, t, b);
  if (Array.isArray(v)) return v.map((x) => fillValue(x, t, b));
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillValue(x, t, b)]));
  return v;
}

function fillArgs(step: ReferenceStep, t: Truth, b: Bind): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(step.args ?? {}).map(([k, v]) => [k, fillValue(v, t, b)]),
  );
}

/** Servers a path may shed: all but the ones the sheet keeps. The solver is handed the world's servers. */
export interface Play {
  servers?: readonly string[];
  /** The last configuration a switch printed, which `{port}`, `{vlan}`, `{asn}` are read from. */
  config: string;
  index: BlueprintIndex;
  alarms: Array<{ entityId: string; code: string }>;
  last: Record<string, unknown>;
  call(
    tool: string,
    args?: Record<string, unknown>,
  ): { ok: boolean; data?: unknown; error?: string };
}

/** The steps of one list, with `forEach` opened into one step per block (or per critical server). */
function expand(
  steps: readonly ReferenceStep[],
  t: Truth,
  run: Play,
): Array<[ReferenceStep, Bind]> {
  const base: Bind = {
    target: t.target,
    params: t.nodes[0]?.params ?? {},
    config: "",
    index: run.index,
    alarms: run.alarms,
    last: run.last,
  };
  return steps.flatMap((s): Array<[ReferenceStep, Bind]> => {
    if (s.later) return [[s, base]];
    if (s.forEach === "targets") return t.nodes.map((n) => [s, { ...base, ...n }]);
    if (s.forEach === "critical") return t.critical.map((x) => [s, { ...base, target: x }]);
    if (s.forEach === "required") return t.requiredAll.map((x) => [s, { ...base, target: x }]);
    if (s.forEach === "servers") return t.servers.map((x) => [s, { ...base, target: x }]);
    if (s.forEach?.startsWith("alarm:")) {
      const code = s.forEach.slice(6);
      return run.alarms
        .filter((a) => a.code.split(".")[0] === code)
        .map((a) => [s, { ...base, target: a.entityId }]);
    }
    return [[s, base]];
  });
}

function runSteps(run: Play, steps: Array<[ReferenceStep, Bind]>, t: Truth, strict: boolean): void {
  for (const [s, bind] of steps) {
    if (
      s.when !== undefined &&
      fillString(s.when, t, { ...bind, config: run.config, last: run.last }) === ""
    )
      continue;
    if (s.later) {
      // the entities are the ones that have the alarm now, after the steps before this one
      const { later: _, ...now } = s;
      runSteps(run, expand([now], t, run), t, strict);
      continue;
    }
    if (s.tool === "group") {
      runSteps(
        run,
        (s.group ?? []).map(
          (g) => [g, { ...bind, alarms: run.alarms, last: run.last }] as [ReferenceStep, Bind],
        ),
        t,
        strict,
      );
      continue;
    }
    if (s.tool === "wait_eta") {
      const eta = (run.last.dr_failover as { etaSeconds?: number } | undefined)?.etaSeconds ?? 0;
      const part = String(s.args?.part);
      const total =
        part === "half"
          ? Math.ceil(eta / 2) + 15
          : part === "rest"
            ? Math.floor(eta / 2) + 30
            : eta + 30;
      for (let left = total; left > 0; left -= 3600)
        run.call("wait", { seconds: Math.min(left, 3600) });
      continue;
    }
    if (s.tool === "until_team_done") {
      let cursor = 0;
      for (let i = 0; i < 220; i++) {
        run.call("wait", { seconds: 3600 });
        const news = run.call("events_since", { cursor }).data as
          | { cursor: number; events: Array<{ type: string }> }
          | undefined;
        cursor = news?.cursor ?? cursor;
        if (news?.events.some((e) => e.type === "done")) break;
      }
      continue;
    }
    if (s.tool === "shed") {
      for (const id of shedable(run, t))
        if (!t.critical.includes(id)) run.call("power_server", { id, action: "off" });
      continue;
    }
    const r = run.call(
      s.tool,
      fillArgs(s, t, { ...bind, config: run.config, alarms: run.alarms, last: run.last }),
    );
    if (s.tool === "network_cli" && r.ok) run.config = outputOf(r.data);
    if (r.ok) run.last[s.tool] = r.data;
    if (s.tool === "list_alarms" && r.ok) run.alarms = r.data as typeof run.alarms;
    if (!r.ok && strict && !s.refused) throw new Error(`${t.key}: ${s.tool} failed: ${r.error}`);
  }
}

/**
 * The servers an operator switches off to bring a UPS under its limit: the ones its power runs through, not every server
 * of the world. A sheet that names no UPS leaves the choice to the whole world.
 */
function shedable(run: Play, t: Truth): string[] {
  if (!t.loadedUps) return [...(run.servers ?? [])];
  const out: string[] = [];
  const seen = new Set<string>([t.loadedUps]);
  for (let queue = [t.loadedUps]; queue.length > 0; ) {
    const next: string[] = [];
    for (const to of queue)
      for (const l of run.index.incoming(to, "power")) {
        if (seen.has(l.from)) continue;
        seen.add(l.from);
        (run.index.entity(l.from).kind === "server" ? out : next).push(l.from);
      }
    queue = next;
  }
  // the sheet asks for one shed at least: when only the kept servers stand behind the UPS, any other server will do
  return out.some((id) => !t.critical.includes(id)) ? out.sort() : [...(run.servers ?? [])];
}

/** The text a switch command printed. */
function outputOf(data: unknown): string {
  const steps = (data as { steps?: Array<{ output?: string }> } | undefined)?.steps ?? [];
  return steps.map((x) => x.output ?? "").join("\n");
}

/** The path the world calls for, when the path leaves it to a read (a site's mode). */
function choose(run: Play, path: ReferencePath, truth: Truth): ReferencePath {
  if (!path.choose) return path;
  const base: Bind = {
    target: truth.target,
    params: {},
    config: "",
    index: run.index,
    alarms: run.alarms,
    last: run.last,
  };
  const step = path.choose.read;
  const r = run.call(step.tool, fillArgs(step, truth, base));
  if (r.ok) run.last[step.tool] = r.data;
  if (step.tool === "list_alarms" && r.ok) run.alarms = r.data as typeof run.alarms;
  const key = fillString(path.choose.at, truth, { ...base, last: run.last });
  return path.choose.cases[key] ?? path;
}

/** The server the service runs on (asked of the service list like any agent would, then followed down to a server). */
function serverUnder(run: Play, service: string): string {
  const rows = (run.call("list_services").data ?? []) as Array<{ id: string; runsOn?: string[] }>;
  let id = (rows.find((r) => r.id === service) ?? rows[0])?.runsOn?.[0] ?? "";
  for (let i = 0; i < 6 && id; i++) {
    if (run.index.find(id)?.kind === "server") return id;
    id = (run.index.outgoing(id, "runs_on")[0] ?? run.index.outgoing(id, "hosted_on")[0])?.to ?? "";
  }
  // a world with no service listed: any server will do
  return run.index.find(id)?.kind === "server"
    ? id
    : ([...run.index.ofKind("server")]
        .map((e) => e.id)
        .sort()
        .at(-1) ?? "");
}

/** Play the path of a sheet on a session that has started. */
export function play(
  run: Play,
  doc: ScenarioDoc,
  mutation?: Mutation,
): { truth: Truth; path: ReferencePath } {
  const truth = { ...truthOf(doc), servers: namedServers(doc, run.servers ?? []) };
  const path = REFERENCE_VARIANTS[doc.template ?? doc.id] ?? REFERENCE_PATHS[truth.key];
  if (!path) throw new Error(`no reference path for ${truth.key}`);
  const chosen = choose(run, path, truth);
  runSteps(run, expand(chosen.diagnose, truth, run), truth, true);
  if (mutation?.kind === "too_slow")
    for (let left = mutation.seconds; left > 0; left -= 3600)
      run.call("wait", { seconds: Math.min(left, 3600) });
  let fix = expand(chosen.fix, truth, run);
  if (mutation?.kind === "skip_fix") fix = [];
  if (mutation?.kind === "reverse_fix") fix = [...fix].reverse();
  if (mutation?.kind === "wrong_target")
    fix = fix.map(([s, b]) => [s, { ...b, target: mutation.decoy }]);
  if (!chosen.handsOff || mutation) runSteps(run, fix, truth, !mutation);
  if (mutation?.kind === "worsen")
    run.call("power_server", {
      id: mutation.victim || serverUnder(run, truth.service),
      action: "off",
    });
  for (let left = chosen.settleS ?? 60; left > 0; left -= 3600)
    run.call("wait", { seconds: Math.min(left, 3600) });
  runSteps(run, expand(chosen.verify, truth, run), truth, false);
  run.call("submit_diagnosis", {
    rootCause: mutation?.kind === "wrong_root" ? "no-such-entity" : truth.answerRoot,
    faultType:
      mutation?.kind === "wrong_type"
        ? truth.answerType === "disk_failure"
          ? "fan_failure"
          : "disk_failure"
        : truth.answerType,
    summary: "정답 풀이",
  });
  return { truth, path: chosen };
}

/** Play a sheet in a world with the reference solution (or a wrong variant of it) and return the scored run. */
export function solve(
  blueprint: Blueprint,
  doc: ScenarioDoc,
  mutation?: Mutation,
  seed = 1,
  beforeCall?: () => void,
): Solved {
  const session = Session.create({ blueprint, scenario: doc, tools: TOOL_NAMES, seed });
  session.start();
  const calls: Solved["calls"][number][] = [];
  const run: Play = {
    config: "",
    index: new BlueprintIndex(blueprint),
    alarms: [],
    last: {},
    servers: new BlueprintIndex(blueprint).ofKind("server").map((e) => e.id),
    call: (tool, args = {}) => {
      beforeCall?.();
      const r = session.call(tool, args);
      calls.push({ name: tool, args, ok: r.ok });
      return r;
    },
  };
  const { truth, path } = play(run, doc, mutation);
  return { result: session.finish(), calls, truth, path };
}
