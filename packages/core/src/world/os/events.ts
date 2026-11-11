/**
 * The event list of one host (ADR-0117 decision 3): everything that ever wrote a line on it, in time order.
 * `/var/log/*`, `journalctl` and `dmesg` are all printed from this one list, so they cannot disagree. Its
 * sources are the lines the physics stored (state changes, restarts), the background of a living host (cron,
 * time sync, logins, health checks), the faults, and the world's alarms and operator actions.
 */
import { hash53 } from "@terrarium/core/kernel";
import { type OsLine, pidOf } from "../os";
import type { WorldEvent } from "../world";
import { type Emit, faultLines, type JLine } from "./events-fault";
import { culpritName, type OsHost, spanAt } from "./host";
import { NTP_SOURCE, spread } from "./layout";

export type { JLine } from "./events-fault";

/** How far back the generated background reaches. */
export const WINDOW_S = 6 * 3600;

export type Facility = "kern" | "auth" | "cron" | "daemon" | "user";

const AUTH_UNITS = new Set(["sshd", "sudo", "systemd-logind"]);

export function facilityOf(unit: string, h: OsHost): Facility {
  if (unit === "kernel") return "kern";
  if (AUTH_UNITS.has(unit)) return "auth";
  if (unit === "CRON") return "cron";
  const isApp = h.os.processes.some((p) => p.name === unit && p.user === "svc");
  return isApp ? "user" : "daemon";
}

/** The PID a unit's lines carry. */
export function linePid(h: OsHost, unit: string): number {
  if (unit === "kernel") return 0;
  if (unit === "systemd") return 1;
  if (unit === "CRON") return 3000 + (hash53(`${h.id}|cron`) % 4000);
  const p = h.os.processes.find((q) => q.name === unit);
  return p ? pidOf(p) : 1000 + (hash53(`${h.id}|${unit}`) % 2000);
}

function everyOf(h: OsHost, from: number, to: number, period: number, salt: string): number[] {
  const off = hash53(`${h.id}|${salt}`) % period;
  const out: number[] = [];
  for (let k = Math.ceil((from - off) / period); k * period + off <= to; k++)
    out.push(k * period + off);
  return out;
}

function background(h: OsHost, from: number, to: number, emit: Emit): void {
  for (const t of everyOf(h, from, to, 600, "cron"))
    emit(t, "CRON", "info", "(root) CMD (/usr/lib/sa/sa1 1 1)");
  for (const t of everyOf(h, from, to, 3600, "chrony")) {
    if (spanAt(h, "ntp_drift", t)) continue;
    const off = spread(h.id, `ntp${t}`, -0.004, 0.004).toFixed(3);
    emit(t, "chronyd", "info", `Selected source ${NTP_SOURCE} (offset ${off}s)`);
  }
  for (const t of everyOf(h, from, to, 7200, "ssh")) {
    const port = 40_000 + (hash53(`${h.id}|port|${t}`) % 20_000);
    emit(
      t,
      "sshd",
      "info",
      `Accepted publickey for ops from 10.20.${hash53(h.id) % 200}.14 port ${port} ssh2`,
    );
    emit(
      t,
      "sshd",
      "info",
      "pam_unix(sshd:session): session opened for user ops(uid=1000) by (uid=0)",
    );
  }
  for (const s of h.services)
    for (const t of everyOf(h, from, to, 120, `app|${s.process}`)) {
      const ms = 2 + (hash53(`${h.id}|ms|${t}`) % 9);
      emit(t, s.process, "info", `INFO GET /healthz 200 ${ms}ms`);
    }
  if (h.db)
    for (const t of everyOf(h, from, to, 300, "ckpt"))
      emit(
        t,
        "postgresql",
        "info",
        `LOG:  checkpoint complete: wrote ${40 + (hash53(`${t}`) % 90)} buffers`,
      );
}

