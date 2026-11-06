/**
 * The text the fake shell prints (REQ-087, ADR-0091). None of it comes from a real operating system: each function
 * takes the host's state (`HostOs`, see world/os.ts) and writes it in the shape of the real Linux tool's output
 * (RHEL 9 column layout), so an agent that parses `df -h` or `top` parses what it would parse on a real host.
 */
import { SIM_EPOCH_MS } from "@terrarium/core/facades";
import { type HostOs, type OsLine, type OsProcess, processCpuPct } from "@terrarium/core/world";

export interface HostView {
  readonly name: string;
  readonly ip: string;
  readonly os: HostOs;
  /** World time, seconds. */
  readonly t: number;
  readonly memTotalMb: number;
  readonly cores: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const p2 = (n: number): string => String(n).padStart(2, "0");

/** The host's own clock: world time plus how far it has drifted. */
const clock = (v: HostView, t = v.t): Date => new Date(SIM_EPOCH_MS + (t + v.os.ntpOffsetS) * 1000);

const hms = (d: Date): string =>
  `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;

export const dateLine = (v: HostView): string => {
  const d = clock(v);
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, " ")} ${hms(d)} UTC ${d.getUTCFullYear()}`;
};

/** `Nov 05 09:12:44`, the stamp of a journal line. */
const stamp = (v: HostView, t: number): string => {
  const d = clock(v, t);
  return `${MONTHS[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${hms(d)}`;
};

function uptimeText(s: number): string {
  const days = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const hm = h > 0 ? `${h}:${p2(m)}` : `${m} min`;
  return days > 0 ? `${days} day${days === 1 ? "" : "s"}, ${hm}` : hm;
}

const load = (v: HostView): string => {
  const l = (v.os.cpuPct / 100) * v.cores;
  return [l, l * 0.95, l * 0.9].map((x) => x.toFixed(2)).join(", ");
};

export const uptimeLine = (v: HostView): string =>
  ` ${hms(clock(v))} up ${uptimeText(v.os.uptimeS)},  1 user,  load average: ${load(v)}`;

const g = (gb: number): string =>
  gb >= 1000 ? `${(gb / 1024).toFixed(1)}T` : `${Math.round(gb)}G`;

const ROOT_GB = 200;

/** `df -h`; `path` picks the file system a path is on (everything lives on `/`). */
export function dfOutput(v: HostView, path?: string): string {
  const used = (v.os.diskPct / 100) * ROOT_GB;
  const rows = [
    ["devtmpfs", "4.0M", "0", "4.0M", "0%", "/dev"],
    ["tmpfs", g(v.memTotalMb / 2048), "0", g(v.memTotalMb / 2048), "0%", "/dev/shm"],
    ["/dev/sda2", g(ROOT_GB), g(used), g(ROOT_GB - used), `${Math.round(v.os.diskPct)}%`, "/"],
    ["/dev/sda1", "1014M", "213M", "802M", "21%", "/boot"],
  ];
  const shown = path && path !== "/" ? rows.filter((r) => r[5] === "/") : rows;
  const header = "Filesystem      Size  Used Avail Use% Mounted on";
  return [
    header,
    ...shown.map(
      (r) =>
        `${String(r[0]).padEnd(15)} ${String(r[1]).padStart(4)} ${String(r[2]).padStart(5)} ${String(r[3]).padStart(5)} ${String(r[4]).padStart(4)} ${r[5]}`,
    ),
  ].join("\n");
}

export function freeOutput(v: HostView): string {
  const total = v.memTotalMb;
  const used = Math.round((v.os.memPct / 100) * total);
  const cache = Math.round(total * 0.12);
  const free = Math.max(0, total - used - cache);
  const avail = Math.min(total, free + Math.round(cache * 0.85));
  const w = (n: number): string => String(n).padStart(11);
  return [
    "               total        used        free      shared  buff/cache   available",
    `Mem:${w(total)}${w(used)}${w(free)}${w(1203)}${w(cache)}${w(avail)}`,
    `Swap:${w(8191)}${w(0)}${w(8191)}`,
  ].join("\n");
}

const commandOf = (p: OsProcess): string =>
  p.user === "svc" ? `/opt/app/bin/${p.name} --config /etc/${p.name}.conf` : `/usr/sbin/${p.name}`;

const virt = (p: OsProcess, v: HostView): number =>
  Math.round((p.memPct / 100) * v.memTotalMb * 1024 * 1.4);
