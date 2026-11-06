/**
 * Reading and changing the operating system of a host (REQ-087, ADR-0091). `hostOsOf` is what the shell and the
 * services read: the host's stored state, or the healthy one it would have. The three operator changes
 * (restart a process, free disk, remount, reboot) are `host.act`; they are applied here to the state the world
 * hands over, together with the faults they can clear.
 */
import type { Entity } from "./blueprint";
import type { Fault, FaultType } from "./faults";
import {
  baselineOs,
  type HostOs,
  line,
  logTo,
  memoryOf,
  type OsProcess,
  pidOf,
  processNamed,
} from "./os";
import { archiveBytes, archivePaths, bytesAt, ROOT_BYTES } from "./os/layout";
import { CNI_PROCESS, INGRESS_PROCESS, SDN_PROCESS } from "./sdn";
import { serviceDef } from "./service";
import type { EntityState } from "./state";
import type { WorldReader } from "./world";

export type HostAction =
  | "restart"
  | "free_disk"
  | "remount_rw"
  | "reboot"
  | "stop"
  | "start"
  | "enable"
  | "disable"
  | "kill"
  | "remove"
  | "write"
  | "truncate";

export const HOST_ACTIONS: readonly HostAction[] = [
  "restart",
  "free_disk",
  "remount_rw",
  "reboot",
  "stop",
  "start",
  "enable",
  "disable",
  "kill",
  "remove",
  "write",
  "truncate",
];

/** Seconds a process takes to come back after `systemctl restart`. */
export const RESTART_SECONDS = 15;
/** Seconds a host is down for `reboot`. */
export const HOST_REBOOT_SECONDS = 120;
/** How much disk a clean-up of old logs frees, percentage points. */
export const FREED_PCT = 35;

/** The process of a database instance, as `systemctl` names it. */
export const DB_PROCESS = "postgresql";

export const isHost = (kind: string): boolean => kind === "server" || kind === "vm";

/** The services that run on a host now (by their state, so a failover is followed). */
export function servicesOnHost(world: WorldReader, hostId: string): Entity[] {
  return world.index
    .incoming(hostId, "service_on")
    .map((l) => l.from)
    .filter((id) => world.stateAs(id, "service").runsOn.includes(hostId))
    .map((id) => world.index.entity(id));
}

function cpuOf(state: EntityState): number {
  if (state.kind === "server") return Math.round(state.cpuUtil * 100);
  if (state.kind === "vm") return Math.round(state.cpuUsage * 100);
  return 0;
}

/** The processes of what is hosted on a host besides services: a database instance, a CNI plugin, an SDN controller, an ingress. */
function hostedProcesses(world: WorldReader, id: string): string[] {
  const kinds = new Set(
    world.index.incoming(id, "hosted_on").map((l) => world.index.find(l.from)?.kind),
  );
  return [
    ...(kinds.has("db_instance") ? [DB_PROCESS] : []),
    ...(kinds.has("cni") ? [CNI_PROCESS] : []),
    ...(kinds.has("sdn_controller") ? [SDN_PROCESS] : []),
    ...(kinds.has("ingress") ? [INGRESS_PROCESS] : []),
  ];
}

/** A healthy host as it would stand now. */
export function freshHostOs(world: WorldReader, id: string): HostOs {
  const entity = world.index.entity(id);
  return baselineOs({
    id,
    name: entity.name,
    t: world.time(),
    serviceProcesses: [
      ...servicesOnHost(world, id).map((s) => serviceDef(s).process),
      ...hostedProcesses(world, id),
    ],
    cpuPct: cpuOf(world.stateOf(id)),
  });
}

/** The operating system of a server or VM: what is stored, or the healthy state it would have. */
export function hostOsOf(world: WorldReader, id: string): HostOs {
  const state = world.stateOf(id);
  if ((state.kind === "server" || state.kind === "vm") && state.os) return state.os;
  return freshHostOs(world, id);
}

/** What a host action may touch: the host's state, its faults, and a way to end one. */
export interface HostActContext {
  readonly id: string;
  readonly t: number;
  readonly os: HostOs;
  readonly faults: readonly Fault[];
  removeFault(id: string): void;
}

const has = (ctx: HostActContext, type: FaultType): Fault | undefined =>
  ctx.faults.find((f) => f.type === type);

