/**
 * /var, /tmp, /home and the rest of a fake host's disk (ADR-0117 decision 1). The logs are printed from the event
 * list; the sizes add up to what `df` says: the disk's base level is spread over the system directories and a
 * service's data directory, and what a fault piled on top is the old log files that `ls -l` and `du` show.
 */
import { hash53 } from "@terrarium/core/kernel";
import type { TreeBuilder } from "./fs";
import { culpritName, type OsHost } from "./host";
import { appLogLines, appLogText, dmesgText, systemLogText } from "./journal";
import {
  archiveBytes,
  archivePaths,
  archiveTime,
  baseDiskPct,
  bloatBytes,
  bytesAt,
  GIB,
  MIB,
} from "./layout";

const LINE_BYTES = 110;
/** What the system directories hold, bytes. */
const SYSTEM_BYTES = 4.1 * GIB + 2.2 * GIB + 0.5 * GIB + 0.1 * GIB + 0.6 * GIB + 0.15 * GIB;

/** The file bytes of a log: the lines it holds plus what came before the window. */
const logBytes = (h: OsHost, lines: number, salt: string): number =>
  lines * LINE_BYTES + (4 + (hash53(`${h.id}|${salt}`) % 30)) * MIB + h.t * 40;

/** Binary-looking text for files `cat` should not make sense of. */
const binary = (name: string): string => `\u007fELF\u0002\u0001\u0001 ${name} (binary)\n`;

/** The first lines of a big file, so `head` and `tail` have something to show. */
const sample = (proc: string, i: number): string =>
  Array.from(
    { length: 200 },
    (_, k) => `${proc} archived line ${i * 200 + k + 1}: request handled`,
  ).join("\n");

/** Bytes the old logs of a fault occupy, split among the files that hold them. */
interface Bloat {
  readonly archives: ReadonlyArray<{ path: string; bytes: number }>;
  /** What is left over (a flood's own file, or what a clean-up did not take). */
  readonly rest: number;
}

function bloatOf(h: OsHost, proc: string): Bloat {
  const gone = new Set(h.os.removed ?? []);
  let left = bloatBytes(h.os, h.id);
  const archives = archivePaths(proc).flatMap((path, i) => {
    if (
      gone.has(path) ||
      !h.spans.some((s) => s.type === "disk_full" || s.type === "k8s_disk_pressure")
    )
      return [];
    const bytes = Math.min(left, archiveBytes(h.id, i));
    left -= bytes;
    return bytes > 0 ? [{ path, bytes }] : [];
  });
  return { archives, rest: left };
}

function appLogs(b: TreeBuilder, proc: string): void {
  const h = b.h;
  const bloat = bloatOf(h, proc);
  const flood = h.spans.some((s) => s.type === "log_flood");
  const lines = () => appLogLines(h, proc);
  b.file(`/var/log/${proc}/${proc}.log`, {
    content: () => appLogText(h, proc),
    size: () => (flood ? bloat.rest : logBytes(h, lines(), proc)),
    owner: "appsvc",
    mtime: h.t,
  });
  bloat.archives.forEach((a, i) => {
    b.file(a.path, {
      content: () => sample(proc, i),
      size: a.bytes,
      owner: "appsvc",
      mtime: archiveTime(i),
    });
  });
  if (!flood && bloat.rest > MIB)
    b.file(`/var/log/${proc}/${proc}.log.1`, {
      content: () => sample(proc, 9),
      size: bloat.rest,
      owner: "appsvc",
      mtime: h.t - 86_400,
    });
}

/** What the data directories hold: the base level of the disk less everything else. */
function dataBytes(h: OsHost, services: number): number {
  const logs = (h.services.length + 3) * 24 * MIB;
  return Math.max(GIB, (bytesAt(baseDiskPct(h.id)) - SYSTEM_BYTES - logs) / Math.max(1, services));
}

function stateFiles(b: TreeBuilder): void {
  const h = b.h;
  const names = h.services.map((s) => s.process);
  if (h.db) names.push("pgsql");
  for (const proc of names) {
    const dir = proc === "pgsql" ? "/var/lib/pgsql/data" : `/var/lib/${proc}`;
    const size = dataBytes(h, names.length);
    b.file(proc === "pgsql" ? `${dir}/base/16384.dat` : `${dir}/data/store.dat`, {
      content: () => binary(proc),
      size,
      owner: "appsvc",
      mtime: h.t - 30,
    });
    b.file(`${dir}/state.db`, {
      content: () => binary("state"),
      size: 262_144,
      owner: "appsvc",
      mtime: h.t - (hash53(`${h.id}|st`) % 600),
    });
    b.dir(`${dir}/queue`, "appsvc");
  }
  if (h.db) {
    b.text("/var/lib/pgsql/data/PG_VERSION", "16\n");
    b.text(
      "/var/lib/pgsql/data/postgresql.conf",
      "listen_addresses = '*'\nport = 5432\nmax_connections = 200\n",
    );
    b.text(
      "/var/lib/pgsql/data/pg_hba.conf",
      "local all all peer\nhost all all 10.20.0.0/16 scram-sha-256\n",
    );
  }
}

