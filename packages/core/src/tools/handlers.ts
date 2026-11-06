/** Tool implementations over a world port and the protocol facades. */
import type {
  BacnetRequest,
  FacadeRequest,
  Facades,
  Method,
  SnmpRequest,
} from "@terrarium/core/facades";
import { InvalidValueError, NotFoundError, round } from "@terrarium/core/kernel";
import {
  bulkOf,
  type Entity,
  type EntityState,
  type LinkKind,
  reportedInletC,
  type WorldPort,
} from "@terrarium/core/world";
import { OPS_HANDLERS, type OpsPort } from "./handlers-ops";
import { SERVICE_HANDLERS } from "./handlers-service";
import { type Runbook, searchRunbooks } from "./runbook";

export interface MetricSource {
  /** Samples [t, value] of `metric` on `entityId` since simulated time `sinceT`. */
  series(entityId: string, metric: string, sinceT: number): Array<[number, number]>;
}

export interface Diagnosis {
  readonly rootCause: string;
  readonly faultType: string;
  readonly summary: string;
  readonly actions: readonly string[];
  readonly confidence?: number;
}

export interface ToolContext {
  readonly world: WorldPort;
  /** Protocol endpoints, built by the session with the experiment's product versions. */
  readonly facades: Facades;
  readonly metrics?: MetricSource;
  /** Lets simulated time pass; sessions advance the world when this is called. */
  readonly wait?: (seconds: number) => void;
  /** Receives the agent's final answer. */
  readonly submit?: (diagnosis: Diagnosis) => void;
  /** The runbooks an agent can find with `search_runbooks` (ADR-0087 item 6); none when the experiment gives none. */
  readonly runbooks?: readonly Runbook[];
  /** Handing work over to another team and keeping tickets (REQ-093); the session provides it. */
  readonly ops?: OpsPort;
}

export type Args = Readonly<Record<string, unknown>>;
type Handler = (ctx: ToolContext, args: Args) => unknown;

const str = (args: Args, key: string): string => String(args[key] ?? "");
const entityOf = (ctx: ToolContext, id: string): Entity => ctx.world.index.entity(id);

/** Human-readable location such as "site > bldg > fl1 > hall > rack-a". */
export function locationPath(ctx: ToolContext, id: string): string {
  return [...ctx.world.index.ancestors(id)]
    .reverse()
    .map((e) => e.name)
    .concat(entityOf(ctx, id).name)
    .join(" > ");
}

/**
 * The state as monitoring observes it. Agents see what sensors report; only the oracle sees the
 * truth. So a drifting inlet sensor shows its (wrong) reading here too.
 */
export function observedState(ctx: ToolContext, id: string): EntityState {
  const state = ctx.world.stateOf(id);
  return state.kind === "server" ? { ...state, inletC: reportedInletC(ctx.world, id) } : state;
}

/** State with numbers rounded, for agents to read. */
export function summarizeState(state: EntityState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (key === "kind") continue;
    out[key] =
      typeof value === "number"
        ? round(value, 2)
        : Array.isArray(value)
          ? value.map((v) => (typeof v === "number" ? Math.round(v) : v))
          : value;
  }
  return out;
}

const listAlarms: Handler = (ctx, args) => {
  const rank = { critical: 0, warning: 1 } as const;
  return ctx.world
    .alarms()
    .filter(
      (a) =>
        (args.severity === undefined || a.severity === args.severity) &&
        (args.entityId === undefined || a.entityId === args.entityId) &&
        (args.kind === undefined || a.kind === args.kind),
    )
    .sort(
      (a, b) =>
        rank[a.severity] - rank[b.severity] || a.since - b.since || a.id.localeCompare(b.id),
    )
    .map((a) => ({
      entityId: a.entityId,
      code: a.code,
      ...(a.kind ? { kind: a.kind } : {}),
      severity: a.severity,
      message: a.message,
      since: a.since,
    }));
};

const listEntities: Handler = (ctx, args) => {
  const pool = args.under ? ctx.world.index.descendants(str(args, "under")) : ctx.world.index.all();
  return pool
    .filter((e) => args.kind === undefined || e.kind === args.kind)
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      name: e.name,
      model: e.modelId ?? null,
      health: ctx.world.stateOf(e.id).health,
    }));
};

function connections(ctx: ToolContext, id: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (key: string, value: string) => {
    out[key] = [...(out[key] ?? []), value];
  };
  for (const link of ctx.world.index.outgoing(id)) add(`${link.kind}_to`, link.to);
  for (const link of ctx.world.index.incoming(id)) add(`${link.kind}_from`, link.from);
  return out;
}

