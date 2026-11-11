/** System commands of the fake shell: free, df, uptime, date, hostname, mount, lsblk, reboot, logrotate, uname (ADR-0117 decision 4). */
import { has, parseArgs } from "./args";
import { dateAt, dateLine, hms, uptimeText } from "./clock";
import { human } from "./fmt";
import { normalize } from "./fs";
import { skewAt } from "./journal";
import { GIB, ROOT_BYTES } from "./layout";
import { loadAvg, memInfo } from "./sysinfo";
import { parseTimeSpec } from "./timespec";
import { act, type Cmd, fail, joinLines, ok, type R, unsupported } from "./types";

const nowOf = (c: Cmd): Date => dateAt(c.h.t, skewAt(c.h, c.h.t));

// ── free / df / uptime ──────────────────────────────────────────────────────────────────────

export function free(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "mkgbhwtl", val: "s", long: { human: "bool", si: "bool" } });
  if (p.bad) return unsupported("free", p.bad);
  const m = memInfo(c.h);
  const scale = has(p, "g") ? 1 / 1024 : has(p, "b") ? 1024 * 1024 : has(p, "k") ? 1024 : 1;
  const hum = has(p, "h") || has(p, "--human");
  const show = (mb: number): string =>
    hum
      ? mb === 0
        ? "0B"
        : `${human(mb * 1024 * 1024, "round")}i`
      : String(Math.round(mb * scale));
  const row = (...v: number[]): string => v.map((x) => ` ${show(x)}`.padStart(11)).join("");
  return ok(
    joinLines([
      "               total        used        free      shared  buff/cache   available",
      `Mem:${row(m.totalMb, m.usedMb, m.freeMb, m.sharedMb, m.cacheMb, m.availMb)}`,
      `Swap:${row(m.swapMb, 0, m.swapMb)}`,
    ]),
  );
}

interface FsRow {
  readonly dev: string;
  readonly type: string;
  readonly size: number;
  readonly used: number;
  readonly mount: string;
}

function fsRows(c: Cmd): FsRow[] {
  const used = Math.round((c.h.os.diskPct / 100) * ROOT_BYTES);
  const shm = Math.round((c.h.memTotalMb * 1024 * 1024) / 2);
  return [
    { dev: "devtmpfs", type: "devtmpfs", size: 4 * 1024 * 1024, used: 0, mount: "/dev" },
    { dev: "tmpfs", type: "tmpfs", size: shm, used: 0, mount: "/dev/shm" },
    { dev: "/dev/sda2", type: "ext4", size: ROOT_BYTES, used, mount: "/" },
    {
      dev: "/dev/sda1",
      type: "xfs",
      size: 1014 * 1024 * 1024,
      used: 213 * 1024 * 1024,
      mount: "/boot",
    },
  ];
}

function dfSize(n: number, hum: boolean, block: number): string {
  if (!hum) return String(Math.ceil(n / block));
  if (n < 1024 * 1024) return n === 0 ? "0" : `${Math.ceil((n / 1024 / 1024) * 10) / 10}M`;
  const g = n / GIB;
  return g >= 1000
    ? `${(g / 1024).toFixed(1)}T`
    : g >= 1
      ? `${g >= 10 ? Math.round(g) : g.toFixed(1)}G`
      : `${Math.round(n / 1024 / 1024)}M`;
}