function systemLogs(b: TreeBuilder): void {
  const h = b.h;
  const log = (file: "messages" | "auth" | "kern" | "cron") => () => systemLogText(h, file);
  const files: Array<[string, "messages" | "auth" | "kern" | "cron", string]> = [
    ["messages", "messages", "root"],
    ["syslog", "messages", "root"],
    ["secure", "auth", "root"],
    ["auth.log", "auth", "root"],
    ["kern.log", "kern", "root"],
    ["cron", "cron", "root"],
  ];
  for (const [name, kind, owner] of files)
    b.file(`/var/log/${name}`, {
      content: log(kind),
      size: () => logBytes(h, 400, name),
      owner,
      mode: 0o600,
      mtime: h.t,
    });
  for (const name of ["messages", "secure", "cron"])
    b.file(`/var/log/${name}-20251221`, {
      content: () => `${name} of the week before, rotated\n`,
      size: 2 * MIB + (hash53(`${h.id}|rot|${name}`) % MIB),
      mode: 0o600,
      mtime: -10 * 86_400,
    });
  b.file("/var/log/dmesg", {
    content: () => dmesgText(h, { human: false }),
    size: 38_000,
    mode: 0o644,
  });
  b.file("/var/log/journal/0123456789abcdef0123456789abcdef/system.journal", {
    content: () => binary("journal"),
    size: 128 * MIB,
    mtime: h.t,
  });
  b.dir("/var/log/audit");
  b.file("/var/log/audit/audit.log", { content: () => "", size: 8 * MIB, mode: 0o600 });
  if (h.db)
    b.file("/var/log/postgresql/postgresql.log", {
      content: () => appLogText(h, "postgresql"),
      size: () => logBytes(h, appLogLines(h, "postgresql"), "pg"),
      owner: "appsvc",
      mtime: h.t,
    });
}

function homeAndTmp(b: TreeBuilder): void {
  const h = b.h;
  b.dir("/tmp");
  b.dir("/tmp/.ICE-unix");
  for (const s of h.services)
    b.file(`/tmp/${s.process}-upload.tmp`, {
      content: () => binary("upload"),
      size: 12_000 + (hash53(`${h.id}|up|${s.process}`) % 280_000),
      owner: "appsvc",
      mtime: h.t - 3600,
    });
  b.text("/home/ops/.bashrc", "# .bashrc\nalias ll='ls -l'\n", { owner: "ops" });
  b.text("/home/ops/.ssh/authorized_keys", "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOps ops@jump\n", {
    owner: "ops",
    mode: 0o600,
  });
  b.dir("/root", "root", 0o700);
  b.dir("/srv");
  b.dir("/mnt");
  b.dir("/run");
  b.dir("/dev/shm");
}

function systemDirs(b: TreeBuilder, bins: readonly string[]): void {
  const h = b.h;
  for (const name of bins)
    b.file(`/usr/bin/${name}`, {
      content: () => binary(name),
      size: 40_000 + (hash53(name) % 900_000),
      mode: 0o755,
    });
  for (const s of h.services)
    b.file(`/opt/app/bin/${s.process}`, {
      content: () => binary(s.process),
      size: 38 * MIB,
      mode: 0o755,
      owner: "appsvc",
    });
  for (const dev of ["null", "zero", "random", "urandom", "tty", "sda", "sda1", "sda2"])
    b.file(`/dev/${dev}`, { content: () => "", size: 0, mode: 0o666 });
  b.file("/boot/vmlinuz-5.14.0-427.el9.x86_64", {
    content: () => binary("vmlinuz"),
    size: 11 * MIB,
  });
  b.file("/boot/initramfs-5.14.0-427.el9.x86_64.img", {
    content: () => binary("initramfs"),
    size: 38 * MIB,
  });
  b.dir("/usr/sbin");
}

export function buildVar(b: TreeBuilder, bins: readonly string[]): void {
  systemLogs(b);
  for (const s of b.h.services) appLogs(b, s.process);
  if (b.h.services.length === 0) appLogs(b, culpritName(b.h));
  stateFiles(b);
  homeAndTmp(b);
  systemDirs(b, bins);
}
