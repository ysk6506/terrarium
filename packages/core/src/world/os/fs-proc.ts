/** /proc of a fake host (ADR-0117 decision 1 and 2): system files from the host's numbers, one directory per process. */
import { hash53 } from "@terrarium/core/kernel";
import type { TreeBuilder } from "./fs";
import type { OsHost } from "./host";
import { type Proc, processTable } from "./procs";
import { loadAvg, memInfo } from "./sysinfo";

const CPU_MODEL = "Intel(R) Xeon(R) Gold 6430 CPU @ 2.10GHz";
/** Zombies get a /proc directory only for the first few; listing 30000 of them helps nobody. */
const ZOMBIE_DIRS = 50;

function cpuinfo(h: OsHost): string {
  return Array.from({ length: Math.min(h.cores, 128) }, (_, i) =>
    [
      `processor\t: ${i}`,
      "vendor_id\t: GenuineIntel",
      `model name\t: ${CPU_MODEL}`,
      `cpu MHz\t\t: ${(2100 + (hash53(`${h.id}|mhz|${i}`) % 300)).toFixed(3)}`,
      "cache size\t: 61440 KB",
      `physical id\t: ${Math.floor(i / 32)}`,
      `core id\t\t: ${i % 32}`,
      `cpu cores\t: ${Math.min(h.cores, 32)}`,
      "",
    ].join("\n"),
  ).join("\n");
}

const kb = (mb: number): string => String(Math.round(mb * 1024)).padStart(12);

function meminfo(h: OsHost): string {
  const m = memInfo(h);
  return [
    ["MemTotal", m.totalMb],
    ["MemFree", m.freeMb],
    ["MemAvailable", m.availMb],
    ["Buffers", 2],
    ["Cached", m.cacheMb],
    ["SwapCached", 0],
    ["Active", Math.round(m.usedMb * 0.6)],
    ["Inactive", Math.round(m.usedMb * 0.3)],
    ["SwapTotal", m.swapMb],
    ["SwapFree", m.swapMb],
    ["Shmem", m.sharedMb],
    ["AnonPages", m.usedMb],
  ]
    .map(([k, v]) => `${`${k}:`.padEnd(16)}${kb(v as number)} kB`)
    .join("\n");
}

function loadavg(h: OsHost): string {
  const [a, b, c] = loadAvg(h);
  const running = 1 + Math.round(h.os.cpuPct / 25);
  return `${a.toFixed(2)} ${b.toFixed(2)} ${c.toFixed(2)} ${running}/${180 + h.os.zombies} ${90_000 + (hash53(`${h.t}`) % 900)}\n`;
}

const STATE_WORD: Readonly<Record<Proc["state"], string>> = {
  R: "R (running)",
  S: "S (sleeping)",
  D: "D (disk sleep)",
  Z: "Z (zombie)",
};

function status(p: Proc): string {
  const mem = p.state === "Z" ? [] : [`VmSize:\t${p.vszKb} kB`, `VmRSS:\t${p.rssKb} kB`];
  return [
    `Name:\t${p.comm}`,
    `State:\t${STATE_WORD[p.state]}`,
    `Tgid:\t${p.pid}`,
    `Pid:\t${p.pid}`,
    `PPid:\t${p.ppid}`,
    `Uid:\t${p.user === "root" ? 0 : 1000}\t${p.user === "root" ? 0 : 1000}`,
    ...mem,
    `Threads:\t${p.threads}`,
    "",
  ].join("\n");
}

function stat(p: Proc, h: OsHost): string {
  const ticks = Math.round((h.t - p.startT) * 100);
  const fields = Array.from({ length: 52 }, () => "0");
  fields[2] = p.state;
  fields[3] = String(p.ppid);
  fields[13] = String(Math.round(ticks * (p.cpuPct / 100)));
  fields[21] = String(Math.round((p.startT - h.bootT) * 100));
  fields[23] = String(Math.round(p.rssKb / 4));
  fields[0] = String(p.pid);
  fields[1] = `(${p.comm})`;
  return `${fields.join(" ")}\n`;
}

function procDir(b: TreeBuilder, p: Proc): void {
  const base = `/proc/${p.pid}`;
  b.dir(base, p.user);
  b.file(`${base}/status`, { content: () => status(p), size: 0 });
  b.file(`${base}/cmdline`, { content: () => (p.state === "Z" ? "" : p.args), size: 0 });
  b.file(`${base}/comm`, { content: () => `${p.comm}\n`, size: 0 });
  b.file(`${base}/stat`, { content: () => stat(p, b.h), size: 0 });
}

export function buildProc(b: TreeBuilder): void {
  const h = b.h;
  b.dir("/proc");
  b.file("/proc/cpuinfo", { content: () => cpuinfo(h), size: 0 });
  b.file("/proc/meminfo", { content: () => `${meminfo(h)}\n`, size: 0 });
  b.file("/proc/loadavg", { content: () => loadavg(h), size: 0 });
  b.file("/proc/uptime", {
    content: () => `${h.os.uptimeS.toFixed(2)} ${(h.os.uptimeS * h.cores * 0.9).toFixed(2)}\n`,
    size: 0,
  });
  b.file("/proc/version", {
    content: () =>
      "Linux version 5.14.0-427.el9.x86_64 (mockbuild@x86-64-03) #1 SMP PREEMPT_DYNAMIC\n",
    size: 0,
  });
  b.file("/proc/cmdline", {
    content: () => "BOOT_IMAGE=(hd0,msdos1)/vmlinuz-5.14.0-427.el9.x86_64 root=/dev/sda2 ro\n",
    size: 0,
  });
  b.file("/proc/mounts", {
    content: () =>
      `/dev/sda2 / ext4 ${h.os.fs === "ro" ? "ro" : "rw"},relatime,errors=remount-ro 0 0\n/dev/sda1 /boot xfs rw,relatime 0 0\ntmpfs /dev/shm tmpfs rw,nosuid,nodev 0 0\n`,
    size: 0,
  });
  const rows = processTable(h);
  let zombies = 0;
  for (const p of rows) {
    if (p.state === "Z" && ++zombies > ZOMBIE_DIRS) continue;
    procDir(b, p);
  }
}
