/**
 * One command line through a plugged-in shell engine (ADR-0196, ADR-0200). The engine runs the shell language; every
 * question it has about the machine comes back here (`ShellBridge`) and is answered from the world: the files of the
 * virtual file system, the clock, and the commands that read and change the world (`Run.exec` of the old shell).
 * This is the only code that connects an engine to the world, and the only thing an engine can open.
 */
import { type GapNotice, gapOf, gapText } from "../emulation-gap";
import type { WorldPort } from "../world";
import { AWK_EXAMPLE, AWK_EXAMPLES, AWK_SUPPORTED } from "./awk";
import { OS_EPOCH_MS } from "./clock";
import type { VirtualFs } from "./fs";
import {
  limitLine,
  SHELL_LIMITS,
  type ShellFileStat,
  type ShellHostPort,
  type ShellLimitKind,
  type ShellLimits,
  type ShellPlug,
} from "./shell-engine";
import { HOME, Run, type ShellOutcome, writeFile } from "./shell-exec";

const EPOCH_S = OS_EPOCH_MS / 1000;
const enc = new TextEncoder();
const dec = new TextDecoder();

/** Names the shell handles itself, so `command -v` and `type` must know them. */
const SHELL_OWN = new Set(
  "cd pwd echo printf test [ true false : exit export read set unset type command alias unalias source . eval exec wait trap shift return break continue local declare let getopts mapfile readarray umask ulimit jobs bg fg pushd popd dirs times hash help".split(
    " ",
  ),
);
/** Commands the engine runs itself (they need its clock or its environment); they are found like any other. */
const ENGINE_OWN = new Set(["sleep", "timeout", "nohup", "env", "printenv"]);

/** FNV-1a of a text: a small, stable number for the seed (nothing here reads a clock or a global generator). */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

const ERRNO_OF: ReadonlyArray<readonly [string, string]> = [
  ["Is a directory", "EISDIR"],
  ["Read-only", "EROFS"],
  ["Permission denied", "EACCES"],
  ["No such file", "ENOENT"],
];
const errnoOf = (message: string): string =>
  ERRNO_OF.find(([t]) => message.includes(t))?.[1] ?? "EIO";

function statOf(
  fs: VirtualFs,
  path: string,
  follow: boolean,
  name?: string,
): ShellFileStat | { errno: string } {
  const at = fs.resolve(path, follow);
  const s = fs.stat(at === path ? path : at);
  if (!s) return { errno: "ENOENT" };
  return {
    type: s.type,
    mode: s.mode,
    size: s.size,
    mtime: EPOCH_S + s.mtime,
    name: name ?? path.slice(path.lastIndexOf("/") + 1),
  };
}

/** How the words of a gap that the engine hit are made: the tool's own table says what does work. */
function noticeOf(tool: string, feature: string, what: string): GapNotice {
  if (tool === "awk")
    return {
      tool,
      feature,
      what,
      supported: AWK_SUPPORTED,
      example: AWK_EXAMPLES[feature] ?? AWK_EXAMPLE,
    };
  return {
    tool,
    feature,
    what,
    supported: "바로 돌아와요. 세계 시간을 보내려면 wait 툴을 써요",
  };
}

class ShellBridge implements ShellHostPort {
  /** Seconds of the line already moved into the world. */
  private moved = 0;
  private moves = 0;

  constructor(
    private readonly run: Run,
    private readonly plug: ShellPlug,
  ) {}

  private get fs(): VirtualFs {
    return this.run.view().fs;
  }

  advanceTo(seconds: number): void {
    const clock = this.plug.clock;
    if (!clock || !(seconds > this.moved)) return;
    clock.advance(seconds - this.moved);
    this.moved = seconds;
    this.moves++;
    this.run.refresh();
  }

  stamp(): number {
    return this.run.world.lastSeq() + this.moves * 1_000_000_000;
  }

  stat(path: string, follow: boolean): ShellFileStat | { errno: string } {
    return statOf(this.fs, path, follow);
  }

  readDir(path: string): readonly ShellFileStat[] | { errno: string } {
    const fs = this.fs;
    const names = fs.list(path);
    if (names === undefined) return { errno: fs.exists(path) ? "ENOTDIR" : "ENOENT" };
    const prefix = path === "/" ? "" : path;
    const out: ShellFileStat[] = [];
    for (const n of names) {
      const s = statOf(fs, `${prefix}/${n}`, false, n);
      if (!("errno" in s)) out.push(s);
    }
    return out;
  }

  read(path: string): Uint8Array | { errno: string } {
    const fs = this.fs;
    const text = fs.read(path);
    if (text !== undefined) return enc.encode(text);
    if (!fs.exists(path)) return { errno: "ENOENT" };
    return { errno: fs.isDir(path) ? "EISDIR" : "EACCES" };
  }

  mayWrite(path: string): { errno: string } | undefined {
    const fs = this.fs;
    if (fs.isDir(path)) return { errno: "EISDIR" };
    const denied = fs.denyWrite(path);
    if (denied) return { errno: denied === "ro" ? "EROFS" : "EACCES" };
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    if (path !== "/dev/null" && !fs.isDir(parent)) return { errno: "ENOENT" };
    return undefined;
  }