export function df(c: Cmd): R {
  const p = parseArgs(c.args, {
    bool: "hHTiPkmax",
    val: "t",
    long: { "human-readable": "bool", "print-type": "bool" },
  });
  if (p.bad) return unsupported("df", p.bad);
  if (has(p, "i")) return ok(inodeTable(c));
  const hum = has(p, "h") || has(p, "--human-readable") || has(p, "H");
  const block = has(p, "m") ? 1024 * 1024 : 1024;
  let rows = fsRows(c);
  if (p.rest.length > 0) {
    const mounts = p.rest.map((r) => mountOf(normalize(c.cwd, r)));
    const missing = p.rest.find((r) => !c.fs.exists(normalize(c.cwd, r)));
    if (missing) return fail(`df: ${missing}: No such file or directory`, 1);
    rows = rows.filter((r) => mounts.includes(r.mount));
  } else if (!has(p, "a")) rows = rows.filter((r) => r.mount !== "/dev");
  const typeCol = has(p, "T") || has(p, "--print-type");
  const head = `Filesystem     ${typeCol ? "Type     " : ""}${hum ? " Size  Used Avail Use%" : `${block === 1024 ? "1K" : "1M"}-blocks      Used Available Use%`} Mounted on`;
  const body = rows.map((r) => {
    const pct = r.size === 0 ? 0 : Math.ceil((r.used / r.size) * 100);
    const cols = [
      dfSize(r.size, hum, block),
      dfSize(r.used, hum, block),
      dfSize(r.size - r.used, hum, block),
    ];
    const widths = hum ? [5, 5, 5] : [10, 10, 10];
    return `${r.dev.padEnd(14)} ${typeCol ? `${r.type.padEnd(8)} ` : ""}${cols.map((v, i) => v.padStart(widths[i] as number)).join(" ")} ${`${pct}%`.padStart(4)} ${r.mount}`;
  });
  return ok(joinLines([head, ...body]));
}

const mountOf = (path: string): string =>
  path === "/boot" || path.startsWith("/boot/")
    ? "/boot"
    : path === "/dev/shm" || path.startsWith("/dev/shm/")
      ? "/dev/shm"
      : "/";

function inodeTable(c: Cmd): string {
  const used = Math.round((c.h.os.diskPct / 100) * 3_200_000);
  return joinLines([
    "Filesystem      Inodes  IUsed   IFree IUse% Mounted on",
    `/dev/sda2      13107200 ${String(used).padStart(6)} ${String(13_107_200 - used).padStart(8)} ${String(Math.ceil((used / 13_107_200) * 100)).padStart(4)}% /`,
  ]);
}

export function uptime(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "ps", long: { pretty: "bool", since: "bool" } });
  if (p.bad) return unsupported("uptime", p.bad);
  if (has(p, "p") || has(p, "--pretty"))
    return ok(`up ${uptimeText(c.h.os.uptimeS).replace(/ min$/, " minutes")}\n`);
  if (has(p, "s") || has(p, "--since"))
    return ok(`${dateAt(c.h.bootT).toISOString().slice(0, 19).replace("T", " ")}\n`);
  const [a, b, d] = loadAvg(c.h);
  return ok(
    ` ${hms(nowOf(c))} up ${uptimeText(c.h.os.uptimeS)},  1 user,  load average: ${a.toFixed(2)}, ${b.toFixed(2)}, ${d.toFixed(2)}\n`,
  );
}

// ── date / hostname ─────────────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const two = (n: number): string => String(n).padStart(2, "0");

function strftime(d: Date, fmt: string): string {
  const table: Record<string, string> = {
    Y: String(d.getUTCFullYear()),
    y: two(d.getUTCFullYear() % 100),
    m: two(d.getUTCMonth() + 1),
    d: two(d.getUTCDate()),
    e: String(d.getUTCDate()).padStart(2, " "),
    H: two(d.getUTCHours()),
    M: two(d.getUTCMinutes()),
    S: two(d.getUTCSeconds()),
    I: two(d.getUTCHours() % 12 || 12),
    p: d.getUTCHours() < 12 ? "AM" : "PM",
    F: `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`,
    T: hms(d),
    D: `${two(d.getUTCMonth() + 1)}/${two(d.getUTCDate())}/${two(d.getUTCFullYear() % 100)}`,
    s: String(Math.floor(d.getTime() / 1000)),
    Z: "UTC",
    z: "+0000",
    a: (DAY_NAMES[d.getUTCDay()] ?? "").slice(0, 3),
    A: DAY_NAMES[d.getUTCDay()] ?? "",
    b: (MONTH_NAMES[d.getUTCMonth()] ?? "").slice(0, 3),
    B: MONTH_NAMES[d.getUTCMonth()] ?? "",
    u: String(d.getUTCDay() || 7),
    N: "000000000",
    "%": "%",
    n: "\n",
    t: "\t",
  };
  return fmt.replace(/%(.)/g, (m, k: string) => table[k] ?? m);
}

