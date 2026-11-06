/**
 * The clock of a fake host and the stamps its logs carry (ADR-0117). World time is seconds since the simulation
 * began (2026-01-01 00:00 UTC, the same epoch the facades use); a host with a drifting clock writes its logs
 * and answers `date` with the drift added.
 */

/** The instant world time 0 stands for; equal to the facades' `SIM_EPOCH_MS`. */
export const OS_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const p2 = (n: number): string => String(n).padStart(2, "0");

/** The date a clock shows when the world is at `t` and the clock is `offsetS` seconds off. */
export const dateAt = (t: number, offsetS = 0): Date =>
  new Date(OS_EPOCH_MS + Math.round((t + offsetS) * 1000));

export const hms = (d: Date): string =>
  `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;

/** `Thu Nov  5 09:12:44 UTC 2026`, the output of `date`. */
export const dateLine = (d: Date): string =>
  `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, " ")} ${hms(d)} UTC ${d.getUTCFullYear()}`;

/** `Thu Nov  5 09:12:44 2026`, the stamp `dmesg -T` prints. */
export const ctime = (d: Date): string =>
  `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, " ")} ${hms(d)} ${d.getUTCFullYear()}`;

/** `Thu 2026-11-05 09:12:44`, the stamp `systemctl status` prints. */
export const sdStamp = (d: Date): string =>
  `${DAYS[d.getUTCDay()]} ${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${hms(d)}`;

/** `Nov 05 09:12:44`, the stamp of a journal line. */
export const journalStamp = (d: Date): string =>
  `${MONTHS[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${hms(d)}`;

/** `Nov  5 09:12:44`, the stamp of a line in /var/log/messages. */
export const syslogStamp = (d: Date): string =>
  `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, " ")} ${hms(d)}`;

/** `2026-11-05 09:12:44`. */
export const ymdHms = (d: Date): string =>
  `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${hms(d)}`;

/** `Nov  5 09:12:44 2026 GMT`, the date format of `openssl x509`. */
export const certDate = (d: Date): string =>
  `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, " ")} ${hms(d)} ${d.getUTCFullYear()} GMT`;

/** `Nov 5 09:12`, the time column of `ls -l`. */
export const lsStamp = (d: Date): string =>
  `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, " ")} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;

export const monthName = (m: number): string => MONTHS[m] ?? "Jan";

/** Seconds as `3 days, 4:05` or `12 min`, the way `uptime` writes it. */
export function uptimeText(s: number): string {
  const days = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const hm = h > 0 ? `${h}:${p2(m)}` : `${m} min`;
  return days > 0 ? `${days} day${days === 1 ? "" : "s"}, ${hm}` : hm;
}

/** `[[dd-]hh:]mm:ss`, the elapsed time `ps -o etime` prints. */
export function etime(s: number): string {
  const n = Math.max(0, Math.floor(s));
  const d = Math.floor(n / 86_400);
  const h = Math.floor((n % 86_400) / 3600);
  const m = Math.floor((n % 3600) / 60);
  const body = `${p2(m)}:${p2(n % 60)}`;
  if (d > 0) return `${d}-${p2(h)}:${body}`;
  return h > 0 ? `${p2(h)}:${body}` : body;
}
