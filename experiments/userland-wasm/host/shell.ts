/**
 * The bridge between the shell module and Terrarium's fake machine (experiment). `createWasmShell` is called by
 * `runLine` (world/os/shell-exec.ts) when TERRARIUM_SHELL=wasm and receives the pieces of the old executor it needs;
 * it returns a function with the same shape as `runLine`.
 *
 * Every command comes back here (OP.exec) and runs through the old `Run.exec`, so `ip`, `systemctl`, `kubectl`,
 * `grep`, `sed`, ... are the hand-written ones. Only the shell language and `awk` are new.
 */
import { gapOf } from "../../../packages/core/src/world/emulation-gap";
import { OS_EPOCH_MS } from "../../../packages/core/src/world/os/clock";
import { Engine, type Bridge, OP, type Reply } from "./engine";

/* The old executor's internals, handed in so that this file does not import the module that loads it. */
interface Deps {
  Run: new (world: unknown, id: string) => RunLike;
  writeFile: (run: RunLike, path: string, text: string, append: boolean) => string | undefined;
  refusal: (run: RunLike, path: string, shown: string) => string | undefined;
  HOME: string;
  binNames: () => string[];
}

interface FsLike {
  stat(path: string): { type: "f" | "d" | "l"; mode: number; size: number; mtime: number } | undefined;
  resolve(path: string, followLast: boolean): string;
  isDir(path: string): boolean;
  exists(path: string): boolean;
  list(path: string): string[] | undefined;
  read(path: string): string | undefined;
  denyWrite(path: string): "ro" | "denied" | "protected" | undefined;
}

interface RunLike {
  cwd: string;
  readonly outside: string[];
  readonly gaps: unknown[];
  world: { lastSeq(): number; advance?(s: number): void };
  view(): { h: { t: number; name: string }; fs: FsLike };
  exec(argv: readonly string[], stdin: string): {
    out: string;
    err?: string;
    code: number;
    outside?: string;
    gap?: { tool: string; feature: string };
  };
}

export interface ShellOutcome {
  stdout: string;
  stderr: string;
  exitCode: number;
  outside: string[];
  gaps: unknown[];
}

/** The result of the latest job, for the measuring scripts. */
export const last: { result?: import("./engine").JobResult } = {};
let shared: Engine | undefined;
export const engineOf = (): Engine => {
  shared ??= new Engine();
  return shared;
};

const ENOENT = { ok: false, errno: "ENOENT" };
const EPOCH_S = OS_EPOCH_MS / 1000;
/** Names the module's shell handles itself, so `command -v` and `type` must know them. */
const SHELL_OWN = new Set(
  "cd pwd echo printf test [ true false : exit export read set unset type command alias unalias source . eval exec wait trap shift return break continue local declare let getopts mapfile readarray umask ulimit jobs bg fg pushd popd dirs times hash help".split(
    " ",
  ),
);

const statReply = (fs: FsLike, path: string, follow: boolean, name?: string): Record<string, unknown> => {
  const at = fs.resolve(path, follow);
  const s = fs.stat(at === path ? path : at);
  if (!s) return ENOENT;
  return {
    ok: true,
    type: s.type,
    mode: s.mode,
    size: s.size,
    mtime: EPOCH_S + s.mtime,
    name: name ?? path.slice(path.lastIndexOf("/") + 1),
  };
};

function makeBridge(d: Deps, run: RunLike): Bridge {
  const sleepMode = process.env.TERRARIUM_WASM_SLEEP ?? "noop";
  const utf8 = (s: string): Uint8Array => Buffer.from(s, "utf8");
  return (op, hdr, raw): Reply => {
    const fs = run.view().fs;
    const path = String(hdr.path ?? "");
    switch (op) {
      case OP.exec: {
        const argv = (hdr.argv as string[]).slice();
        run.cwd = String(hdr.cwd);
        return execReply(run, argv, Buffer.from(raw).toString("utf8"), sleepMode);
      }
      case OP.stat:
        return { hdr: statReply(fs, path, hdr.follow === true) };
      case OP.readdir: {
        const names = fs.list(path);
        if (names === undefined) return { hdr: { ok: false, errno: fs.exists(path) ? "ENOTDIR" : "ENOENT" } };
        const prefix = path === "/" ? "" : path;
        const entries = names.map((n) => statReply(fs, `${prefix}/${n}`, false, n)).filter((e) => e.ok);
        return { hdr: { ok: true, entries } };
      }
      case OP.read: {
        const text = fs.read(path);
        if (text !== undefined) return { hdr: { ok: true }, raw: utf8(text) };
        return { hdr: { ok: false, errno: fs.exists(path) ? (fs.isDir(path) ? "EISDIR" : "EACCES") : "ENOENT" } };
      }
      case OP.wopen: {
        if (fs.isDir(path)) return { hdr: { ok: false, errno: "EISDIR" } };
        const denied = fs.denyWrite(path);
        if (denied) return { hdr: { ok: false, errno: denied === "ro" ? "EROFS" : "EACCES" } };
        const parent = path.slice(0, path.lastIndexOf("/")) || "/";
        if (path !== "/dev/null" && !fs.isDir(parent)) return { hdr: { ok: false, errno: "ENOENT" } };
        return { hdr: { ok: true } };
      }
      case OP.write: {
        const err = d.writeFile(run, path, Buffer.from(raw).toString("utf8"), hdr.append === true);
        return { hdr: err ? { ok: false, errno: err } : { ok: true } };
      }
      default:
        return { hdr: { ok: false, errno: "ENOSYS" } };
    }
  };
}

