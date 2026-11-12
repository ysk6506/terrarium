/** File commands of the fake shell: ls, du, stat, find, rm, truncate, which, env (ADR-0117 decisions 1 and 4). */
import { has, parseArgs } from "./args";
import { ctime, dateAt, OS_EPOCH_MS } from "./clock";
import { blocks1k, human, longLine, modeText } from "./fmt";
import { baseName, normalize } from "./fs";
import { badFlag, refuseUnknown } from "./real-options";
import { act, type Cmd, emulationGap, fail, joinLines, ok, type R } from "./types";

export const shown = (c: Cmd, given: string): string => normalize(c.cwd, given);

// ── ls ──────────────────────────────────────────────────────────────────────────────────────

type Flags = ReturnType<typeof parseArgs>;

/** Whether `ls` lists what is in the path: a directory, or a link to one that `-l` and `-d` do not ask about. */
function listable(
  c: Cmd,
  st: NonNullable<ReturnType<Cmd["fs"]["stat"]>>,
  path: string,
  p: Flags,
): boolean {
  if (has(p, "d")) return false;
  return st.type === "d" || (st.type === "l" && !has(p, "l") && c.fs.isDir(path));
}

export function ls(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "lahA1RdtSrFhi" });
  if (p.bad) return badFlag("ls", p);
  const targets = p.rest.length ? p.rest : ["."];
  const out: string[] = [];
  const errs: string[] = [];
  const multi = targets.length > 1 || has(p, "R");
  for (const t of targets) {
    const path = shown(c, t);
    const st = c.fs.stat(path);
    if (!st) errs.push(`ls: cannot access '${t}': No such file or directory`);
    else if (!listable(c, st, path, p)) out.push(has(p, "l") ? longLine(t, st, has(p, "h")) : t);
    else listDir(c, p, path, t, multi, out);
  }
  return {
    out: joinLines(out),
    err: errs.length ? `${errs.join("\n")}\n` : "",
    code: errs.length ? 2 : 0,
  };
}

function sortEntries<T extends { st?: { size: number; mtime: number } | undefined }>(
  entries: T[],
  p: Flags,
): T[] {
  if (has(p, "S")) entries.sort((a, b) => (b.st?.size ?? 0) - (a.st?.size ?? 0));
  else if (has(p, "t")) entries.sort((a, b) => (b.st?.mtime ?? 0) - (a.st?.mtime ?? 0));
  return has(p, "r") ? entries.reverse() : entries;
}

function listDir(
  c: Cmd,
  p: Flags,
  path: string,
  label: string,
  header: boolean,
  out: string[],
): void {
  const visible = (c.fs.list(path) ?? []).filter(
    (n) => has(p, "a") || has(p, "A") || !n.startsWith("."),
  );
  const entries = sortEntries(
    visible.map((n) => ({ n, st: c.fs.stat(path === "/" ? `/${n}` : `${path}/${n}`) })),
    p,
  );
  if (header) out.push(`${label}:`);
  if (has(p, "l")) {
    out.push(`total ${entries.reduce((s, e) => s + blocks1k(e.st?.size ?? 0), 0)}`);
    for (const e of entries) if (e.st) out.push(longLine(e.n, e.st, has(p, "h")));
  } else out.push(...entries.map((e) => `${e.n}${has(p, "F") && e.st?.type === "d" ? "/" : ""}`));
  if (!has(p, "R")) return;
  for (const e of entries) {
    if (e.st?.type !== "d") continue;
    out.push("");
    listDir(c, p, `${path === "/" ? "" : path}/${e.n}`, `${label}/${e.n}`, true, out);
  }
}

// ── du ──────────────────────────────────────────────────────────────────────────────────────

/** How `du` writes a size: `-h`, `-b`, `-m`, or 1K blocks. */
function duUnit(p: Flags): (n: number) => string {
  if (has(p, "h") || has(p, "--human-readable")) return human;
  if (has(p, "b")) return String;
  if (has(p, "m")) return (n) => String(Math.ceil(n / 1048576));
  return (n) => String(blocks1k(n));
}

function duDepth(p: Flags): number {
  if (has(p, "s") || has(p, "--summarize")) return 0;
  const arg = p.flags.get("d") ?? p.flags.get("--max-depth");
  return arg === undefined ? Number.POSITIVE_INFINITY : Number(arg);
}

