/**
 * The operating system of a server or a VM, as a person logged in would see it (REQ-087, ADR-0091): CPU, memory,
 * disk, processes, file system, clock and name resolution, and the last lines of the system log.
 *
 * This is not a real OS. It is a small state that physics moves along with the faults (memory climbs a few
 * percent a minute under a leak) and that the fake shell prints in the shape of real Linux output. A host
 * that nobody looked at and nothing broke on has no stored state; it is made on first need from its id, so the
 * same host always starts the same way and a world without OS trouble costs nothing.
 */
import { hash53 } from "@terrarium/core/kernel";

export type ProcessState = "running" | "restarting" | "failed" | "stopped";

export interface OsProcess {
  readonly name: string;
  readonly pid: number;
  readonly user: string;
  state: ProcessState;
  /** Times the process was started again since the host booted (systemd's restart counter). */
  restarts: number;
  /** CPU weight: the host's CPU is shared among running processes in proportion to it. */
  w: number;
  /** Share of the host's memory this process holds, %. */
  memPct: number;
  /** While `restarting`: the world time it is up again. */
  until?: number;
  /** Restarts counted by a crash loop, so a loop adds one restart per 30 seconds and not one per step. */
  loop?: number;
}

export interface OsLine {
  readonly t: number;
  readonly unit: string;
  readonly level: "info" | "warn" | "err";
  readonly msg: string;
}

export interface HostOs {
  /** Whether the system is up (false while it reboots after a panic or a `reboot`). */
  up: boolean;
  cpuPct: number;
  memPct: number;
  diskPct: number;
  /** Defunct child processes nobody has collected. */
  zombies: number;
  fs: "rw" | "ro";
  /** How far the clock is from the time source, seconds. */
  ntpOffsetS: number;
  dnsOk: boolean;
  /** Whether the certificate the services on this host present is still valid. */
  certOk: boolean;
  uptimeS: number;
  /** Lines the logging writes each second. */
  logRate: number;
  processes: OsProcess[];
  log: OsLine[];
  /** While down: the world time the system is up again. */
  downUntil?: number;
  /** Files an operator wrote with `>`, `>>` or `tee` (ADR-0117): path to content; also a directory made (`dir`) or a symbolic link (`link`, its target). */
  files?: Record<string, { t: number; text: string; dir?: true; link?: string }>;
  /** Paths an operator removed. */
  removed?: string[];
  /** Units an operator disabled (`systemctl disable`). */
  disabled?: string[];
}

export const LOG_KEEP = 60;
/** Where the clock offset starts to break logins and tokens (Kerberos allows 5 minutes). */
export const AUTH_SKEW_S = 300;
/** A disk this full leaves no room to write. */
export const DISK_FULL_PCT = 99.5;
export const OS_FAULT_TYPES = [
  "disk_full",
  "log_flood",
  "memory_leak",
  "process_crashloop",
  "zombie_pileup",
  "fs_readonly",
  "ntp_drift",
  "dns_failure",
  "kernel_panic",
  "cert_expired",
] as const;

/** The services every Linux host runs, named as systemd units are. */
const SYSTEM_PROCESSES: ReadonlyArray<
  readonly [name: string, user: string, w: number, mem: number]
> = [
  ["systemd-journald", "root", 1, 0.6],
  ["sshd", "root", 1, 0.3],
  ["chronyd", "chrony", 0.5, 0.2],
  ["systemd-resolved", "systemd-resolve", 0.5, 0.3],
  ["rsyslogd", "syslog", 1, 0.4],
  ["crond", "root", 0.5, 0.2],
];

/** A service's process: it does most of the host's work. */
const SERVICE_WEIGHT = 12;
const SERVICE_MEM_PCT = 9;
const KERNEL_MEM_PCT = 8;

/** A number between `lo` and `hi` that depends only on the id and a salt. */
const spread = (id: string, salt: string, lo: number, hi: number): number =>
  lo + (hash53(`${id}|${salt}`) % 1000) * ((hi - lo) / 1000);

export interface BaselineInput {
  readonly id: string;
  readonly name: string;
  readonly t: number;
  /** Processes of the services running here. */
  readonly serviceProcesses: readonly string[];
  /** CPU use now, 0..100. */
  readonly cpuPct: number;
}

/** A healthy host: where it would stand if nothing had ever gone wrong on it. */
export function baselineOs(input: BaselineInput): HostOs {
  const { id, t } = input;
  const processes: OsProcess[] = [
    ...SYSTEM_PROCESSES.map(([name, user, w, memPct]) => ({ name, user, w, memPct })),
    ...input.serviceProcesses.map((name) => ({
      name,
      user: "svc",
      w: SERVICE_WEIGHT,
      memPct: SERVICE_MEM_PCT,
    })),
  ].map((p, i) => ({
    ...p,
    pid: 380 + i * 41 + (hash53(`${id}|pid|${p.name}`) % 37),
    state: "running" as const,
    restarts: 0,
  }));
  const os: HostOs = {
    up: true,
    cpuPct: input.cpuPct,
    memPct: 0,
    diskPct: round1(spread(id, "disk", 38, 61)),
    zombies: 0,
    fs: "rw",
    ntpOffsetS: round3(spread(id, "ntp", -0.004, 0.004)),
    dnsOk: true,
    certOk: true,
    uptimeS: Math.round(spread(id, "uptime", 3, 60) * 86_400 + t),
    logRate: 2,
    processes,
    log: [
      line(
        t - 3600,
        "sshd",
        "info",
        `Accepted publickey for ops from 10.20.${hash53(id) % 200}.14 port 51822 ssh2`,
      ),
      line(t - 1800, "CRON", "info", "(root) CMD (/usr/lib/sa/sa1 1 1)"),
      line(
        t - 600,
        "chronyd",
        "info",
        `Selected source 10.20.0.2 (offset ${round3(spread(id, "ntp", -0.004, 0.004))}s)`,
      ),
    ],
  };
  os.memPct = memoryOf(os);
  return os;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export const line = (t: number, unit: string, level: OsLine["level"], msg: string): OsLine => ({
  t,
  unit,
  level,
  msg,
});

/** The memory in use: the kernel's share plus what each process holds. */
export function memoryOf(os: HostOs): number {
  const held = os.processes.reduce((sum, p) => sum + (p.state === "running" ? p.memPct : 0), 0);
  return Math.min(100, round1(KERNEL_MEM_PCT + held));
}

/** Write a line in the system log, keeping the last `LOG_KEEP`. */
export function logTo(os: HostOs, entry: OsLine): void {
  os.log.push(entry);
  if (os.log.length > LOG_KEEP) os.log.splice(0, os.log.length - LOG_KEEP);
}

/** The PID a process has now: it changes with every restart (ADR-0117 decision 2). */
export const pidOf = (p: OsProcess): number => p.pid + p.restarts * 1009;

export const processNamed = (os: HostOs, name: string): OsProcess | undefined =>
  os.processes.find((p) => p.name === name);

/** The CPU a process uses of the host's CPU, % (only running processes share it). */
export function processCpuPct(os: HostOs, p: OsProcess): number {
  if (p.state !== "running") return 0;
  const total = os.processes.reduce((sum, q) => sum + (q.state === "running" ? q.w : 0), 0);
  return total > 0 ? round1((os.cpuPct * p.w) / total) : 0;
}