/** `command -v` and `type` for the module: it cannot see the fake machine's commands by itself. */
function lookupWords(run: RunLike, kind: string, names: string[]): Reply {
  let out = "";
  let code = 0;
  for (const n of names) {
    const known = SHELL_OWN.has(n) || run.exec(["which", n], "").code === 0;
    if (!known) {
      code = 1;
      if (kind === "type") out += `bash: type: ${n}: not found\n`;
      continue;
    }
    const builtin = SHELL_OWN.has(n);
    if (kind === "type") out += builtin ? `${n} is a shell builtin\n` : `${n} is /usr/bin/${n}\n`;
    else out += builtin ? `${n}\n` : `/usr/bin/${n}\n`;
  }
  return { hdr: { code, outLen: Buffer.byteLength(kind === "type" ? "" : out) }, raw: Buffer.from(out) };
}

function execReply(run: RunLike, argv: string[], stdin: string, sleepMode: string): Reply {
  const first = argv[0] ?? "";
  if (first === "\u0000command-v" || first === "\u0000type") {
    const kind = first === "\u0000type" ? "type" : "command";
    const r = lookupWords(run, kind, argv.slice(1));
    const text = Buffer.from(r.raw ?? []).toString("utf8");
    // `type` reports "not found" on stdout in bash; `command -v` is silent
    return { hdr: { code: r.hdr.code, outLen: Buffer.byteLength(text) }, raw: Buffer.from(text) };
  }
  if (first.startsWith("\u0000")) argv[0] = first.slice(1);
  // a command given by path: the directories of the usual commands lead to the same command
  const m = /^(?:\/usr\/local\/s?bin|\/usr\/s?bin|\/s?bin)\/(.+)$/.exec(argv[0] ?? "");
  if (m && !(m[1] as string).includes("/")) argv[0] = m[1] as string;
  if (argv[0] === "sleep" && sleepMode === "advance") {
    const secs = Number(argv[1] ?? 0);
    if (secs > 0 && run.world.advance) run.world.advance(secs);
  }
  const r = run.exec(argv, stdin);
  if (r.outside) run.outside.push(r.outside);
  if (r.gap) run.gaps.push(gapOf(r.gap as never));
  const out = Buffer.from(r.out, "utf8");
  const err = Buffer.from(r.err ?? "", "utf8");
  return { hdr: { code: r.code, outLen: out.length }, raw: Buffer.concat([out, err]) };
}

const fnv = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};

export function createWasmShell(d: Deps) {
  return (world: { lastSeq(): number }, hostId: string, line: string): ShellOutcome => {
    const run = new d.Run(world, hostId);
    const { h } = run.view();
    const nowMs = OS_EPOCH_MS + Math.round(h.t * 1000);
    const env = [
      "SHELL=/bin/bash",
      `HOSTNAME=${h.name}`,
      "USER=ops",
      "LANG=en_US.UTF-8",
      "HOME=/home/ops",
      "LOGNAME=ops",
      "PATH=/usr/local/bin:/usr/bin:/usr/local/sbin:/usr/sbin",
      "TERM=xterm-256color",
    ];
    const res = engineOf().runJob(
      {
        line,
        cwd: d.HOME,
        env,
        nowMs,
        maxSteps: Number(process.env.TERRARIUM_WASM_MAX_STEPS ?? 20000),
        maxOut: Number(process.env.TERRARIUM_WASM_MAX_OUT ?? 4_000_000),
        awk: process.env.TERRARIUM_WASM_AWK === "ts" ? "ts" : "go",
        seed: (fnv(hostId) + world.lastSeq()) % 32768 || 1,
      },
      makeBridge(d, run),
    );
    last.result = res;
    let stderr = res.stderr.toString("utf8");
    if (res.timedOut) stderr += "terrarium: 명령이 너무 오래 걸려서 멈췄어요 (시간 한도)\n";
    else if (res.budget === "steps") stderr += "terrarium: 명령을 너무 많이 실행해서 멈췄어요 (단계 한도)\n";
    else if (res.budget === "output") stderr += "terrarium: 출력이 너무 커서 멈췄어요 (출력 한도)\n";
    else if (res.crash) stderr += `terrarium: 셸 모듈이 멈췄어요: ${res.crash.split("\n")[0]}\n`;
    return {
      stdout: res.stdout.toString("utf8"),
      stderr,
      exitCode: res.code,
      outside: run.outside,
      gaps: run.gaps,
    };
  };
}
