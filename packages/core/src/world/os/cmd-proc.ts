/** Process commands of the fake shell: ps, top, kill, pkill, pgrep, pidof, nice (ADR-0117 decision 2). All read the one process table. */
import { has, parseArgs } from "./args";
import { dateAt, etime, hms, monthName, p2, uptimeText } from "./clock";
import { skewAt } from "./journal";
import { type Proc, processTable } from "./procs";
import { badFlag } from "./real-options";
import { loadAvg, memInfo } from "./sysinfo";
import { act, type Cmd, emulationGap, fail, joinLines, ok, type R } from "./types";

const stateText = (p: Proc): string =>
  p.state === "Z"
    ? "Z"
    : `${p.state}${p.ppid <= 2 && !p.kernel ? "s" : p.kernel ? "" : p.ppid === 1 ? "s" : ""}`;

function startText(c: Cmd, p: Proc): string {
  const d = dateAt(p.startT, skewAt(c.h, p.startT));
  const today = dateAt(c.h.t, skewAt(c.h, c.h.t));
  return d.getUTCDate() === today.getUTCDate() && d.getUTCMonth() === today.getUTCMonth()
    ? `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
    : `${monthName(d.getUTCMonth())}${p2(d.getUTCDate())}`;
}

function cpuTime(c: Cmd, p: Proc): string {
  const secs = Math.floor(((c.h.t - p.startT) * p.cpuPct) / 100);
  return `${Math.floor(secs / 60)}:${p2(secs % 60)}`;
}

const memPct = (c: Cmd, p: Proc): number =>
  Math.round((p.rssKb / 1024 / c.h.memTotalMb) * 1000) / 10;

type Column = { head: string; right: boolean; cell: (c: Cmd, p: Proc) => string };

const COLUMNS: Readonly<Record<string, Column>> = {
  pid: { head: "PID", right: true, cell: (_c, p) => String(p.pid) },
  ppid: { head: "PPID", right: true, cell: (_c, p) => String(p.ppid) },
  user: { head: "USER", right: false, cell: (_c, p) => p.user },
  uid: { head: "UID", right: false, cell: (_c, p) => p.user },
  comm: { head: "COMMAND", right: false, cell: (_c, p) => (p.kernel ? `[${p.comm}]` : p.comm) },
  args: { head: "COMMAND", right: false, cell: (_c, p) => p.args },
  cmd: { head: "CMD", right: false, cell: (_c, p) => p.args },
  command: { head: "COMMAND", right: false, cell: (_c, p) => p.args },
  stat: { head: "STAT", right: false, cell: (_c, p) => stateText(p) },
  s: { head: "S", right: false, cell: (_c, p) => p.state },
  state: { head: "S", right: false, cell: (_c, p) => p.state },
  "%cpu": { head: "%CPU", right: true, cell: (_c, p) => p.cpuPct.toFixed(1) },
  pcpu: { head: "%CPU", right: true, cell: (_c, p) => p.cpuPct.toFixed(1) },
  "%mem": { head: "%MEM", right: true, cell: (c, p) => memPct(c, p).toFixed(1) },
  pmem: { head: "%MEM", right: true, cell: (c, p) => memPct(c, p).toFixed(1) },
  rss: { head: "RSS", right: true, cell: (_c, p) => String(p.rssKb) },
  vsz: { head: "VSZ", right: true, cell: (_c, p) => String(p.vszKb) },
  start: { head: "START", right: true, cell: (c, p) => startText(c, p) },
  lstart: {
    head: "STARTED",
    right: false,
    cell: (c, p) =>
      `${monthName(dateAt(p.startT).getUTCMonth())} ${hms(dateAt(p.startT, skewAt(c.h, p.startT)))}`,
  },
  etime: { head: "ELAPSED", right: true, cell: (c, p) => etime(c.h.t - p.startT) },
  time: { head: "TIME", right: true, cell: (c, p) => cpuTime(c, p) },
  ni: { head: "NI", right: true, cell: (_c, p) => String(p.nice) },
  nice: { head: "NI", right: true, cell: (_c, p) => String(p.nice) },
  nlwp: { head: "NLWP", right: true, cell: (_c, p) => String(p.threads) },
  tty: {
    head: "TT",
    right: false,
    cell: (_c, p) => (p.pid === 1 || p.kernel || p.ppid === 1 ? "?" : "pts/0"),
  },
};

const BSD = ["user", "pid", "%cpu", "%mem", "vsz", "rss", "tty", "stat", "start", "time", "args"];

function render(
  c: Cmd,
  rows: readonly Proc[],
  cols: readonly string[],
  header: boolean,
  heads_?: readonly (string | undefined)[],
): string {
  const defs = cols.map((k) => COLUMNS[k] as Column);
  const cells = rows.map((p) => defs.map((d) => d.cell(c, p)));
  const heads = defs.map((d, i) => heads_?.[i] ?? d.head);
  if (heads_?.length && heads_.every((h) => h === "")) header = false;
  const widths = defs.map((d, i) =>
    Math.max(d.head.length, ...cells.map((r) => (r[i] as string).length)),
  );
  const line = (r: string[]): string =>
    r
      .map((v, i) =>
        i === r.length - 1
          ? v
          : (defs[i] as Column).right
            ? v.padStart(widths[i] as number)
            : v.padEnd(widths[i] as number),
      )
      .join(" ");
  return joinLines([...(header ? [line(heads)] : []), ...cells.map(line)]);
}

const SORT_KEYS: Readonly<Record<string, (c: Cmd, p: Proc) => number>> = {
  pid: (_c, p) => p.pid,
  "%cpu": (_c, p) => p.cpuPct,
  pcpu: (_c, p) => p.cpuPct,
  "%mem": (c, p) => memPct(c, p),
  pmem: (c, p) => memPct(c, p),
  rss: (_c, p) => p.rssKb,
  vsz: (_c, p) => p.vszKb,
  start: (_c, p) => p.startT,
  time: (c, p) => (c.h.t - p.startT) * p.cpuPct,
};

function sorted(c: Cmd, rows: Proc[], spec: string | undefined): Proc[] | undefined {
  if (!spec) return rows;
  const desc = spec.startsWith("-");
  const key = SORT_KEYS[spec.replace(/^[-+]/, "")];
  if (!key) return undefined;
  return [...rows].sort((a, b) => (key(c, a) - key(c, b)) * (desc ? -1 : 1) || a.pid - b.pid);
}

type Flags = ReturnType<typeof parseArgs>;

/** The rows a `ps` call selects: by PID, by name, by user, everything, or only this login's own. */
function psRows(c: Cmd, p: Flags): Proc[] {
  const rows = processTable(c.h);
  const pids = (p.flags.get("p") ?? p.flags.get("--pid"))?.split(",").map(Number);
  const name = p.flags.get("C");
  const user = p.flags.get("U") ?? p.flags.get("--user") ?? namedUser(p);
  if (pids) return rows.filter((r) => pids.includes(r.pid));
  if (name) return rows.filter((r) => r.comm === name);
  if (user) return rows.filter((r) => r.user === user);
  const everything = ["e", "A", "a", "x", "u"].some((f) => has(p, f));
  return everything ? rows : rows.filter((r) => r.user === "ops" && r.comm === "bash");
}

/** `ps -u root`: the word after a bare `-u` is a user name when it looks like one. */
function namedUser(p: Flags): string | undefined {
  return has(p, "u") && p.rest[0] !== undefined && /^[a-z][a-z0-9_-]*$/.test(p.rest[0])
    ? p.rest.shift()
    : undefined;
}

/** `-o pid,rss=` : the columns, and the headers that replace the defaults. */
function formatOf(format: string): { cols: string[]; heads: (string | undefined)[] } {
  const specs = format
    .split(/[ ,]+/)
    .filter(Boolean)
    .map((k) => k.split("="));
  return {
    cols: specs.map(([k]) => (k ?? "").toLowerCase()),
    heads: specs.map(([, ...h]) => (h.length ? h.join("=") : undefined)),
  };
}

/** The format keywords of the real ps (`ps L`, procps-ng 4); the fake knows only some of them. */
const REAL_PS_KEYS = new Set(
  "%cpu %mem ag_id ag_nice args atime blocked bsdstart bsdtime c caught cgname cgroup cgroupns class cls cmd comm command context cp cpuid cputime cputimes cuc cuu drs dsiz egid egroup eip esp etime etimes euid euser exe f fgid fgroup flag flags fname fsgid fsgroup fsuid fsuser fuid fuser gid group ignored intpri ipcns label lastcpu lim longtname lsession lstart luid lwp lxc m_drs m_size m_trs machine maj_flt majflt min_flt minflt mntns ni nice nlwp numa oom oomadj opri ouid pagein pcpu pending pgid pgrp pid pidns pmem policy ppid pri priority psr pss rbytes rchars rgid rgroup rops rss rssize rsz rtprio ruid ruser s sched seat sess session sgi_p sgi_rss sgid sgroup sid sig sig_block sig_catch sig_ignore sig_pend sigcatch sigignore sigmask size slice spid stackp start start_stack start_time stat state stime suid supgid supgrp suser svgid svgroup svuid svuser sz tgid thcount tid time timens times tname tpgid trs trss tsig tsiz tt tty ucmd ucomm uid uname unit user userns uss util utsns uunit vsize vsz wbytes wcbytes wchan wchars wname wops zone".split(
    " ",
  ),
);
const PS_SUPPORTED =
  "-e -A -a -x -f -u -l -w -h -p PID -C 이름 -U 사용자 -o 열(pid ppid user uid comm args stat %cpu %mem rss vsz start etime time ni nlwp tty), --sort=pid|%cpu|%mem|rss|vsz|start|time, aux";

function psSortRefusal(spec: string): R {
  const key = spec.replace(/^[-+]/, "");
  if (!REAL_PS_KEYS.has(key))
    return fail(
      "error: unknown sort specifier\n\nUsage:\n ps [options]\n\n Try 'ps --help <simple|list|output|threads|misc|all>'\n  or 'ps --help <s|l|o|t|m|a>'\n for additional help text.\n\nFor more details see ps(1).",
      1,
    );
  return emulationGap({
    tool: "ps",
    feature: `sort:${key}`,
    what: `--sort=${spec}`,
    supported: PS_SUPPORTED,
    example: "ps aux --sort=-%cpu",
  });
}

function psFormatRefusal(key: string): R {
  if (!REAL_PS_KEYS.has(key))
    return fail(`error: unknown user-defined format specifier "${key}"`, 1);
  return emulationGap({
    tool: "ps",
    feature: `format:${key}`,
    what: `-o ${key}`,
    supported: PS_SUPPORTED,
    example: "ps -eo pid,comm,%cpu",
  });
}

export function ps(c: Cmd): R {
  const args = c.args.map((a, i) => (i === 0 && /^[aux]+$/.test(a) ? `-${a}` : a));
  const p = parseArgs(args, {
    bool: "aAexfuwlLhTeH",
    val: "oOpCU",
    long: { sort: "val", "no-headers": "bool", forest: "bool", pid: "val", user: "val" },
  });
  if (p.bad) return badFlag("ps", p);
  const rows = psRows(c, p);
  const order = sorted(c, rows, p.flags.get("--sort"));
  if (!order) return psSortRefusal(p.flags.get("--sort") as string);
  const header = !has(p, "h") && !has(p, "--no-headers");
  const format = p.flags.get("o") ?? p.flags.get("O");
  if (format !== undefined) {
    const { cols, heads } = formatOf(format);
    const bad = cols.find((k) => !COLUMNS[k]);
    return bad ? psFormatRefusal(bad) : ok(render(c, order, cols, header, heads));
  }
  if (has(p, "f")) return ok(fullFormat(c, order, header));
  return ok(render(c, order, has(p, "u") ? BSD : ["pid", "tty", "time", "comm"], header));
}

function fullFormat(c: Cmd, rows: readonly Proc[], header: boolean): string {
  const body = rows.map(
    (p) =>
      `${p.user.padEnd(8)} ${String(p.pid).padStart(7)} ${String(p.ppid).padStart(7)} ${String(Math.round(p.cpuPct)).padStart(2)} ${startText(c, p).padStart(5)} ${(p.kernel || p.ppid === 1 ? "?" : "pts/0").padEnd(8)} ${cpuTime(c, p).padStart(8)} ${p.args}`,
  );
  return joinLines([
    ...(header ? ["UID          PID    PPID  C STIME TTY          TIME CMD"] : []),
    ...body,
  ]);
}

// ── top ─────────────────────────────────────────────────────────────────────────────────────

const virt = (p: Proc): string => String(p.vszKb);

/** The field names of the real top (`top` field management, procps-ng 4). */
const REAL_TOP_FIELDS = new Set(
  "PID PPID PGRP UID USER GROUP TTY TPGID SID PR NI NU NTH P TIME SWAP CODE DATA NMAJ NMIN NDRT USED %CPU %MEM VIRT RES SHR S COMMAND WCHAN FLAGS CGROUPS SUPGIDS SUPGRPS TGID OOMA OOMS ENVIRON VMJ VMN TIME+ CGNAME".split(
    " ",
  ),
);

function topFieldRefusal(field: string): R {
  const name = field.replace(/^[-+]/, "").toUpperCase();
  if (!REAL_TOP_FIELDS.has(name)) return fail(`top: unrecognized field name '${field}'`, 1);
  return emulationGap({
    tool: "top",
    feature: `sort:${name.toLowerCase()}`,
    what: `-o ${field}`,
    supported: "-b -n N -d 초 -p PID -H -S -i, -o PID|%CPU|%MEM (정렬 열)",
    example: "top -b -n 1 -o %MEM",
  });
}

export function top(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "bHSi", val: "ndoNpw", long: {} });
  if (p.bad) return badFlag("top", p);
  if (!has(p, "b")) return fail("top: failed tty get", 1);
  const field = p.flags.get("o");
  const sortKey = field ? `-${field.replace(/^[-+]/, "").toLowerCase()}` : "-%cpu";
  const picked = p.flags.get("p")?.split(",").map(Number);
  let rows = sorted(
    c,
    processTable(c.h).filter((r) => !picked || picked.includes(r.pid)),
    sortKey,
  );
  if (!rows) return topFieldRefusal(field as string);
  rows = rows.slice(0, 600);
  return ok(joinLines([...topHeader(c), ...topRows(c, rows)]));
}

function topHeader(c: Cmd): string[] {
  const { os } = c.h;
  const all = processTable(c.h);
  const running = all.filter((r) => r.state === "R").length;
  const sleeping = all.length - running - os.zombies;
  const sys = Math.min(os.cpuPct * 0.25, 30);
  const m = memInfo(c.h);
  const [a, b, d] = loadAvg(c.h);
  const clock = hms(dateAt(c.h.t, skewAt(c.h, c.h.t)));
  const f = (n: number): string => n.toFixed(1).padStart(9);
  return [
    `top - ${clock} up ${uptimeText(os.uptimeS)},  1 user,  load average: ${a.toFixed(2)}, ${b.toFixed(2)}, ${d.toFixed(2)}`,
    `Tasks: ${String(all.length).padStart(3)} total, ${String(running).padStart(3)} running, ${String(sleeping).padStart(3)} sleeping,   0 stopped, ${String(os.zombies).padStart(3)} zombie`,
    `%Cpu(s): ${Math.max(0, os.cpuPct - sys)
      .toFixed(1)
      .padStart(4)} us, ${sys.toFixed(1).padStart(4)} sy,  0.0 ni, ${Math.max(0, 100 - os.cpuPct)
      .toFixed(1)
      .padStart(5)} id,  0.1 wa,  0.0 hi,  0.1 si,  0.0 st`,
    `MiB Mem : ${f(m.totalMb)} total, ${f(m.freeMb)} free, ${f(m.usedMb)} used, ${f(m.cacheMb)} buff/cache`,
    `MiB Swap: ${f(8192)} total, ${f(8191)} free, ${f(0)} used. ${f(m.availMb)} avail Mem`,
    "",
    "    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND",
  ];
}

function topRows(c: Cmd, rows: readonly Proc[]): string[] {
  return rows.map((p) => {
    const secs = Math.floor(((c.h.t - p.startT) * p.cpuPct) / 100);
    const time = `${Math.floor(secs / 60)}:${p2(secs % 60)}.${p2(p.pid % 60)}`;
    return `${String(p.pid).padStart(7)} ${p.user.slice(0, 8).padEnd(8)}  20   0 ${virt(p).padStart(7)} ${String(p.rssKb).padStart(6)}  25344 ${p.state} ${p.cpuPct.toFixed(1).padStart(5)} ${memPct(c, p).toFixed(1).padStart(5)} ${time.padStart(9)} ${p.kernel ? `[${p.comm}]` : p.comm}`;
  });
}

// ── kill ────────────────────────────────────────────────────────────────────────────────────

const SIGNALS: Readonly<Record<string, number>> = {
  HUP: 1,
  INT: 2,
  QUIT: 3,
  KILL: 9,
  TERM: 15,
  USR1: 10,
  USR2: 12,
  STOP: 19,
  CONT: 18,
};

/** `-9`, `-KILL`, `-SIGTERM`, `-s TERM` as a signal number; undefined when the word is not one. */
function signalOf(word: string): number | undefined {
  const w = word.replace(/^-/, "").replace(/^SIG/, "").toUpperCase();
  if (/^\d+$/.test(w)) return Number(w);
  return SIGNALS[w];
}

function sendSignal(c: Cmd, pid: number, sig: number): string | undefined {
  const target = processTable(c.h).find((r) => r.pid === pid);
  if (!target) return `bash: kill: (${pid}) - No such process`;
  if (sig === 0 || target.state === "Z" || target.kernel || target.pid === 1 || !target.unit)
    return undefined;
  if (sig === 1 || sig === 10 || sig === 12 || sig === 18) return undefined;
  act(c, "kill", `${pid}:${sig}`);
  return undefined;
}

/** `-s TERM`, `-n 15`, `-TERM`, `-9`: the signal word and the arguments that remain. */
function signalSpec(args: readonly string[]): { spec?: string; rest: string[] } {
  const first = args[0] ?? "";
  if (first === "-s" || first === "-n") return { spec: args[1] ?? "", rest: args.slice(2) };
  if (/^-(\d+|[A-Za-z])/.test(first)) return { spec: first.slice(1), rest: args.slice(1) };
  return { rest: [...args] };
}

export function kill(c: Cmd): R {
  if (c.args[0] === "-l")
    return ok(
      `${Object.keys(SIGNALS)
        .map((k) => `${SIGNALS[k]}) SIG${k}`)
        .join("\n")}\n`,
    );
  const { spec, rest } = signalSpec(c.args);
  const given = spec === undefined ? 15 : signalOf(spec);
  if (given === undefined) return fail(`bash: kill: ${spec}: invalid signal specification`, 1);
  if (rest.length === 0)
    return fail(
      "kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]",
      2,
    );
  const errs = rest
    .map((a) =>
      /^\d+$/.test(a)
        ? sendSignal(c, Number(a), given)
        : `bash: kill: ${a}: arguments must be process or job IDs`,
    )
    .filter((e): e is string => e !== undefined);
  return { out: "", err: errs.length ? `${errs.join("\n")}\n` : "", code: errs.length ? 1 : 0 };
}

function matching(c: Cmd, args: readonly string[], full: boolean): Proc[] {
  const pattern = args.find((a) => !a.startsWith("-"));
  if (!pattern) return [];
  const re = new RegExp(pattern);
  return processTable(c.h).filter(
    (r) => !r.kernel && r.state !== "Z" && re.test(full ? r.args : r.comm),
  );
}

const noCriteria = (tool: string): R => ({
  out: "",
  err: `${tool}: no matching criteria specified\nTry \`${tool} --help' for more information.\n`,
  code: 2,
});