/** End a fault of this type if the host has one. */
function clear(ctx: HostActContext, type: FaultType): boolean {
  const fault = has(ctx, type);
  if (fault) ctx.removeFault(fault.id);
  return fault !== undefined;
}

/** The unit that fixes a fault when it is restarted. */
const RESTART_FIXES: Readonly<Record<string, FaultType>> = {
  chronyd: "ntp_drift",
  "systemd-resolved": "dns_failure",
};

function restartProcess(ctx: HostActContext, p: OsProcess): void {
  const { os, t } = ctx;
  p.state = "restarting";
  p.until = t + RESTART_SECONDS;
  p.restarts += 1;
  logTo(os, line(t, "systemd", "info", `Stopping ${p.name}.service...`));
  logTo(os, line(t, "systemd", "info", `Started ${p.name}.service.`));
  const system = RESTART_FIXES[p.name];
  if (system && clear(ctx, system)) {
    if (system === "ntp_drift") os.ntpOffsetS = 0.001;
    if (system === "dns_failure") os.dnsOk = true;
    return;
  }
  // A service that is not a system unit: its own children, its logging and its memory start over.
  if (p.user === "svc") {
    if (clear(ctx, "zombie_pileup")) os.zombies = 0;
    clear(ctx, "log_flood");
    p.memPct = Math.min(p.memPct, 9);
    os.memPct = memoryOf(os);
  }
}

const SERVICE_SIGNALS_STOP = new Set([2, 3, 15]);

/** The process that does the service's work (the files of a fault live under its name). */
const culpritOf = (os: HostOs): OsProcess | undefined => os.processes.find((p) => p.user === "svc");

function stopProcess(ctx: HostActContext, p: OsProcess): void {
  const { os, t } = ctx;
  p.state = "stopped";
  delete p.until;
  logTo(os, line(t, "systemd", "info", `Stopping ${p.name}.service...`));
  logTo(os, line(t, "systemd", "info", `Stopped ${p.name}.service.`));
  if (p.user === "svc") os.zombies = 0;
}

function startProcess(ctx: HostActContext, p: OsProcess): void {
  if (p.state === "running") return;
  const { os, t } = ctx;
  p.state = "restarting";
  p.until = t + RESTART_SECONDS;
  logTo(os, line(t, "systemd", "info", `Started ${p.name}.service.`));
  const system = RESTART_FIXES[p.name];
  if (system && clear(ctx, system)) {
    if (system === "ntp_drift") os.ntpOffsetS = 0.001;
    if (system === "dns_failure") os.dnsOk = true;
  }
}

/** `kill <pid>:<signal>`: a kill signal makes systemd start the unit again, a polite one ends it for good. */
function signalProcess(ctx: HostActContext, arg: string): boolean {
  const [pid, sig] = arg.split(":").map(Number);
  const p = ctx.os.processes.find((q) => pidOf(q) === pid);
  if (!p) return false;
  if (SERVICE_SIGNALS_STOP.has(sig ?? 15)) stopProcess(ctx, p);
  else restartProcess(ctx, p);
  return true;
}

/** Free `bytes` of the disk (a removed file, a truncated log); a full disk stops being full once it has room. */
function freeBytes(ctx: HostActContext, bytes: number): void {
  const { os } = ctx;
  if (!(bytes > 0)) return;
  os.diskPct = Math.max(1, Math.round((os.diskPct - (bytes / ROOT_BYTES) * 100) * 10) / 10);
  if (os.diskPct < 90) clear(ctx, "disk_full");
}

function removeFiles(ctx: HostActContext, paths: string, freed: number): void {
  const { os, t } = ctx;
  const list = paths.split("\n").filter(Boolean);
  os.removed = [...(os.removed ?? []), ...list].slice(-400);
  for (const path of list) if (os.files?.[path]) delete os.files[path];
  freeBytes(ctx, freed);
  logTo(os, line(t, "audit", "info", `removed ${list.length} path${list.length === 1 ? "" : "s"}`));
}

/** Text with a resolver of the data centre in it makes name lookup work again. */
const HEALTHY_RESOLVER = /^nameserver\s+10\.20\.0\.5[34]\s*$/m;
const MAX_FILE = 65_536;