const res = (p: OsProcess, v: HostView): number =>
  Math.round((p.memPct / 100) * v.memTotalMb * 1024);

function resText(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)}g`;
  return String(kb);
}

export function topOutput(v: HostView): string {
  const { os } = v;
  const running = os.processes.filter((p) => p.state === "running").length;
  const total = 120 + os.processes.length + os.zombies;
  const sys = Math.min(os.cpuPct * 0.25, 30);
  const us = Math.max(0, os.cpuPct - sys);
  const idle = Math.max(0, 100 - os.cpuPct);
  const memUsed = (os.memPct / 100) * v.memTotalMb;
  const cache = v.memTotalMb * 0.12;
  const head = [
    `top - ${hms(clock(v))} up ${uptimeText(os.uptimeS)},  1 user,  load average: ${load(v)}`,
    `Tasks: ${String(total).padStart(3)} total, ${String(running).padStart(3)} running, ${String(total - running - os.zombies).padStart(3)} sleeping,   0 stopped, ${String(os.zombies).padStart(3)} zombie`,
    `%Cpu(s): ${us.toFixed(1).padStart(4)} us, ${sys.toFixed(1).padStart(4)} sy,  0.0 ni, ${idle.toFixed(1).padStart(5)} id,  0.1 wa,  0.0 hi,  0.1 si,  0.0 st`,
    `MiB Mem : ${v.memTotalMb.toFixed(1).padStart(9)} total, ${Math.max(
      0,
      v.memTotalMb - memUsed - cache,
    )
      .toFixed(1)
      .padStart(
        9,
      )} free, ${memUsed.toFixed(1).padStart(9)} used, ${cache.toFixed(1).padStart(9)} buff/cache`,
    "MiB Swap:   8192.0 total,   8191.0 free,      0.0 used.  avail Mem",
    "",
    "    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND",
  ];
  const rows = [...os.processes]
    .sort((a, b) => processCpuPct(os, b) - processCpuPct(os, a) || b.memPct - a.memPct)
    .slice(0, 10)
    .map((p) => {
      const state = p.state === "running" ? "S" : "D";
      const cpu = processCpuPct(os, p);
      const time = `${Math.floor(os.uptimeS / 3600)}:${p2(Math.floor((os.uptimeS % 3600) / 60))}.${p2(p.pid % 60)}`;
      return `${String(p.pid).padStart(7)} ${p.user.slice(0, 8).padEnd(8)}  20   0 ${String(virt(p, v)).padStart(7)} ${resText(res(p, v)).padStart(6)}  25344 ${state} ${cpu.toFixed(1).padStart(5)} ${p.memPct.toFixed(1).padStart(5)} ${time.padStart(9)} ${p.name}`;
    });
  return [...head, ...rows].join("\n");
}

export function psOutput(v: HostView): string {
  const { os } = v;
  const header = "USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND";
  const init =
    "root           1  0.0  0.1 172256 16188 ?        Ss   Oct29   0:08 /usr/lib/systemd/systemd --switched-root --system --deserialize 31";
  const rows = os.processes.map((p) => {
    const stat = p.state === "running" ? "Ss" : "Ds";
    return `${p.user.slice(0, 8).padEnd(8)} ${String(p.pid).padStart(6)} ${processCpuPct(os, p).toFixed(1).padStart(4)} ${p.memPct.toFixed(1).padStart(4)} ${String(virt(p, v)).padStart(6)} ${String(res(p, v)).padStart(5)} ?        ${stat}   Oct29  ${Math.floor(os.uptimeS / 3600)}:${p2(p.pid % 60)} ${commandOf(p)}`;
  });
  const parent = os.processes.find((p) => p.user === "svc");
  const zombies = Array.from({ length: Math.min(os.zombies, 5000) }, (_, i) => {
    const pid = 20_000 + i * 3;
    return `${(parent?.user ?? "svc").padEnd(8)} ${String(pid).padStart(6)}  0.0  0.0      0     0 ?        Z    ${hms(clock(v, v.t - 60))}   0:00 [${parent?.name ?? "worker"}] <defunct>`;
  });
  return [header, init, ...rows, ...zombies].join("\n");
}

export const mountOutput = (v: HostView): string =>
  [
    "/dev/sda2 on / type ext4 (" +
      (v.os.fs === "ro" ? "ro" : "rw") +
      ",relatime,seclabel,errors=remount-ro)",
    "/dev/sda1 on /boot type xfs (rw,relatime,seclabel,attr2,inode64)",
    "tmpfs on /dev/shm type tmpfs (rw,nosuid,nodev,seclabel)",
  ].join("\n");

export function chronycOutput(v: HostView): string {
  const off = v.os.ntpOffsetS;
  const lines = [
    "Reference ID    : 0A140002 (ntp1.dc.local)",
    "Stratum         : 3",
    `Ref time (UTC)  : ${dateLine(v)}`,
    `System time     : ${Math.abs(off).toFixed(9)} seconds ${off < 0 ? "slow" : "fast"} of NTP time`,
    `Last offset     : ${off >= 0 ? "+" : "-"}${Math.abs(off).toFixed(9)} seconds`,
    "RMS offset      : 0.000021349 seconds",
    "Frequency       : 3.412 ppm slow",
    `Leap status     : ${Math.abs(off) > 1 ? "Not synchronised" : "Normal"}`,
  ];
  return lines.join("\n");
}

const LEVEL_ORDER = { info: 0, warn: 1, err: 2 } as const;

export interface JournalOptions {
  readonly n: number;
  readonly unit?: string;
  readonly errorsOnly: boolean;
}

/** `journalctl`: the last lines of the host's log, oldest first. */
export function journalOutput(v: HostView, o: JournalOptions): string {
  const pidOf = (unit: string): number => v.os.processes.find((p) => p.name === unit)?.pid ?? 1;
  const keep = (l: OsLine): boolean =>
    (o.unit === undefined || l.unit === o.unit || l.unit === "systemd") &&
    (!o.errorsOnly || LEVEL_ORDER[l.level] >= 1);
  const lines = v.os.log.filter(keep).slice(-o.n);
  if (lines.length === 0) return "-- No entries --";
  return lines
    .map(
      (l) =>
        `${stamp(v, l.t)} ${v.name} ${l.unit}${l.unit === "kernel" ? "" : `[${pidOf(l.unit)}]`}: ${l.msg}`,
    )
    .join("\n");
}

/** `dmesg`: the kernel's lines with seconds since boot. */
export function dmesgOutput(v: HostView): string {
  const boot = v.t - v.os.uptimeS;
  const lines = v.os.log.filter((l) => l.unit === "kernel");
  const rows = lines.map(
    (l) =>
      `[${Math.max(0, l.t - boot)
        .toFixed(6)
        .padStart(12)}] ${l.msg}`,
  );
  return rows.length > 0
    ? rows.join("\n")
    : `[    0.000000] Linux version 5.14.0-427.el9.x86_64 (mockbuild@x86-64-03)\n[    0.000000] Command line: BOOT_IMAGE=(hd0,msdos1)/vmlinuz-5.14.0-427.el9.x86_64 root=/dev/sda2 ro`;
}

/** `systemctl status <unit>`. */
export function statusOutput(v: HostView, p: OsProcess): string {
  const { os } = v;
  const since = stamp(v, v.t - os.uptimeS).replace(/^\w+ /, "");
  const active =
    p.state === "running"
      ? `active (running) since ${since}; ${uptimeText(os.uptimeS)} ago`
      : p.state === "restarting"
        ? `activating (auto-restart) (Result: exit-code) since ${stamp(v, v.t - 5)}; 5s ago`
        : p.state === "failed"
          ? "failed (Result: exit-code)"
          : "inactive (dead)";
  const dot = p.state === "running" ? "●" : p.state === "stopped" ? "○" : "×";
  const lines = [
    `${dot} ${p.name}.service - ${p.name}`,
    `     Loaded: loaded (/etc/systemd/system/${p.name}.service; enabled; preset: disabled)`,
    `     Active: ${active}`,
  ];
  if (p.state === "running")
    lines.push(
      `   Main PID: ${p.pid} (${p.name})`,
      `      Tasks: 12 (limit: 1648954)`,
      `     Memory: ${(((p.memPct / 100) * v.memTotalMb) / 1024).toFixed(1)}G`,
      `     CGroup: /system.slice/${p.name}.service`,
      `             └─${p.pid} ${commandOf(p)}`,
    );
  else
    lines.push(`    Process: ${p.pid} ExecStart=${commandOf(p)} (code=exited, status=1/FAILURE)`);
  const recent = os.log.filter((l) => l.unit === p.name || l.unit === "systemd").slice(-3);
  return [
    ...lines,
    "",
    ...recent.map(
      (l) => `${stamp(v, l.t)} ${v.name} ${l.unit}[${l.unit === "systemd" ? 1 : p.pid}]: ${l.msg}`,
    ),
  ].join("\n");
}