export function du(c: Cmd): R {
  const p = parseArgs(c.args, {
    bool: "shcaxbkm",
    val: "d",
    long: {
      "max-depth": "val",
      "apparent-size": "bool",
      summarize: "bool",
      "human-readable": "bool",
      total: "bool",
    },
  });
  if (p.bad) return badFlag("du", p);
  const unit = duUnit(p);
  const options: DuOptions = { max: duDepth(p), all: has(p, "a"), unit };
  const rows: string[] = [];
  const errs: string[] = [];
  let total = 0;
  for (const t of p.rest.length ? p.rest : ["."]) {
    const path = shown(c, t);
    if (!c.fs.exists(path)) {
      errs.push(`du: cannot access '${t}': No such file or directory`);
      continue;
    }
    total += c.fs.usage(path);
    walkDu(c, path, t, 0, options, rows);
  }
  if (has(p, "c") || has(p, "--total")) rows.push(`${unit(total)}\ttotal`);
  return {
    out: joinLines(rows),
    err: errs.length ? `${errs.join("\n")}\n` : "",
    code: errs.length ? 1 : 0,
  };
}

interface DuOptions {
  readonly max: number;
  readonly all: boolean;
  readonly unit: (n: number) => string;
}

function walkDu(
  c: Cmd,
  path: string,
  label: string,
  depth: number,
  o: DuOptions,
  rows: string[],
): void {
  const st = c.fs.stat(path);
  if (!st) return;
  if (st.type === "d" && depth < o.max)
    for (const n of c.fs.list(path) ?? [])
      walkDu(
        c,
        path === "/" ? `/${n}` : `${path}/${n}`,
        `${label === "/" ? "" : label}/${n}`,
        depth + 1,
        o,
        rows,
      );
  if (st.type === "d" || o.all || depth === 0) rows.push(`${o.unit(c.fs.usage(path))}\t${label}`);
}

// ── stat ────────────────────────────────────────────────────────────────────────────────────

const FORMATS: Readonly<
  Record<string, (s: NonNullable<ReturnType<Cmd["fs"]["stat"]>>, c: Cmd) => string>
> = {
  n: (s) => s.path,
  s: (s) => String(s.size),
  a: (s) => (s.mode & 0o777).toString(8),
  A: (s) => modeText(s.type, s.mode),
  U: (s) => s.owner,
  G: (s) => s.group,
  Y: (s) => String(Math.round(s.mtime + OS_EPOCH_MS / 1000)),
  y: (s) => `${ctime(dateAt(s.mtime))} UTC`,
  F: (s) => (s.type === "d" ? "directory" : s.type === "l" ? "symbolic link" : "regular file"),
  b: (s) => String(blocks1k(s.size) * 2),
};

export function stat(c: Cmd): R {
  const p = parseArgs(c.args, {
    bool: "L",
    val: "c",
    long: { format: "val", "file-system": "bool" },
  });
  if (p.bad) return badFlag("stat", p);
  const fmt = p.flags.get("c") ?? p.flags.get("--format");
  const out: string[] = [];
  const errs: string[] = [];
  for (const f of p.rest) {
    const s = c.fs.stat(shown(c, f));
    if (!s) errs.push(`stat: cannot statx '${f}': No such file or directory`);
    else if (fmt !== undefined)
      out.push(fmt.replace(/%(.)/g, (_m, k: string) => FORMATS[k]?.(s, c) ?? `%${k}`));
    else out.push(...statBlock(s));
  }
  return {
    out: joinLines(out),
    err: errs.length ? `${errs.join("\n")}\n` : "",
    code: errs.length ? 1 : 0,
  };
}

function statBlock(s: NonNullable<ReturnType<Cmd["fs"]["stat"]>>): string[] {
  const when = `${ctime(dateAt(s.mtime))} +0000`;
  return [
    `  File: ${s.path}`,
    `  Size: ${String(s.size).padEnd(10)}Blocks: ${String(blocks1k(s.size) * 2).padEnd(10)} IO Block: 4096   ${FORMATS.F?.(s, undefined as never)}`,
    "Device: 802h/2050d\tInode: 131074      Links: 1",
    `Access: (${(s.mode & 0o777).toString(8).padStart(4, "0")}/${modeText(s.type, s.mode)})  Uid: (${s.owner === "root" ? "    0" : " 1000"}/${s.owner.padStart(8)})   Gid: (${s.group === "root" ? "    0" : " 1000"}/${s.group.padStart(8)})`,
    `Access: ${when}`,
    `Modify: ${when}`,
    `Change: ${when}`,
    " Birth: -",
  ];
}