function writeFile(ctx: HostActContext, path: string, text: string): void {
  const { os, t } = ctx;
  os.files = { ...(os.files ?? {}), [path]: { t, text: text.slice(0, MAX_FILE) } };
  os.removed = (os.removed ?? []).filter((r) => r !== path);
  if (path === "/etc/resolv.conf" && HEALTHY_RESOLVER.test(text) && clear(ctx, "dns_failure")) {
    os.dnsOk = true;
    logTo(os, line(t, "systemd-resolved", "info", "Using DNS server 10.20.0.53."));
  }
}

/** Remove the oldest dated logs until a clean-up has freed its share (a `logrotate -f`). */
function rotateLogs(ctx: HostActContext): void {
  const { os } = ctx;
  const proc = culpritOf(os)?.name ?? "rsyslogd";
  const target = bytesAt(FREED_PCT);
  let freed = 0;
  const gone: string[] = [];
  archivePaths(proc).forEach((path, i) => {
    if (freed >= target) return;
    gone.push(path);
    freed += archiveBytes(ctx.id, i);
  });
  os.removed = [...(os.removed ?? []), ...gone].slice(-400);
}

function unitFlag(ctx: HostActContext, name: string, on: boolean): boolean {
  if (!processNamed(ctx.os, name)) return false;
  const rest = (ctx.os.disabled ?? []).filter((u) => u !== name);
  ctx.os.disabled = on ? rest : [...rest, name];
  return true;
}

type ActionFn = (ctx: HostActContext, arg: string, data: string | undefined) => boolean;

/** Do something to the process of that name, if the host has one. */
const onProcess =
  (f: (ctx: HostActContext, p: OsProcess) => void): ActionFn =>
  (ctx, arg) => {
    const p = processNamed(ctx.os, arg);
    if (!p) return false;
    f(ctx, p);
    return true;
  };

const ACTIONS: Readonly<Record<HostAction, ActionFn>> = {
  restart: onProcess(restartProcess),
  stop: onProcess(stopProcess),
  start: onProcess(startProcess),
  enable: (ctx, arg) => unitFlag(ctx, arg, true),
  disable: (ctx, arg) => unitFlag(ctx, arg, false),
  kill: (ctx, arg) => signalProcess(ctx, arg),
  remove: (ctx, arg, data) => {
    removeFiles(ctx, arg, Number(data ?? 0));
    return true;
  },
  truncate: (ctx, arg, data) => {
    writeFile(ctx, arg, "");
    freeBytes(ctx, Number(data ?? 0));
    return true;
  },
  write: (ctx, arg, data) => {
    writeFile(ctx, arg, data ?? "");
    return true;
  },
  free_disk: (ctx, arg) => {
    freeDisk(ctx, arg);
    return true;
  },
  remount_rw: (ctx) => {
    remount(ctx);
    return true;
  },
  reboot: (ctx) => {
    reboot(ctx);
    return true;
  },
};

/** Apply one `host.act`; false when the host has nothing of that name (the shell tells the operator). */
export function actOnHost(
  ctx: HostActContext,
  action: HostAction,
  arg: string | undefined,
  data?: string,
): boolean {
  return ACTIONS[action](ctx, arg ?? "", data);
}

function freeDisk(ctx: HostActContext, arg: string): void {
  const { os, t } = ctx;
  clear(ctx, "disk_full");
  os.diskPct = Math.max(30, Math.round((os.diskPct - FREED_PCT) * 10) / 10);
  rotateLogs(ctx);
  logTo(
    os,
    line(
      t,
      "logrotate",
      "info",
      `removed ${arg === "" ? "old logs" : arg}; ${FREED_PCT}% of the disk is free again`,
    ),
  );
}

function remount(ctx: HostActContext): void {
  clear(ctx, "fs_readonly");
  ctx.os.fs = "rw";
  logTo(
    ctx.os,
    line(ctx.t, "kernel", "info", "EXT4-fs (sda2): re-mounted. Opts: (null). Quota mode: none."),
  );
}

function reboot(ctx: HostActContext): void {
  const { os, t } = ctx;
  clear(ctx, "fs_readonly");
  clear(ctx, "zombie_pileup");
  os.up = false;
  os.downUntil = t + HOST_REBOOT_SECONDS;
  os.zombies = 0;
  os.fs = "rw";
  logTo(os, line(t, "systemd-logind", "info", "System is rebooting."));
}