export function pkill(c: Cmd): R {
  if (!c.args.some((a) => !a.startsWith("-"))) return noCriteria("pkill");
  const sigArg = c.args.find(
    (a) => /^-[0-9A-Za-z]+$/.test(a) && a !== "-f" && signalOf(a) !== undefined,
  );
  const sig = sigArg ? (signalOf(sigArg) as number) : 15;
  const found = matching(
    c,
    c.args.filter((a) => a !== sigArg),
    c.args.includes("-f"),
  );
  for (const r of found) sendSignal(c, r.pid, sig);
  return { out: "", code: found.length ? 0 : 1 };
}

export function pgrep(c: Cmd): R {
  if (!c.args.some((a) => !a.startsWith("-"))) return noCriteria("pgrep");
  const found = matching(c, c.args, c.args.includes("-f"));
  if (c.args.includes("-c")) return { out: `${found.length}\n`, code: found.length ? 0 : 1 };
  const rows = found.map((r) =>
    c.args.includes("-a")
      ? `${r.pid} ${r.args}`
      : c.args.includes("-l")
        ? `${r.pid} ${r.comm}`
        : String(r.pid),
  );
  return { out: joinLines(rows), code: found.length ? 0 : 1 };
}

export function pidof(c: Cmd): R {
  const pids = processTable(c.h)
    .filter((r) => c.args.includes(r.comm) && r.state !== "Z")
    .map((r) => r.pid);
  return { out: pids.length ? `${pids.join(" ")}\n` : "", code: pids.length ? 0 : 1 };
}

export function nice(c: Cmd): R {
  const at = c.args.indexOf("-n");
  const rest = at >= 0 ? c.args.slice(at + 2) : c.args;
  return rest.length === 0 ? ok("0\n") : c.run(rest, c.stdin);
}
