/**
 * The shape of the fake host's disk and network, shared by the file tree, the process table and the commands
 * (ADR-0117): where a service keeps its files, which port it listens on, how big the bloat a fault left is.
 * Everything is a function of the host's stored state, so `df`, `du` and `ls -l` always agree.
 */
import { hash53 } from "@terrarium/core/kernel";
import type { HostOs } from "../os";

export const GIB = 1024 ** 3;
export const MIB = 1024 ** 2;
export const ROOT_GB = 200;
export const ROOT_BYTES = ROOT_GB * GIB;
/** The size of the disk the shell reports, in bytes, for a disk at `pct` percent. */
export const bytesAt = (pct: number): number => Math.round((pct / 100) * ROOT_BYTES);

/** Where the disk of host `id` stands when nothing has bloated it: the same figure a healthy host starts with (os.ts). */
export const baseDiskPct = (id: string): number => Math.round(spread(id, "disk", 38, 61) * 10) / 10;

/** What the old logs of a fault hold: the disk above its base level. */
export const bloatBytes = (os: HostOs, id: string): number =>
  Math.max(0, bytesAt(os.diskPct) - bytesAt(baseDiskPct(id)));

/** The share of a full bloat each old log file holds, oldest first. */
export const ARCHIVE_SHARES: readonly number[] = [0.4, 0.3, 0.2, 0.1];
const ARCHIVE_DATES = ["20251204", "20251211", "20251218", "20251225"];

/** The dated logs an application leaves in its directory; a full disk is mostly these. */
export const archivePaths = (proc: string): string[] =>
  ARCHIVE_DATES.map((d) => `/var/log/${proc}/${proc}-${d}.log`);

/** World time the old log file `i` was last written (its name is the date; the world began on 2026-01-01). */
export const archiveTime = (i: number): number => -(28 - 7 * i) * 86_400;

/** The size of old log file `i` when the disk is full. */
export const archiveBytes = (id: string, i: number): number =>
  Math.round((ARCHIVE_SHARES[i] ?? 0) * (ROOT_BYTES - bytesAt(baseDiskPct(id))));

/** The port a service listens on, between 8000 and 8999. */
export const portOf = (proc: string): number => 8000 + (hash53(`port|${proc}`) % 1000);

export const DB_PORT = 5432;
/** The resolvers a healthy host asks, and the dead one a DNS fault leaves in resolv.conf. */
export const RESOLVERS: readonly string[] = ["10.20.0.53", "10.20.0.54"];
export const DEAD_RESOLVER = "10.20.99.53";
export const NTP_SOURCE = "10.20.0.2";

/** A number between `lo` and `hi` that depends only on the id and a salt. */
export const spread = (id: string, salt: string, lo: number, hi: number): number =>
  lo + (hash53(`${id}|${salt}`) % 1000) * ((hi - lo) / 1000);

/** The unit files a host has besides its services. */
export const SYSTEM_UNITS: readonly string[] = [
  "systemd-journald",
  "sshd",
  "chronyd",
  "systemd-resolved",
  "rsyslogd",
  "crond",
];

/** The command line a process runs, the way `ps` prints it. */
export const commandLine = (name: string, appService: boolean): string =>
  appService ? `/opt/app/bin/${name} --config /etc/${name}.conf` : `/usr/sbin/${name}`;