  write(path: string, data: Uint8Array, append: boolean): { errno: string } | undefined {
    const message = writeFile(this.run, path, dec.decode(data), append);
    return message === undefined ? undefined : { errno: errnoOf(message) };
  }

  exec(
    argv: readonly string[],
    cwd: string,
    env: readonly string[],
    stdin: Uint8Array,
  ): { code: number; stdout: Uint8Array; stderr: Uint8Array } {
    const run = this.run;
    run.cwd = cwd;
    run.env = env;
    const first = argv[0] ?? "";
    if (first === "\u0000command-v" || first === "\u0000type")
      return this.lookup(first, argv.slice(1));
    const args = [...argv];
    if (first.startsWith("\u0000")) args[0] = first.slice(1);
    // a command given by path: the directories of the usual commands lead to the same command
    const m = /^(?:\/usr\/local\/s?bin|\/usr\/s?bin|\/s?bin)\/(.+)$/.exec(args[0] ?? "");
    if (m && !(m[1] as string).includes("/")) args[0] = m[1] as string;
    const r = run.exec(args, dec.decode(stdin));
    if (r.outside) run.outside.push(r.outside);
    if (r.gap) run.gaps.push(gapOf(r.gap));
    return { code: r.code, stdout: enc.encode(r.out), stderr: enc.encode(r.err ?? "") };
  }

  /** `command -v` and `type` for the engine: it cannot see the machine's commands by itself. */
  private lookup(kind: string, names: readonly string[]) {
    let out = "";
    let code = 0;
    for (const n of names) {
      const builtin = SHELL_OWN.has(n);
      const known = builtin || ENGINE_OWN.has(n) || this.run.exec(["which", n], "").code === 0;
      if (!known) {
        code = 1;
        if (kind === "\u0000type") out += `bash: type: ${n}: not found\n`;
        continue;
      }
      if (kind === "\u0000type")
        out += builtin ? `${n} is a shell builtin\n` : `${n} is /usr/bin/${n}\n`;
      else out += builtin ? `${n}\n` : `/usr/bin/${n}\n`;
    }
    return { code, stdout: enc.encode(out), stderr: new Uint8Array(0) };
  }

  gap(tool: string, feature: string, what: string): string {
    const notice = noticeOf(tool, feature, what);
    this.run.gaps.push(gapOf(notice));
    this.run.outside.push(`${tool} ${what}`);
    return gapText(notice);
  }
}

/** The environment a login shell starts with on this host (a call is a new login shell: nothing carries over). */
export function loginEnv(hostName: string): string[] {
  return [
    "SHELL=/bin/bash",
    `HOSTNAME=${hostName}`,
    "USER=ops",
    "LANG=en_US.UTF-8",
    "HOME=/home/ops",
    "LOGNAME=ops",
    "PATH=/usr/local/bin:/usr/bin:/usr/local/sbin:/usr/sbin",
    "TERM=xterm-256color",
  ];
}

/** The limits of one line: the plug's, but never more world time than the clock lets this call pass. */
function limitsOf(plug: ShellPlug): ShellLimits {
  const given = { ...SHELL_LIMITS, ...plug.limits };
  return {
    ...given,
    worldSeconds: plug.clock ? Math.min(given.worldSeconds, plug.clock.budget()) : 0,
  };
}

/** What a crash of the engine means to the agent: a memory crash is the memory limit; anything else is no answer. */
function crashKind(crash: string): ShellLimitKind | undefined {
  return /memory|RangeError|out of bounds|Array buffer allocation/i.test(crash)
    ? "memory"
    : undefined;
}

/** Run a command line on a host the caller has checked is reachable, with the engine of `plug`. */
export function runLineWith(
  world: WorldPort,
  hostId: string,
  line: string,
  plug: ShellPlug,
): ShellOutcome {
  const run = new Run(world, hostId);
  const bridge = new ShellBridge(run, plug);
  const limits = limitsOf(plug);
  const result = plug.engine.run(
    {
      line,
      cwd: HOME,
      nowMs: OS_EPOCH_MS + Math.round(run.view().h.t * 1000),
      env: loginEnv(run.view().h.name),
      limits,
      seed: fnv(`${plug.seed}:${hostId}:${plug.callNumber()}`) || 1,
    },
    bridge,
  );
  plug.observe?.(line, result);
  const gaps = run.gaps;
  const outside = run.outside;
  let stderr = dec.decode(result.stderr);
  const tail = (text: string): void => {
    stderr += `${stderr === "" || stderr.endsWith("\n") ? "" : "\n"}${text}\n`;
  };
  const kind = result.limit ?? (result.crash ? crashKind(result.crash) : undefined);
  let code = result.code;
  if (kind) {
    tail(limitLine(kind, limits));
    gaps.push({ tool: "shell", feature: `limit:${kind}` });
    outside.push(`셸 한도 ${kind}`);
    code = 124;
  } else if (result.crash) {
    tail("terrarium: 셸 엔진이 이 줄에서 멈췄어요. 실제 호스트의 문제가 아니라 실험장의 한계예요.");
    gaps.push({ tool: "shell", feature: "crash" });
    outside.push("셸 엔진 멈춤");
    code = 70;
  }
  return { stdout: dec.decode(result.stdout), stderr, exitCode: code, outside, gaps };
}