export function date(c: Cmd): R {
  const p = parseArgs(c.args, {
    bool: "uIRs",
    val: "d",
    long: { utc: "bool", date: "val", iso: "bool" },
  });
  if (p.bad) return unsupported("date", p.bad);
  let d = nowOf(c);
  const spec = p.flags.get("d") ?? p.flags.get("--date");
  if (spec !== undefined) {
    const t = parseTimeSpec(spec, c.h.t);
    if (t === undefined) return fail(`date: invalid date '${spec}'`, 1);
    d = dateAt(t, skewAt(c.h, t));
  }
  const fmt = p.rest.find((r) => r.startsWith("+"));
  if (fmt) return ok(`${strftime(d, fmt.slice(1))}\n`);
  if (has(p, "I")) return ok(`${strftime(d, "%F")}\n`);
  if (has(p, "R")) return ok(`${strftime(d, "%a, %d %b %Y %T +0000")}\n`);
  return ok(`${dateLine(d)}\n`);
}

export function hostname(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "sfiIdA" });
  if (p.bad) return unsupported("hostname", p.bad);
  if (has(p, "i") || has(p, "I")) return ok(`${c.h.ip}\n`);
  if (has(p, "f") || has(p, "A")) return ok(`${c.h.name}.dc.local\n`);
  if (has(p, "d")) return ok("dc.local\n");
  return ok(`${c.h.name}\n`);
}

export const whoami = (_c: Cmd): R => ok("ops\n");
export const id = (_c: Cmd): R => ok("uid=1000(ops) gid=1000(ops) groups=1000(ops),10(wheel)\n");

export function uname(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "asrmnvop" });
  if (p.bad) return unsupported("uname", p.bad);
  const all =
    "Linux hostname 5.14.0-427.el9.x86_64 #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux".replace(
      "hostname",
      c.h.name,
    );
  if (has(p, "a")) return ok(`${all}\n`);
  if (has(p, "r")) return ok("5.14.0-427.el9.x86_64\n");
  if (has(p, "n")) return ok(`${c.h.name}\n`);
  if (has(p, "m")) return ok("x86_64\n");
  return ok("Linux\n");
}

// ── mount / lsblk / reboot / logrotate ──────────────────────────────────────────────────────

export function mountText(c: Cmd): string {
  return joinLines([
    `/dev/sda2 on / type ext4 (${c.h.os.fs === "ro" ? "ro" : "rw"},relatime,seclabel,errors=remount-ro)`,
    "/dev/sda1 on /boot type xfs (rw,relatime,seclabel,attr2,inode64)",
    "tmpfs on /dev/shm type tmpfs (rw,nosuid,nodev,seclabel)",
    "proc on /proc type proc (rw,nosuid,nodev,noexec,relatime)",
  ]);
}

export function mount(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "ar", val: "ot", long: {} });
  if (p.bad) return unsupported("mount", p.bad);
  const opts = p.flags.get("o");
  if (opts === undefined) return ok(mountText(c));
  if (opts !== "remount,rw" || !p.rest[0])
    return unsupported("mount", `-o ${opts} ${p.rest.join(" ")}`.trim());
  act(c, "remount_rw");
  return ok("");
}

export function lsblk(c: Cmd): R {
  void c;
  return ok(
    joinLines([
      "NAME   MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS",
      "sda      8:0    0   200G  0 disk",
      "├─sda1   8:1    0     1G  0 part /boot",
      "└─sda2   8:2    0   199G  0 part /",
    ]),
  );
}

export function reboot(c: Cmd): R {
  act(c, "reboot");
  return { out: "", err: `Connection to ${c.h.name} closed by remote host.\n`, code: 0 };
}

export function logrotate(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "fvd", long: {} });
  if (p.bad) return unsupported("logrotate", p.bad);
  const conf = p.rest[0];
  if (!conf) return fail("logrotate 3.18.0 - Copyright (C) 1995-2001 Red Hat, Inc.", 1);
  if (!c.fs.exists(normalize(c.cwd, conf)))
    return fail(`error: stat of ${conf} failed: No such file or directory`, 1);
  if (has(p, "d")) return ok("reading config file /etc/logrotate.conf\n");
  if (c.h.os.fs === "ro")
    return fail(
      "error: error creating output file /var/log/messages-20261105: Read-only file system",
      1,
    );
  act(c, "free_disk", "/var/log");
  return ok("");
}
