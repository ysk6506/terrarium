/**
 * The text of the host's logs (ADR-0117 decision 3): `journalctl`, `dmesg`, and the files under /var/log. All of
 * it is printed from the one event list (events.ts), so a line the journal shows is in the file, and the other
 * way round, with the same stamp.
 */
import { ctime, dateAt, journalStamp, syslogStamp, ymdHms } from "./clock";
import { facilityOf, hostLines, type JLine, linePid, WINDOW_S } from "./events";
import { type OsHost, spanAt } from "./host";

/** The longest stretch a query may reach back. */
const MAX_WINDOW_S = 24 * 3600;

/** How far this host's clock is off at world time `t`. */
export function skewAt(h: OsHost, t: number): number {
  const drift = spanAt(h, "ntp_drift", t);
  if (drift) return ((drift.params.secPerMin ?? 90) * (t - drift.since)) / 60;
  return Math.abs(h.os.ntpOffsetS) < 1 ? h.os.ntpOffsetS : 0;
}

export const PRIORITY: Readonly<Record<string, number>> = {
  emerg: 0,
  alert: 1,
  crit: 2,
  err: 3,
  error: 3,
  warning: 4,
  warn: 4,
  notice: 5,
  info: 6,
  debug: 7,
};
const LEVEL_PRIORITY: Readonly<Record<JLine["level"], number>> = { err: 3, warn: 4, info: 6 };

export interface JournalOptions {
  readonly units?: readonly string[];
  readonly n?: number;
  /** World times. */
  readonly since?: number;
  readonly until?: number;
  /** Show lines at this priority or more urgent. */
  readonly priority?: number;
  readonly kernel?: boolean;
  /** 0 is this boot, -1 the one before. */
  readonly boot?: number;
  readonly grep?: RegExp;
  readonly reverse?: boolean;
  readonly cat?: boolean;
}

const belongsTo = (l: JLine, unit: string): boolean =>
  l.unit === unit || (l.unit === "systemd" && l.msg.startsWith(`${unit}.service`));

/** Whether a line is in the window of a `--since`/`--until` and of the boot asked for. */
function inTime(h: OsHost, o: JournalOptions, l: JLine): boolean {
  if (o.since !== undefined && l.t < o.since) return false;
  if (o.until !== undefined && l.t > o.until) return false;
  if (o.boot === undefined) return true;
  return o.boot === 0 ? l.t >= h.bootT : l.t < h.bootT;
}

function keep(h: OsHost, o: JournalOptions): (l: JLine) => boolean {
  const units = o.units ?? [];
  return (l) =>
    (units.length === 0 || units.some((u) => belongsTo(l, u))) &&
    (!o.kernel || l.unit === "kernel") &&
    (o.priority === undefined || LEVEL_PRIORITY[l.level] <= o.priority) &&
    inTime(h, o, l);
}

export function formatJournal(h: OsHost, l: JLine, cat = false): string {
  if (cat) return l.msg;
  const stamp = journalStamp(dateAt(l.t, skewAt(h, l.t)));
  const who = l.unit === "kernel" ? "kernel" : `${l.unit}[${l.pid ?? linePid(h, l.unit)}]`;
  return `${stamp} ${h.name} ${who}: ${l.msg}`;
}

/** The lines `journalctl` would print for these options. */
export function journalLines(h: OsHost, o: JournalOptions): JLine[] {
  const base = o.boot === -1 ? h.bootT - WINDOW_S : h.t - WINDOW_S;
  const from = o.boot === -1 ? base : Math.max(h.t - MAX_WINDOW_S, Math.min(o.since ?? base, base));
  let lines = hostLines(h, from).filter(keep(h, o));
  if (o.grep) {
    const re = o.grep;
    lines = lines.filter((l) => re.test(formatJournal(h, l)));
  }
  if (o.reverse) lines = [...lines].reverse();
  return o.n === undefined ? lines : o.reverse ? lines.slice(0, o.n) : lines.slice(-o.n);
}