/** A light rack holds no servers as entities; say what stands in it so nobody looks for them. */
function inventoryOf(ctx: ToolContext, entity: Entity): Record<string, unknown> {
  const light = bulkOf(entity);
  if (!light) return {};
  const model = ctx.world.catalog.getOf(light.modelId, "server");
  return {
    inventory: {
      servers: light.servers,
      model: model.name,
      meanCpuUtil: round(ctx.world.stateAs(entity.id, "rack").util, 2),
      note: "묶음 랙이라 서버를 개별 장비로 두지 않고 대수로 센다. 서버별 BMC·상태 조회는 되지 않는다.",
    },
  };
}

const getEntity: Handler = (ctx, args) => {
  const entity = entityOf(ctx, str(args, "id"));
  return {
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    model: entity.modelId ? ctx.world.catalog.get(entity.modelId).name : null,
    location: locationPath(ctx, entity.id),
    children: ctx.world.index.childrenOf(entity.id).map((c) => c.id),
    ...inventoryOf(ctx, entity),
    connections: connections(ctx, entity.id),
    state: summarizeState(observedState(ctx, entity.id)),
    alarms: ctx.world
      .alarms()
      .filter((a) => a.entityId === entity.id)
      .map((a) => a.message),
  };
};

const getTopology: Handler = (ctx, args) => {
  const start = entityOf(ctx, str(args, "id")).id;
  const depth = Math.min(Math.max(Number(args.depth ?? 2), 1), 4);
  const seen = new Set([start]);
  const edges = new Map<string, { kind: LinkKind | "contains"; from: string; to: string }>();
  let frontier = [start];
  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const link of [...ctx.world.index.outgoing(id), ...ctx.world.index.incoming(id)]) {
        edges.set(link.id, { kind: link.kind, from: link.from, to: link.to });
        for (const other of [link.from, link.to])
          if (!seen.has(other)) {
            seen.add(other);
            next.push(other);
          }
      }
    }
    frontier = next;
  }
  const nodes = [...seen].sort().map((id) => ({
    id,
    kind: entityOf(ctx, id).kind,
    name: entityOf(ctx, id).name,
    health: ctx.world.stateOf(id).health,
  }));
  return { nodes, edges: [...edges.values()] };
};

/**
 * Everything that may stop working if `id` fails, following the same cascade as the physics: a lost
 * container loses its contents, a lost power or network supplier loses its consumers (and theirs),
 * a lost host loses its VMs, and a lost cooling unit puts its racks at risk and overheats the servers
 * in them. Redundant feeds are ignored, so this is the worst case.
 */
export function dependents(ctx: ToolContext, id: string): string[] {
  const index = ctx.world.index;
  const out = new Set<string>();
  const expanded = new Set<string>([id]);
  const queue = [id];
  const fails = (other: string) => {
    out.add(other);
    if (!expanded.has(other)) {
      expanded.add(other);
      queue.push(other);
    }
  };
  for (let node = queue.pop(); node !== undefined; node = queue.pop()) {
    for (const child of index.childrenOf(node)) fails(child.id);
    for (const link of index.incoming(node)) {
      if (PROPAGATES.has(link.kind)) fails(link.from);
      else if (link.kind === "cooling") coolingLost(ctx, link.from, out, fails);
    }
  }
  out.delete(id);
  return [...out].sort();
}

/** Links along which a failure travels from the supplier (`to`) to the consumer (`from`). */
const PROPAGATES: ReadonlySet<LinkKind> = new Set<LinkKind>([
  "power",
  "network",
  "runs_on",
  "stored_on",
  "backed_by",
]);

/**
 * `consumer` lost what cools it. A rack is at risk, and only its servers actually shut down from heat;
 * a CDU or a chilled-water unit whose plant is lost stops cooling what hangs on it, which this follows.
 */
function coolingLost(
  ctx: ToolContext,
  consumer: string,
  out: Set<string>,
  fails: (id: string) => void,
) {
  if (ctx.world.index.entity(consumer).kind !== "rack") {
    fails(consumer);
    return;
  }
  out.add(consumer);
  for (const device of ctx.world.index.descendants(consumer))
    if (device.kind === "server") fails(device.id);
}

