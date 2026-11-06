/**
 * The lines a fault writes while it lasts (ADR-0117 decision 1 and 7). Each fault has a rhythm (a crash loop
 * writes every few seconds, a drifting clock every minute), so its lines are a function of the fault's start,
 * its end and the time asked about, not of how often the world was stepped: fast-forwarding and stepping by
 * the second give the same journal.
 */
import { certDate, dateAt } from "./clock";
import { culpritName, type FaultSpan, type OsHost } from "./host";
import { DEAD_RESOLVER } from "./layout";
import { procRestarts } from "./restarts";

const RESTART_PID_STEP = 1009;

export interface JLine {
  readonly t: number;
  readonly unit: string;
  readonly level: "info" | "warn" | "err";
  readonly msg: string;
  /** The PID the line carries when it is not the unit's current one (a process that has since been replaced). */
  readonly pid?: number;
}

export type Emit = (
  t: number,
  unit: string,
  level: JLine["level"],
  msg: string,
  pid?: number,
) => void;

interface Window {
  readonly h: OsHost;
  readonly span: FaultSpan;
  /** The stretch of the fault that falls inside what is asked for. */
  readonly from: number;
  readonly to: number;
  readonly proc: string;
  readonly emit: Emit;
}

const MAX_LINES = 400;

/** Times `since + k*every` (k >= 1) inside the window, newest `MAX_LINES` only. */
function ticks(w: Window, every: number, first = 1): number[] {
  const step = Math.max(1, every);
  const last = Math.floor((w.to - w.span.since) / step);
  const start = Math.max(first, Math.ceil((w.from - w.span.since) / step), last - MAX_LINES + 1);
  const out: number[] = [];
  for (let k = start; k <= last; k++) out.push(w.span.since + k * step);
  return out;
}

const param = (w: Window, name: string, def: number): number => w.span.params[name] ?? def;

/** The time a certificate that a fault expired stopped being valid. */
export const certExpiry = (span: FaultSpan): number => span.since - 60;

function diskFull(w: Window): void {
  for (const t of ticks(w, 60)) w.emit(t, w.proc, "err", "write error: No space left on device");
}

function logFlood(w: Window): void {
  const rate = 4500;
  for (const t of ticks(w, 5, 0))
    w.emit(
      t,
      w.proc,
      "err",
      `ERROR upstream connection failed, retrying (attempt ${Math.round(t - w.span.since)}) - ${rate} lines/s`,
    );
}

function memoryLeak(w: Window): void {
  const per = param(w, "pctPerMin", 2);
  for (const t of ticks(w, 120)) {
    const heap = Math.min(99, 9 + (per * (t - w.span.since)) / 60);
    w.emit(t, w.proc, "warn", `WARN heap usage ${heap.toFixed(0)}% of limit, objects not released`);
  }
}

/** How long a crash-looping process lives before it dies, seconds. */
export const LOOP_LIFE_S = 2;

function crashLoop(w: Window): void {
  const every = Math.max(1, param(w, "intervalS", 30));
  const total = Math.floor((w.h.t - w.span.since) / every);
  const base = w.span.until === undefined ? procRestarts(w.h, w.proc) - total : 0;
  const first = w.h.os.processes.find((p) => p.name === w.proc)?.pid ?? 1;
  const cause = `FATAL: failed to load /etc/${w.proc}.conf: unexpected token at line 14`;
  for (const t of ticks(w, every)) {
    const n = base + Math.round((t - w.span.since) / every);
    const pid = first + n * RESTART_PID_STEP;
    w.emit(
      t,
      "systemd",
      "warn",
      `${w.proc}.service: Scheduled restart job, restart counter is at ${n}.`,
    );
    w.emit(t + 1, w.proc, "err", cause, pid);
    w.emit(
      t + LOOP_LIFE_S,
      "systemd",
      "err",
      `${w.proc}.service: Main process exited, code=exited, status=1/FAILURE`,
    );
    w.emit(t + LOOP_LIFE_S, "systemd", "err", `${w.proc}.service: Failed with result 'exit-code'.`);
  }
}

function zombies(w: Window): void {
  const per = param(w, "perMin", 40);
  for (const t of ticks(w, 60)) {
    const n = Math.min(32_000, Math.floor((per * (t - w.span.since)) / 60));
    w.emit(
      t,
      w.proc,
      "warn",
      `WARN child process exited but was not reaped (SIGCHLD not handled), defunct=${n}`,
    );
  }
}

function readOnly(w: Window): void {
  for (const t of ticks(w, 60, 0))
    w.emit(
      t,
      w.proc,
      "err",
      `ERROR cannot write /var/lib/${w.proc}/state.db: Read-only file system`,
    );
}

function ntpDrift(w: Window): void {
  const per = param(w, "secPerMin", 90);
  for (const t of ticks(w, 60)) {
    const off = (per * (t - w.span.since)) / 60;
    w.emit(t, "chronyd", "warn", `System clock wrong by ${off.toFixed(1)} seconds`);
    if (off > 300)
      w.emit(
        t,
        w.proc,
        "err",
        `ERROR authentication failed: clock skew too great (offset ${off.toFixed(0)}s)`,
      );
  }
}

function dnsFailure(w: Window): void {
  for (const t of ticks(w, 90, 0))
    w.emit(
      t,
      "systemd-resolved",
      "err",
      `Failed to send DNS query to ${DEAD_RESOLVER}: Connection timed out`,
    );
  for (const t of ticks(w, 60))
    w.emit(
      t,
      w.proc,
      "warn",
      `WARN dial tcp: lookup db.dc.local on ${DEAD_RESOLVER}:53: i/o timeout`,
    );
}

function certExpired(w: Window): void {
  const notAfter = certDate(dateAt(certExpiry(w.span)));
  for (const t of ticks(w, 30, 0))
    w.emit(
      t,
      w.proc,
      "err",
      `TLS handshake failed: certificate has expired (notAfter=${notAfter})`,
    );
}

const GENERATORS: Readonly<Record<string, (w: Window) => void>> = {
  disk_full: diskFull,
  log_flood: logFlood,
  memory_leak: memoryLeak,
  process_crashloop: crashLoop,
  zombie_pileup: zombies,
  fs_readonly: readOnly,
  ntp_drift: ntpDrift,
  dns_failure: dnsFailure,
  cert_expired: certExpired,
};

/** Emit the lines of every fault that was on this host between `from` and `to`. */
export function faultLines(h: OsHost, from: number, to: number, emit: Emit): void {
  const proc = culpritName(h);
  for (const span of h.spans) {
    const gen = GENERATORS[span.type];
    const end = Math.min(to, span.until ?? to);
    if (!gen || end < from || span.since > to) continue;
    gen({ h, span, from: Math.max(from, span.since), to: end, proc, emit });
  }
}