export function journalText(h: OsHost, o: JournalOptions): string {
  const lines = journalLines(h, o);
  if (lines.length === 0) return "-- No entries --";
  return lines.map((l) => formatJournal(h, l, o.cat)).join("\n");
}

const BANNER = [
  [
    0,
    "Linux version 5.14.0-427.el9.x86_64 (mockbuild@x86-64-03) (gcc 11.4.1) #1 SMP PREEMPT_DYNAMIC",
  ],
  [0, "Command line: BOOT_IMAGE=(hd0,msdos1)/vmlinuz-5.14.0-427.el9.x86_64 root=/dev/sda2 ro"],
  [2.41, "EXT4-fs (sda2): mounted filesystem with ordered data mode. Quota mode: none."],
] as const;

export interface DmesgOptions {
  readonly human: boolean;
  readonly priority?: number;
}

/** `dmesg`: the kernel's lines since boot, with seconds since boot or (`-T`) the clock. */
export function dmesgText(h: OsHost, o: DmesgOptions): string {
  const kernel = hostLines(h, h.bootT).filter(
    (l) =>
      l.unit === "kernel" &&
      !l.msg.startsWith("Linux version") &&
      (o.priority === undefined || LEVEL_PRIORITY[l.level] <= o.priority),
  );
  const rows: Array<{ t: number; msg: string }> = [
    ...(o.priority === undefined ? BANNER.map(([s, msg]) => ({ t: h.bootT + s, msg })) : []),
    ...kernel.map((l) => ({ t: l.t, msg: l.msg })),
  ];
  return rows
    .map((r) =>
      o.human
        ? `[${ctime(dateAt(r.t, skewAt(h, r.t)))}] ${r.msg}`
        : `[${Math.max(0, r.t - h.bootT)
            .toFixed(6)
            .padStart(12)}] ${r.msg}`,
    )
    .join("\n");
}

function syslogLine(h: OsHost, l: JLine): string {
  const stamp = syslogStamp(dateAt(l.t, skewAt(h, l.t)));
  const who = l.unit === "kernel" ? "kernel" : `${l.unit}[${l.pid ?? linePid(h, l.unit)}]`;
  return `${stamp} ${h.name} ${who}: ${l.msg}`;
}

export type LogFile = "messages" | "auth" | "kern" | "cron";

const FACILITIES: Readonly<Record<LogFile, (f: string) => boolean>> = {
  messages: (f) => f !== "auth" && f !== "cron",
  auth: (f) => f === "auth",
  kern: (f) => f === "kern",
  cron: (f) => f === "cron",
};

/** A system log file: `/var/log/messages` (also `syslog`), `secure` (`auth.log`), `kern.log`, `cron`. */
export function systemLogText(h: OsHost, file: LogFile): string {
  return hostLines(h)
    .filter((l) => FACILITIES[file](facilityOf(l.unit, h)))
    .map((l) => syslogLine(h, l))
    .join("\n");
}

const LEVEL_WORD: Readonly<Record<JLine["level"], string>> = {
  info: "INFO",
  warn: "WARN",
  err: "ERROR",
};

/** An application's own log file: its lines with full timestamps. */
export function appLogText(h: OsHost, unit: string): string {
  return hostLines(h)
    .filter((l) => l.unit === unit)
    .map((l) => {
      const word = /^(INFO|WARN|ERROR|FATAL|LOG)/.test(l.msg) ? "" : `${LEVEL_WORD[l.level]} `;
      return `${ymdHms(dateAt(l.t, skewAt(h, l.t)))} ${word}${l.msg}`;
    })
    .join("\n");
}

/** How many lines of an application log there are, for sizing its file. */
export const appLogLines = (h: OsHost, unit: string): number =>
  hostLines(h).filter((l) => l.unit === unit).length;