/** What cools a device: a server's rack relies on cooling units or CDUs, and those rely on a plant. */
function coolingOf(ctx: ToolContext, id: string): string[] {
  const index = ctx.world.index;
  const entity = index.entity(id);
  const kind = entity.kind;
  // A light rack stands for its servers, so it relies on the cooling they would.
  if (kind === "cdu" || kind === "cooling_unit" || bulkOf(entity))
    return index.outgoing(id, "cooling").map((l) => l.to);
  if (kind !== "server") return [];
  const rack = index.enclosing(id, "rack");
  return rack ? index.outgoing(rack.id, "cooling").map((l) => l.to) : [];
}

/** What `id` needs in order to work: the exact inverse of `dependents` for non-container entities. */
export function dependencies(ctx: ToolContext, id: string): string[] {
  const out = new Set<string>();
  const queue = [id];
  for (let node = queue.pop(); node !== undefined; node = queue.pop()) {
    const needs = ctx.world.index
      .outgoing(node)
      .filter((l) => PROPAGATES.has(l.kind))
      .map((l) => l.to)
      .concat(coolingOf(ctx, node));
    for (const other of needs)
      if (other !== id && !out.has(other)) {
        out.add(other);
        queue.push(other);
      }
  }
  return [...out].sort();
}

const getImpact: Handler = (ctx, args) => {
  const id = entityOf(ctx, str(args, "id")).id;
  return { id, dependents: dependents(ctx, id), dependencies: dependencies(ctx, id) };
};

const queryMetrics: Handler = (ctx, args) => {
  if (!ctx.metrics) throw new InvalidValueError("metrics are not recorded in this session");
  const id = entityOf(ctx, str(args, "id")).id;
  const window = Number(args.lastSeconds ?? 1800);
  const points = ctx.metrics.series(id, str(args, "metric"), ctx.world.time() - window);
  if (points.length === 0)
    throw new NotFoundError(`no samples of '${str(args, "metric")}' for ${id}`);
  return { id, metric: args.metric, points: points.map(([t, v]) => [t, round(v, 2)]) };
};

const facilityStatus: Handler = (ctx, args) => {
  const rooms = ctx.world.index
    .ofKind("room")
    .filter((r) => args.roomId === undefined || r.id === args.roomId);
  return rooms.map((room) => {
    const inside = ctx.world.index.descendants(room.id);
    // Panels and UPSes often sit in an electrical room; what matters is that they feed this room.
    const feeding = inside.flatMap((e) => ctx.world.index.upstream(e.id, "power"));
    // The plant that takes the room's heat (CDUs, chillers) can stand in a plant room or the yard.
    const cooled = inside.flatMap((e) => ctx.world.index.upstream(e.id, "cooling"));
    const relevant = new Set([...inside.map((e) => e.id), ...feeding, ...cooled]);
    const pick = (kind: Entity["kind"]) =>
      [...relevant]
        .filter((id) => entityOf(ctx, id).kind === kind)
        .sort()
        .map((id) => ({
          id,
          name: entityOf(ctx, id).name,
          ...summarizeState(observedState(ctx, id)),
        }));
    return {
      room: room.id,
      name: room.name,
      ...summarizeState(observedState(ctx, room.id)),
      cooling: pick("cooling_unit"),
      cdus: pick("cdu"),
      chillers: pick("chiller"),
      panels: pick("power_panel"),
      pdus: pick("pdu"),
      ups: pick("ups"),
      generators: pick("generator"),
    };
  });
};

function facadeRequest(args: Args, path: string): FacadeRequest {
  return {
    method: str(args, "method").toUpperCase() as Method,
    path,
    query: (args.query as Record<string, string>) ?? {},
    headers: {},
    body: args.body,
  };
}

const redfishRequest: Handler = (ctx, args) =>
  ctx.facades.redfish.handle(str(args, "server"), facadeRequest(args, str(args, "path")));
const vcenterRequest: Handler = (ctx, args) =>
  ctx.facades.vcenter.handle(facadeRequest(args, str(args, "path")));
const vropsRequest: Handler = (ctx, args) =>
  ctx.facades.vrops.handle(facadeRequest(args, str(args, "path")));

const snmpRequest: Handler = (ctx, args) =>
  ctx.facades.snmp.handle(str(args, "device"), args as unknown as SnmpRequest);
const bacnetRequest: Handler = (ctx, args) => {
  const { value, relinquish, ...rest } = args;
  return ctx.facades.bacnet.handle(typeof args.device === "string" ? args.device : undefined, {
    ...rest,
    ...(relinquish === true ? { value: null } : value === undefined ? {} : { value }),
  } as unknown as BacnetRequest);
};