/** The shell command an operator action stands for, as `sudo` would log it. */
const SUDO_COMMANDS: Readonly<Record<string, (arg: string, data: string) => string>> = {
  free_disk: () => "/usr/sbin/logrotate -f /etc/logrotate.conf",
  remount_rw: () => "/usr/bin/mount -o remount,rw /",
  reboot: () => "/usr/sbin/reboot",
  kill: (arg) => `/usr/bin/kill ${arg}`,
  remove: (arg) => `/usr/bin/rm ${arg}`,
  truncate: (arg) => `/usr/bin/truncate -s 0 ${arg}`,
  write: (arg) => `/usr/bin/tee ${arg}`,
  mkdir: (arg) => `/usr/bin/mkdir ${arg}`,
  symlink: (arg, data) => `/usr/bin/ln -s ${data} ${arg}`,
};

function commandOfAction(e: Extract<WorldEvent, { type: "host.act" }>): string {
  const arg = e.arg ?? "";
  return SUDO_COMMANDS[e.action]?.(arg, e.data ?? "") ?? `/usr/bin/systemctl ${e.action} ${arg}`;
}

const parseAlarmId = (id: string): { code: string; entity: string } => {
  const at = id.indexOf(":");
  return { code: id.slice(0, at), entity: id.slice(at + 1) };
};

function worldLines(h: OsHost, from: number, to: number, emit: Emit): void {
  const mine = new Set([h.id, ...h.services.map((s) => s.id)]);
  for (const e of h.world.events()) {
    if (e.t < from || e.t > to) continue;
    if (e.type === "alarm.raise" && mine.has(e.alarm.entityId))
      emit(
        e.t,
        "monitoring-agent",
        e.alarm.severity === "critical" ? "err" : "warn",
        `alarm ${e.alarm.code} raised on ${e.alarm.entityId}: ${e.alarm.message}`,
      );
    else if (e.type === "alarm.clear" && mine.has(parseAlarmId(e.alarmId).entity))
      emit(
        e.t,
        "monitoring-agent",
        "info",
        `alarm ${parseAlarmId(e.alarmId).code} cleared on ${parseAlarmId(e.alarmId).entity}`,
      );
    else if (e.type === "host.act" && e.target === h.id && e.cause.startsWith("tool:"))
      emit(
        e.t,
        "sudo",
        "info",
        `ops : TTY=pts/0 ; PWD=/home/ops ; USER=root ; COMMAND=${commandOfAction(e)}`,
      );
  }
}

/**
 * Lines the physics stored that a fault's rhythm makes again from its start (events-fault.ts), so the stored copy is
 * left out: a crash loop's exits, a flood's errors, a drifting clock's warnings, the resolver's and the handshake's.
 */
function madeByFault(l: OsLine, proc: string): boolean {
  if (l.unit === proc)
    return (
      l.msg.startsWith("ERROR upstream connection failed") ||
      l.msg.startsWith("TLS handshake failed: certificate has expired")
    );
  if (l.unit === "chronyd") return l.msg.startsWith("System clock wrong by");
  if (l.unit === "systemd-resolved") return l.msg.startsWith("Failed to send DNS query");
  return (
    l.unit === "systemd" &&
    new RegExp(`^${proc}\\.service: (Main process exited|Scheduled restart job)`).test(l.msg)
  );
}

/** Every line the host wrote between `from` and its present, oldest first. */
export function hostLines(h: OsHost, from = h.t - WINDOW_S): JLine[] {
  const out: JLine[] = [];
  const emit: Emit = (t, unit, level, msg, pid) => {
    if (t >= from && t <= h.t)
      out.push({ t, unit, level, msg, ...(pid !== undefined ? { pid } : {}) });
  };
  const proc = culpritName(h);
  for (const l of h.os.log) if (!madeByFault(l, proc)) emit(l.t, l.unit, l.level, l.msg);
  background(h, from, h.t, emit);
  faultLines(h, from, h.t, emit);
  worldLines(h, from, h.t, emit);
  return out
    .map((l, i) => ({ l, i }))
    .sort((a, b) => a.l.t - b.l.t || a.i - b.i)
    .map((x) => x.l);
}