// ── rm / truncate ───────────────────────────────────────────────────────────────────────────

export function removeAll(
  c: Cmd,
  paths: readonly string[],
  recursive: boolean,
  force: boolean,
  prior = "",
): R {
  const errs: string[] = [];
  const gone: string[] = [];
  let freed = 0;
  for (const raw of paths) {
    const path = shown(c, raw);
    const st = c.fs.stat(path);
    const denied = c.fs.denyRemove(path);
    if (path === "/") errs.push("rm: it is dangerous to operate recursively on '/'");
    else if (!st) {
      if (!force) errs.push(`rm: cannot remove '${raw}': No such file or directory`);
    } else if (st.type === "d" && !recursive)
      errs.push(`rm: cannot remove '${raw}': Is a directory`);
    else if (denied)
      errs.push(
        `rm: cannot remove '${raw}': ${denied === "ro" ? "Read-only file system" : "Operation not permitted"}`,
      );
    else {
      gone.push(path);
      freed += c.fs.usage(path);
    }
  }
  if (gone.length > 0) act(c, "remove", gone.join("\n"), String(freed));
  const err = `${prior}${errs.length ? `${errs.join("\n")}\n` : ""}`;
  return { out: "", err, code: errs.length ? 1 : 0 };
}

export function rm(c: Cmd): R {
  const p = parseArgs(c.args, {
    bool: "rRfvdi",
    long: {
      recursive: "bool",
      force: "bool",
      "no-preserve-root": "bool",
      verbose: "bool",
      dir: "bool",
    },
  });
  if (p.bad) return badFlag("rm", p);
  if (p.rest.length === 0) return fail("rm: missing operand", 1);
  const recursive = has(p, "r") || has(p, "R") || has(p, "--recursive");
  const r = removeAll(c, p.rest, recursive, has(p, "f") || has(p, "--force"));
  return has(p, "v") && r.code === 0
    ? { ...r, out: joinLines(p.rest.map((f) => `removed '${f}'`)) }
    : r;
}

/** A size other than 0: the real truncate takes any size (`4096`, `+1K`, `%512`) and refuses a word that is none; this one only empties. */
function truncateOther(size: string): R {
  if (!/^[+\-<>/%]?\d+([KMGTPEZY]|[KMGTPEZY]?iB|[KMGTPEZY]B)?$/.test(size))
    return fail(`truncate: Invalid number: ‘${size}’`, 1);
  return emulationGap({
    tool: "truncate",
    feature: "size-other-than-zero",
    what: `-s ${size}`,
    supported: "-s 0 (파일 비우기), -c",
    example: "touch /tmp/terrarium-trunc && truncate -s 0 /tmp/terrarium-trunc",
  });
}

export function truncate(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "c", val: "s", long: { size: "val" } });
  if (p.bad) return badFlag("truncate", p);
  const size = p.flags.get("s") ?? p.flags.get("--size");
  if (size === undefined || p.rest.length === 0)
    return fail("truncate: you must specify either '--size' or '--reference'", 1);
  if (size !== "0") return truncateOther(size);
  const errs: string[] = [];
  for (const f of p.rest) {
    const path = shown(c, f);
    const denied = c.fs.denyWrite(path);
    const st = c.fs.stat(path);
    if (denied)
      errs.push(
        `truncate: cannot open '${f}' for writing: ${denied === "ro" ? "Read-only file system" : "Permission denied"}`,
      );
    else if (!st) errs.push(`truncate: cannot open '${f}' for writing: No such file or directory`);
    else act(c, "truncate", path, String(st.size));
  }
  return { out: "", err: errs.length ? `${errs.join("\n")}\n` : "", code: errs.length ? 1 : 0 };
}

// ── small ones ──────────────────────────────────────────────────────────────────────────────

