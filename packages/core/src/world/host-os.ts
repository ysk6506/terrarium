/**
 * Reading and changing the operating system of a host (REQ-087, ADR-0091). `hostOsOf` is what the shell and the
 * services read: the host's stored state, or the healthy one it would have. The three operator changes
 * (restart a process, free disk, remount, reboot) are `host.act`; they are applied here to the state the world
 * hands over, together with the faults they can clear.
 */
import type { Entity } from "./blueprint";
import type { Fault, FaultType } from "./faults";
import { baselineOs, type HostOs, line, logTo, memoryOf, type OsProcess, processNamed } from "./os";
import { CNI_PROCESS, INGRESS_PROCESS, SDN_PROCESS } from "./sdn";
import { serviceDef } from "./service";
import type { EntityState } from "./state";
import type { WorldReader } from "./world";

export type HostAction = "restart" | "free_disk" | "remount_rw" | "reboot";

export const HOST_ACTIONS: readonly HostAction[] = ["restart", "free_disk", "remount_rw", "reboot"];

/** Seconds a process takes to come back after `systemctl restart`. */
export const RESTART_SECONDS = 15;
/** Seconds a host is down for `reboot`. */
export const HOST_REBOOT_SECONDS = 120;
/** How much disk a clean-up of old logs frees, percentage points. */
export const FREED_PCT = 35;

/** The process of a database instance, as `systemctl` names it. */
export const DB_PROCESS = "postgresql";
/** The processes of a Kubernetes node, as `systemctl` names them. */
export const K8S_PROCESSES: readonly string[] = ["kubelet", "containerd"];

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

/** The processes of what is hosted on a host besides services: a database instance, a Kubernetes node, a CNI plugin, an SDN controller, an ingress. */
function hostedProcesses(world: WorldReader, id: string): string[] {
  const kinds = new Set(
    world.index.incoming(id, "hosted_on").map((l) => world.index.find(l.from)?.kind),
  );
  return [
    ...(kinds.has("db_instance") ? [DB_PROCESS] : []),
    ...(kinds.has("cni") ? [CNI_PROCESS] : []),
    ...(kinds.has("sdn_controller") ? [SDN_PROCESS] : []),
    ...(kinds.has("ingress") ? [INGRESS_PROCESS] : []),
    ...(kinds.has("k8s_node") ? K8S_PROCESSES : []),
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

/** Apply one `host.act`; false when the host has no process of that name (the shell tells the operator). */
export function actOnHost(
  ctx: HostActContext,
  action: HostAction,
  arg: string | undefined,
): boolean {
  const { os, t } = ctx;
  if (action === "restart") {
    const p = processNamed(os, arg ?? "");
    if (!p) return false;
    restartProcess(ctx, p);
  } else if (action === "free_disk") {
    clear(ctx, "disk_full");
    os.diskPct = Math.max(30, Math.round((os.diskPct - FREED_PCT) * 10) / 10);
    logTo(
      os,
      line(
        t,
        "logrotate",
        "info",
        `removed ${arg ?? "old logs"}; ${FREED_PCT}% of the disk is free again`,
      ),
    );
  } else if (action === "remount_rw") {
    clear(ctx, "fs_readonly");
    os.fs = "rw";
    logTo(
      os,
      line(t, "kernel", "info", "EXT4-fs (sda2): re-mounted. Opts: (null). Quota mode: none."),
    );
  } else {
    clear(ctx, "fs_readonly");
    clear(ctx, "zombie_pileup");
    os.up = false;
    os.downUntil = t + HOST_REBOOT_SECONDS;
    os.zombies = 0;
    os.fs = "rw";
    logTo(os, line(t, "systemd-logind", "info", "System is rebooting."));
  }
  return true;
}