const networkCli: Handler = (ctx, args) => {
  const commands = args.commands;
  if (!Array.isArray(commands) || !commands.every((c) => typeof c === "string"))
    throw new InvalidValueError("'commands' must be a list of CLI lines");
  return ctx.facades.network.cli(str(args, "device"), {
    commands,
    configure: args.configure === true,
  });
};
const eapiRequest: Handler = (ctx, args) =>
  ctx.facades.network.eapi(str(args, "device"), args.body);
const nxapiRequest: Handler = (ctx, args) =>
  ctx.facades.network.nxapi(str(args, "device"), args.body);

const setSetpoint: Handler = (ctx, args) => {
  ctx.world.apply(
    { type: "setpoint.set", target: str(args, "unitId"), celsius: Number(args.celsius) },
    "tool:set_cooling_setpoint",
  );
  return { unitId: args.unitId, setpointC: Number(args.celsius) };
};

const restartCooling: Handler = (ctx, args) => {
  const id = str(args, "unitId");
  ctx.world.stateAs(id, "cooling_unit");
  ctx.world.apply({ type: "power.set", target: id, on: false }, "tool:restart_cooling_unit");
  ctx.world.apply({ type: "power.set", target: id, on: true }, "tool:restart_cooling_unit");
  const hardware = ctx.world.faultsOn(id).find((f) => f.type === "cooling_unit_failure");
  return hardware
    ? { unitId: id, restarted: false, message: "unit did not start: compressor fault reported" }
    : { unitId: id, restarted: true };
};

const resetBreaker: Handler = (ctx, args) => {
  ctx.world.apply({ type: "breaker.reset", target: str(args, "id") }, "tool:reset_breaker");
  return { id: args.id, reset: true };
};

const powerServer: Handler = (ctx, args) => {
  ctx.world.stateAs(str(args, "id"), "server");
  ctx.world.apply(
    { type: "power.set", target: str(args, "id"), on: args.action === "on" },
    "tool:power_server",
  );
  return { id: args.id, action: args.action };
};

const wait: Handler = (ctx, args) => {
  const seconds = Number(args.seconds);
  if (!(seconds >= 1 && seconds <= 3600))
    throw new InvalidValueError("seconds must be between 1 and 3600");
  if (!ctx.wait) throw new InvalidValueError("this session cannot advance time");
  ctx.wait(seconds);
  return { waited: seconds, now: ctx.world.time() };
};

const submitDiagnosis: Handler = (ctx, args) => {
  const actions = Array.isArray(args.actions) ? args.actions.map(String) : [];
  const diagnosis: Diagnosis = {
    rootCause: str(args, "rootCause"),
    faultType: str(args, "faultType"),
    summary: str(args, "summary"),
    actions,
    ...(typeof args.confidence === "number" ? { confidence: args.confidence } : {}),
  };
  ctx.submit?.(diagnosis);
  return { accepted: true };
};

/** What `ask_human` answers when called outside a session (a session answers it itself, see session.ts). */
export const NO_HUMAN_REPLY =
  "지금은 답해 줄 사람이 없어요. 가진 툴로 할 수 있는 만큼 하고 진단을 제출하세요.";

const askHuman: Handler = (_ctx, args) => {
  if (str(args, "request").trim() === "")
    throw new InvalidValueError("request must say what you need");
  return { reply: NO_HUMAN_REPLY, from: "none" };
};

const searchRunbooksTool: Handler = (ctx, args) => {
  const found = searchRunbooks(ctx.runbooks ?? [], str(args, "query"));
  return found.length === 0
    ? { runbooks: [], note: "No runbook is available." }
    : { runbooks: found.map((r) => ({ title: r.title, steps: r.steps })) };
};

export const HANDLERS: Readonly<Record<string, Handler>> = {
  ...SERVICE_HANDLERS,
  ...OPS_HANDLERS,
  list_alarms: listAlarms,
  list_entities: listEntities,
  get_entity: getEntity,
  get_topology: getTopology,
  get_impact: getImpact,
  query_metrics: queryMetrics,
  facility_status: facilityStatus,
  redfish_request: redfishRequest,
  vcenter_request: vcenterRequest,
  vrops_request: vropsRequest,
  snmp_request: snmpRequest,
  bacnet_request: bacnetRequest,
  network_cli: networkCli,
  eapi_request: eapiRequest,
  nxapi_request: nxapiRequest,
  set_cooling_setpoint: setSetpoint,
  restart_cooling_unit: restartCooling,
  reset_breaker: resetBreaker,
  power_server: powerServer,
  wait,
  submit_diagnosis: submitDiagnosis,
  ask_human: askHuman,
  search_runbooks: searchRunbooksTool,
};