export function whichCmd(c: Cmd, known: (name: string) => boolean): R {
  const found = c.args.filter((a) => !a.startsWith("-") && known(a));
  const missing = c.args.filter((a) => !a.startsWith("-") && !known(a));
  const err = missing
    .map((m) => `/usr/bin/which: no ${m} in (/usr/local/bin:/usr/bin:/usr/local/sbin:/usr/sbin)`)
    .join("\n");
  return {
    out: joinLines(found.map((f) => `/usr/bin/${f}`)),
    err: err ? `${err}\n` : "",
    code: missing.length ? 1 : 0,
  };
}

export function env(c: Cmd): R {
  const rows = [
    "SHELL=/bin/bash",
    `HOSTNAME=${c.h.name}`,
    "USER=ops",
    "LANG=en_US.UTF-8",
    `PWD=${c.cwd}`,
    "HOME=/home/ops",
    "LOGNAME=ops",
    "PATH=/usr/local/bin:/usr/bin:/usr/local/sbin:/usr/sbin",
    "TERM=xterm-256color",
  ];
  return ok(
    joinLines(
      c.name === "printenv" && c.args[0]
        ? rows.filter((r) => r.startsWith(`${c.args[0]}=`)).map((r) => r.split("=")[1] as string)
        : rows,
    ),
  );
}

// ── touch / cp / mv ─────────────────────────────────────────────────────────────────────────

function writeOne(c: Cmd, name: string, text: string): string | undefined {
  const path = shown(c, name);
  const denied = c.fs.denyWrite(path);
  if (denied)
    return `${c.name}: cannot create regular file '${name}': ${denied === "ro" ? "Read-only file system" : "Permission denied"}`;
  if (!c.fs.isDir(path.slice(0, path.lastIndexOf("/")) || "/"))
    return `${c.name}: cannot create regular file '${name}': No such file or directory`;
  act(c, "write", path, text);
  return undefined;
}

export function touch(c: Cmd): R {
  const files = c.args.filter((a) => !a.startsWith("-"));
  if (files.length === 0) return fail("touch: missing file operand", 1);
  const errs = files
    .map((f) => (c.fs.exists(shown(c, f)) ? undefined : writeOne(c, f, "")))
    .filter((e): e is string => e !== undefined);
  return { out: "", err: errs.length ? `${errs.join("\n")}\n` : "", code: errs.length ? 1 : 0 };
}

/** What cp and mv do in the real tools and this one does not: whole directories and several sources. */
function copyGap(c: Cmd, from: string, operands: number): R | undefined {
  const base = { tool: c.name, example: "cp /etc/hosts /tmp/hosts.copy" };
  if (c.fs.isDir(shown(c, from)))
    return emulationGap({
      ...base,
      feature: "directory",
      what: "디렉터리 통째로",
      supported: `${c.name} 파일 대상 (파일 하나를 한 곳으로)`,
    });
  if (operands > 2)
    return emulationGap({
      ...base,
      feature: "several-sources",
      what: "여러 원본을 한 디렉터리로",
      supported: `${c.name} 원본 대상 (인자 두 개)`,
    });
  return undefined;
}

export function cp(c: Cmd): R {
  const unknown = refuseUnknown(c.name, c.args);
  if (unknown) return unknown;
  const args = c.args.filter((a) => !a.startsWith("-"));
  const [from, to] = args;
  if (!from) return fail(`${c.name}: missing file operand`, 1);
  if (!to) return fail(`${c.name}: missing destination file operand after '${from}'`, 1);
  const recursive = c.args.some((a) => /^-[a-zA-Z]*[raR]/.test(a) || a === "--recursive");
  if (c.name === "cp" && c.fs.isDir(shown(c, from)) && !recursive)
    return fail(`cp: -r not specified; omitting directory '${from}'`, 1);
  const gap = copyGap(c, from, args.length);
  if (gap) return gap;
  const text = c.fs.read(shown(c, from));
  if (text === undefined)
    return fail(`${c.name}: cannot stat '${from}': No such file or directory`, 1);
  const dest = c.fs.isDir(shown(c, to)) ? `${to.replace(/\/$/, "")}/${baseName(from)}` : to;
  const err = writeOne(c, dest, text);
  if (err) return fail(err, 1);
  if (c.name === "mv") return rm({ ...c, name: "rm", args: ["-f", from] });
  return ok("");
}
