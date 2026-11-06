/**
 * The process table of a fake host (ADR-0117 decision 2). Services, agents and system daemons are processes;
 * the table is made from the host's stored state each time it is read, so `ps`, `top`, `pgrep` and
 * `/proc/<pid>/status` always print the same rows. A leak shows as a growing RSS, zombies as `Z` rows under the
 * process that does not reap them, and a restart loop as a PID that changes every few seconds.
 */
import { hash53 } from "@terrarium/core/kernel";
import { type OsProcess, pidOf, processCpuPct } from "../os";
import { LOOP_LIFE_S } from "./events-fault";
import { culpritName, type OsHost, spanAt } from "./host";
import { commandLine } from "./layout";

export type ProcState = "R" | "S" | "D" | "Z";

export interface Proc {
  readonly pid: number;
  readonly ppid: number;
  readonly user: string;
  /** The name `ps -C` and `pgrep` match. */
  readonly comm: string;
  /** The full command line. */
  readonly args: string;
  readonly state: ProcState;
  readonly cpuPct: number;
  readonly rssKb: number;
  readonly vszKb: number;
  /** World time the process started. */
  readonly startT: number;
  readonly nice: number;
  readonly threads: number;
  /** The unit it belongs to, if it is a service's main process. */
  readonly unit?: string;
  readonly kernel?: boolean;
}

const ZOMBIE_CAP = 32_000;

/** Seconds into the current life of a crash-looping process, or undefined when it is not looping. */
function loopAge(h: OsHost, p: OsProcess): number | undefined {
  if (p.name !== culpritName(h)) return undefined;
  const loop = spanAt(h, "process_crashloop", h.t);
  if (!loop) return undefined;
  const interval = Math.max(1, loop.params.intervalS ?? 30);
  return (h.t - loop.since) % interval;
}

/** Whether the process is on the table now (a stopped or failed one is not; a restarting one is, a crash-looping one only just after a start). */
function present(h: OsHost, p: OsProcess): boolean {
  if (p.state === "running") return true;
  if (p.state !== "restarting") return false;
  const age = loopAge(h, p);
  return age === undefined || age < LOOP_LIFE_S;
}

/** When the process was last started on purpose or killed by the kernel, from the lines the host stored. */
export function lastStart(h: OsHost, p: OsProcess): number | undefined {
  const started = `Started ${p.name}.service.`;
  const killed = `(${p.name}) total-vm`;
  for (let i = h.os.log.length - 1; i >= 0; i--) {
    const l = h.os.log[i] as { t: number; msg: string };
    if (l.t >= h.bootT && (l.msg === started || l.msg.includes(killed))) return l.t;
  }
  return undefined;
}

function startOf(h: OsHost, p: OsProcess): number {
  const age = loopAge(h, p);
  if (age !== undefined) return h.t - age;
  return lastStart(h, p) ?? h.bootT + 5 + (hash53(`${h.id}|start|${p.name}`) % 40);
}

const kernelThread = (pid: number, comm: string): Proc => ({
  pid,
  ppid: 2,
  user: "root",
  comm,
  args: `[${comm}]`,
  state: "S",
  cpuPct: 0,
  rssKb: 0,
  vszKb: 0,
  startT: 0,
  nice: 0,
  threads: 1,
  kernel: true,
});

function fixedRows(h: OsHost): Proc[] {
  const init: Proc = {
    pid: 1,
    ppid: 0,
    user: "root",
    comm: "systemd",
    args: "/usr/lib/systemd/systemd --switched-root --system --deserialize 31",
    state: "S",
    cpuPct: 0,
    rssKb: 16_188,
    vszKb: 172_256,
    startT: h.bootT,
    nice: 0,
    threads: 1,
  };
  const kthreadd: Proc = { ...kernelThread(2, "kthreadd"), ppid: 0 };
  return [
    init,
    kthreadd,
    kernelThread(3, "rcu_gp"),
    kernelThread(15, "ksoftirqd/0"),
    kernelThread(16, "migration/0"),
    kernelThread(71, "kworker/0:1-events"),
  ].map((p) => (p.kernel ? { ...p, startT: h.bootT } : p));
}

/** The login session of whoever runs the commands: sshd's child, its shell. */
function sessionRows(h: OsHost, sshdPid: number): Proc[] {
  const base = 90_000 + (hash53(`${h.id}|ssh`) % 5000);
  const mk = (pid: number, ppid: number, comm: string, args: string): Proc => ({
    pid,
    ppid,
    user: "ops",
    comm,
    args,
    state: "S",
    cpuPct: 0,
    rssKb: 5800,
    vszKb: 19_000,
    startT: h.t - 120,
    nice: 0,
    threads: 1,
  });
  return [
    { ...mk(base, sshdPid, "sshd", "sshd: ops [priv]"), user: "root" },
    mk(base + 1, base, "sshd", "sshd: ops@pts/0"),
    mk(base + 2, base + 1, "bash", "-bash"),
  ];
}

function daemonRow(h: OsHost, p: OsProcess, busiest: string): Proc {
  const app = p.user === "svc";
  const rssKb = Math.round((p.memPct / 100) * h.memTotalMb * 1024);
  const cpuPct = processCpuPct(h.os, p);
  return {
    pid: pidOf(p),
    ppid: 1,
    user: app ? "appsvc" : p.user,
    comm: p.name,
    args: commandLine(p.name, app),
    state: p.name === busiest && cpuPct >= 30 ? "R" : "S",
    cpuPct,
    rssKb,
    vszKb: Math.round(rssKb * 1.4) + 60_000,
    startT: startOf(h, p),
    nice: 0,
    threads: 4 + (hash53(`${h.id}|thr|${p.name}`) % 36),
    unit: p.name,
  };
}

function zombieRows(h: OsHost, parent: OsProcess | undefined): Proc[] {
  const count = Math.min(h.os.zombies, ZOMBIE_CAP);
  const name = parent?.name ?? "worker";
  const rate = Math.max(1, spanAt(h, "zombie_pileup", h.t)?.params.perMin ?? 60);
  return Array.from({ length: count }, (_, i) => ({
    pid: 20_000 + i * 3,
    ppid: parent ? pidOf(parent) : 1,
    user: "appsvc",
    comm: name,
    args: `[${name}] <defunct>`,
    state: "Z" as const,
    cpuPct: 0,
    rssKb: 0,
    vszKb: 0,
    startT: Math.max(h.bootT, h.t - ((count - i) * 60) / rate),
    nice: 0,
    threads: 1,
  }));
}

/** Every process on the host, in PID order. */
export function processTable(h: OsHost): Proc[] {
  const live = h.os.processes.filter((p) => present(h, p));
  const busiest = [...live].sort((a, b) => processCpuPct(h.os, b) - processCpuPct(h.os, a))[0];
  const sshd = h.os.processes.find((p) => p.name === "sshd");
  const parent = h.os.processes.find((p) => p.user === "svc");
  return [
    ...fixedRows(h),
    ...live.map((p) => daemonRow(h, p, busiest?.name ?? "")),
    ...sessionRows(h, sshd ? pidOf(sshd) : 1),
    ...zombieRows(h, parent),
  ].sort((a, b) => a.pid - b.pid);
}

export const findProc = (rows: readonly Proc[], pid: number): Proc | undefined =>
  rows.find((p) => p.pid === pid);
