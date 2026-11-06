/**
 * What an operator does to a service or a VM (REQ-086, ADR-0091): move the service to its standby, restart it,
 * move a VM to another server. Like the other commands these are recorded as world events and change state only
 * through the reducers here.
 */
import { ConflictError, InvalidValueError } from "@terrarium/core/kernel";
import { actOnHost, type HostActContext } from "./host-os";
import { line, logTo, type OsProcess } from "./os";
import { serviceDef } from "./service";
import type { StateOf } from "./state";
import type { WorldReader } from "./world";

export type ServiceCommand =
  /** Run the service where its standby is, and leave its old places as the new standby. */
  | { readonly type: "service.failover"; readonly target: string }
  /** Restart the service's process on every place it runs. */
  | { readonly type: "service.restart"; readonly target: string }
  /** Move a VM to another server (live migration). */
  | { readonly type: "vm.migrate"; readonly target: string; readonly host: string };

/** Refuse commands that make no sense before they are recorded. */
export function checkServiceCommand(world: WorldReader, command: ServiceCommand): void {
  if (command.type === "vm.migrate") {
    const vm = world.stateAs(command.target, "vm");
    const host = world.stateAs(command.host, "server");
    const from = vm.hostId ?? world.index.outgoing(command.target, "runs_on")[0]?.to;
    if (from === command.host)
      throw new ConflictError(`'${command.target}' already runs on '${command.host}'`);
    if (!host.powered || !host.adminOn)
      throw new InvalidValueError(`'${command.host}' is off, so a VM cannot be moved to it`);
    return;
  }
  const state = world.stateAs(command.target, "service");
  if (command.type === "service.failover" && state.standby.length === 0)
    throw new InvalidValueError(`'${command.target}' has no standby to move to`);
}

/** Put the service's process on a host that already has an operating system state, or stop it there. */
function setProcess(
  state: StateOf<"server"> | StateOf<"vm">,
  name: string,
  running: boolean,
  t: number,
): void {
  const os = state.os;
  if (!os) return;
  const found = os.processes.find((p) => p.name === name);
  if (found) {
    found.state = running ? "running" : "stopped";
    delete found.until;
    if (!running) logTo(os, line(t, "systemd", "info", `Stopped ${name}.service.`));
    return;
  }
  if (!running) return;
  const created: OsProcess = {
    name,
    pid: 900 + os.processes.length * 53,
    user: "svc",
    state: "running",
    restarts: 0,
    w: 12,
    memPct: 9,
  };
  os.processes.push(created);
  logTo(os, line(t, "systemd", "info", `Started ${name}.service.`));
}

/** What the reducers read of the world: states by id, and the way to open a host's faults. */
export interface ServiceActContext {
  readonly world: WorldReader;
  readonly t: number;
  host(id: string): HostActContext;
}

/** Move the service to its standby. */
export function failover(ctx: ServiceActContext, id: string): void {
  const state = ctx.world.stateAs(id, "service");
  const process = serviceDef(ctx.world.index.entity(id)).process;
  const [from, to] = [state.runsOn, state.standby];
  for (const host of from)
    setProcess(ctx.world.stateOf(host) as StateOf<"vm">, process, false, ctx.t);
  for (const host of to) setProcess(ctx.world.stateOf(host) as StateOf<"vm">, process, true, ctx.t);
  state.runsOn = to;
  state.standby = from;
  state.failovers += 1;
}

/** Restart the process on every place the service runs. */
export function restartService(ctx: ServiceActContext, id: string): void {
  const state = ctx.world.stateAs(id, "service");
  const process = serviceDef(ctx.world.index.entity(id)).process;
  for (const host of state.runsOn) {
    const kind = ctx.world.stateOf(host).kind;
    if (kind === "server" || kind === "vm") actOnHost(ctx.host(host), "restart", process);
  }
}
