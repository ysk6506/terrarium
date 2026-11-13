/** The handlers of the service tools and the shell (REQ-086, REQ-087, ADR-0091). */
import { round } from "@terrarium/core/kernel";
import { hostVerdict, serviceDef, switchAlive, type WorldPort } from "@terrarium/core/world";
import type { Args, ToolContext } from "./handlers";
import { runShell } from "./shell";

type Handler = (ctx: ToolContext, args: Args) => unknown;

const str = (args: Args, key: string): string => String(args[key] ?? "");

function summary(world: WorldPort, id: string) {
  const e = world.index.entity(id);
  const s = world.stateAs(id, "service");
  const def = serviceDef(e);
  return {
    id,
    name: e.name,
    kind: def.kind,
    status: s.status,
    runsOn: s.runsOn,
    standby: s.standby,
    ...(def.queue ? { waiting: `${s.backlog.toLocaleString("en-US")}${def.queue.unit}` } : {}),
    ...(s.reasons.length > 0 ? { why: s.reasons[0] } : {}),
  };
}

const listServices: Handler = (ctx, args) =>
  ctx.world.index
    .ofKind("service")
    .filter((e) => {
      const s = ctx.world.stateAs(e.id, "service");
      return (
        (args.status === undefined || s.status === args.status) &&
        (args.kind === undefined || serviceDef(e).kind === args.kind)
      );
    })
    .map((e) => summary(ctx.world, e.id));

const serviceStatus: Handler = (ctx, args) => {
  const id = ctx.world.index.entity(str(args, "service")).id;
  const state = ctx.world.stateAs(id, "service");
  const def = serviceDef(ctx.world.index.entity(id));
  const place = (host: string) => {
    const v = hostVerdict(ctx.world, host, def);
    return {
      id: host,
      name: ctx.world.index.entity(host).name,
      state: v.state,
      ...(v.why ? { why: v.why } : {}),
    };
  };
  return {
    ...summary(ctx.world, id),
    since: state.since ?? null,
    slo: def.slo,
    cost: {
      ...(def.harm.perHourKrw !== undefined ? { perHourKrw: def.harm.perHourKrw } : {}),
      ...(def.harm.delayHours !== undefined ? { delayHours: def.harm.delayHours } : {}),
      estimate: def.harmEstimated,
      lostSoFarKrw: round(state.lostKrw, 0),
    },
    places: state.runsOn.map(place),
    standbyPlaces: state.standby.map(place),
    path: ctx.world.index.outgoing(id, "service_via").map((l) => ({
      switch: l.to,
      up: switchAlive(ctx.world, l.to),
    })),
    reasons: state.reasons,
  };
};

const failoverService: Handler = (ctx, args) => {
  const id = str(args, "service");
  const before = ctx.world.stateAs(id, "service");
  const [from, to] = [[...before.runsOn], [...before.standby]];
  ctx.world.apply({ type: "service.failover", target: id }, "tool:failover_service");
  return {
    service: id,
    from,
    to,
    note: "The old places are now the standby. Check service_status after a short wait.",
  };
};

const migrateVm: Handler = (ctx, args) => {
  const vm = str(args, "vm");
  const from = ctx.world.stateAs(vm, "vm").hostId ?? ctx.world.index.outgoing(vm, "runs_on")[0]?.to;
  ctx.world.apply({ type: "vm.migrate", target: vm, host: str(args, "host") }, "tool:migrate_vm");
  return { vm, from: from ?? null, to: args.host };
};

const restartService: Handler = (ctx, args) => {
  const id = str(args, "service");
  const hosts = [...ctx.world.stateAs(id, "service").runsOn];
  ctx.world.apply({ type: "service.restart", target: id }, "tool:restart_service");
  return { service: id, restartedOn: hosts, note: "The process is down for about 15 seconds." };
};

const runCommand: Handler = (ctx, args) => {
  const host = str(args, "host");
  const result = runShell(ctx.world, host, str(args, "cmd"), ctx.shell);
  return {
    host,
    cmd: args.cmd,
    exitCode: result.exitCode,
    output: result.output,
    stdout: result.stdout,
    stderr: result.stderr,
    outside: result.outside,
    gaps: result.gaps,
  };
};

export const SERVICE_HANDLERS: Readonly<Record<string, Handler>> = {
  list_services: listServices,
  service_status: serviceStatus,
  failover_service: failoverService,
  migrate_vm: migrateVm,
  restart_service: restartService,
  run_command: runCommand,
};
