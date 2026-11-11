/**
 * The executor of the fake shell (ADR-0117 decision 4). A line is parsed (shell-parse.ts), each pipeline runs its
 * commands one after the other passing text along, redirects go to the virtual file system (a write is a world
 * event), and `&&` `||` `;` decide what runs next. Anything the shell can run, runs; what it cannot is
 * `command not found` (127) or "이 흉내에서는 안 돼요", and is listed in `outside` (decision 6).
 */
import type { WorldPort } from "../world";
import { whichCmd } from "./cmd-fs";
import { COMMANDS } from "./commands";
import { normalize, VirtualFs } from "./fs";
import { expandGlob } from "./glob";
import { type OsHost, osHostOf } from "./host";
import {
  type Join,
  parseLine,
  type Redirect,
  type SimpleCmd,
  type Step,
  type Word,
} from "./shell-parse";
import { act, type Cmd, type Handler, type R } from "./types";

export interface ShellOutcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** The commands and features the simulation could not do. */
  readonly outside: string[];
}

const extra = new Map<string, Handler>();

/**
 * Register a command from another layer (`kubectl` and `crictl` of the container layer). Registered commands
 * are found like the built-in ones and show up in `which` and `/usr/bin`. `kubectl` and `crictl` are not
 * registered here: until the container layer registers them they answer `command not found`.
 */
export function registerShellCommand(name: string, handler: Handler): void {
  extra.set(name, handler);
}

const lookup = (name: string): Handler | undefined => extra.get(name) ?? COMMANDS[name];
const binNames = (): string[] => [...new Set([...Object.keys(COMMANDS), ...extra.keys()])].sort();

const BUILTINS = new Set(["cd", "pwd", "true", "false", "exit", "sudo", "sleep", "which"]);
const KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "until",
  "case",
  "function",
  "do",
  "done",
  "then",
  "fi",
  "select",
]);
const HOME = "/home/ops";

/** The state one run of a line carries: where it is, what it printed, what it could not do. */
class Run {
  cwd = HOME;
  stderr = "";
  readonly outside: string[] = [];
  private seq = -1;
  private cached: { h: OsHost; fs: VirtualFs } | undefined;

  constructor(
    readonly world: WorldPort,
    readonly id: string,
  ) {}

  /** The host and its tree as they stand now; rebuilt after a command changed the world. */
  view(): { h: OsHost; fs: VirtualFs } {
    const seq = this.world.lastSeq();
    if (!this.cached || seq !== this.seq) {
      const h = osHostOf(this.world, this.id);
      this.cached = { h, fs: new VirtualFs(h, binNames()) };
      this.seq = seq;
    }
    return this.cached;
  }

  context(name: string, args: readonly string[], stdin: string): Cmd {
    const { h, fs } = this.view();
    return {
      name,
      args,
      stdin,
      h,
      fs,
      world: this.world,
      cwd: this.cwd,
      run: (argv, input) => this.exec(argv, input),
    };
  }

  /** Run one command by name. */
  exec(argv: readonly string[], stdin: string): R {
    const [name = "", ...args] = argv;
    if (name === "sudo") return this.sudo(args, stdin);
    const builtin = this.builtin(name, args);
    if (builtin) return builtin;
    if (KEYWORDS.has(name))
      return {
        out: "",
        err: `bash: ${name}: 셸 문법은 이 흉내에서 안 돼요`,
        code: 2,
        outside: `셸 문법 ${name}`,
      };
    const handler = lookup(name);
    if (!handler)
      return { out: "", err: `bash: ${name}: command not found`, code: 127, outside: name };
    return handler(this.context(name, args, stdin));
  }

  private sudo(args: readonly string[], stdin: string): R {
    const rest = [...args];
    while (rest[0]?.startsWith("-")) rest.shift();
    return rest.length === 0
      ? { out: "", err: "usage: sudo command", code: 1 }
      : this.exec(rest, stdin);
  }

  /** `cd`, `pwd`, `exit`, `true`, `false`, `sleep`, `which`: the shell's own. */
  private builtin(name: string, args: readonly string[]): R | undefined {
    if (name === "cd") return this.cd(args[0]);
    if (name === "which")
      return whichCmd(
        this.context("which", args, ""),
        (n) => lookup(n) !== undefined || BUILTINS.has(n),
      );
    const fixed = SIMPLE_BUILTINS[name];
    if (fixed) return fixed(args, this.cwd);
    return undefined;
  }

  private cd(target: string | undefined): R {
    const path = normalize(this.cwd, target ?? HOME);
    if (!this.view().fs.isDir(path))
      return { out: "", err: `bash: cd: ${target ?? ""}: No such file or directory`, code: 1 };
    this.cwd = path;
    return { out: "", code: 0 };
  }
}

const SIMPLE_BUILTINS: Readonly<Record<string, (args: readonly string[], cwd: string) => R>> = {
  pwd: (_args, cwd) => ({ out: `${cwd}\n`, code: 0 }),
  true: () => ({ out: "", code: 0 }),
  ":": () => ({ out: "", code: 0 }),
  sleep: () => ({ out: "", code: 0 }),
  clear: () => ({ out: "", code: 0 }),
  false: () => ({ out: "", code: 1 }),
  exit: (args) => ({ out: "", code: Number(args[0] ?? 0) || 0 }),
};

function expand(run: Run, words: readonly Word[]): string[] {
  const out: string[] = [];
  for (const w of words) {
    if (w.glob) out.push(...expandGlob(run.view().fs, run.cwd, w.text));
    else out.push(w.text);
  }
  return out;
}

/** Why a redirect target cannot be written, or undefined. */
function refusal(run: Run, path: string, shownPath: string): string | undefined {
  const { fs } = run.view();
  if (fs.isDir(path)) return `bash: ${shownPath}: Is a directory`;
  const denied = fs.denyWrite(path);
  if (denied === "ro") return `bash: ${shownPath}: Read-only file system`;
  return denied ? `bash: ${shownPath}: Permission denied` : undefined;
}

/** Write the output of a command to a file, as a world event. */
function writeFile(run: Run, path: string, text: string, append: boolean): string | undefined {
  const { fs } = run.view();
  const full = normalize(run.cwd, path);
  const refused = refusal(run, full, path);
  if (refused) return refused;
  if (full === "/dev/null") return undefined;
  const c = run.context("sh", [], "");
  const old = fs.read(full);
  if (!append && text === "" && old !== undefined && old !== "") {
    act(c, "truncate", full, String(fs.stat(full)?.size ?? 0));
    return undefined;
  }
  if (!fs.isDir(full.slice(0, full.lastIndexOf("/")) || "/"))
    return `bash: ${path}: No such file or directory`;
  act(c, "write", full, append ? (old ?? "") + text : text);
  return undefined;
}

function applyRedirects(
  run: Run,
  redirs: readonly Redirect[],
  r: R,
): { out: string; err: string; failed?: string } {
  let out = r.out;
  let err = r.err ?? "";
  for (const d of redirs) {
    const path = d.target ? (expand(run, [d.target])[0] ?? d.target.text) : "";
    if (d.kind === "errToOut") {
      out += err;
      err = "";
    } else if (d.kind === "err" || d.kind === "errAppend") {
      const failed = writeFile(run, path, err, d.kind === "errAppend");
      err = failed ? `${failed}\n` : "";
    } else if (d.kind === "out" || d.kind === "append") {
      const failed = writeFile(run, path, out, d.kind === "append");
      out = "";
      if (failed) return { out, err: `${err}${failed}\n`, failed };
    }
  }
  return { out, err };
}

function inputOf(run: Run, cmd: SimpleCmd, piped: string): { text: string; error?: string } {
  const d = cmd.redirs.find((x) => x.kind === "in");
  if (!d?.target) return { text: piped };
  const path = normalize(run.cwd, d.target.text);
  const text = run.view().fs.read(path);
  return text === undefined
    ? { text: "", error: `bash: ${d.target.text}: No such file or directory` }
    : { text };
}

function runStage(run: Run, cmd: SimpleCmd, piped: string): { out: string; code: number } {
  const input = inputOf(run, cmd, piped);
  if (input.error) {
    run.stderr += `${input.error}\n`;
    return { out: "", code: 1 };
  }
  const r = run.exec(expand(run, cmd.words), input.text);
  if (r.outside) run.outside.push(r.outside);
  const done = applyRedirects(run, cmd.redirs, r);
  run.stderr += done.err;
  return { out: done.out, code: done.failed ? 1 : r.code };
}

function runPipeline(run: Run, pipeline: readonly SimpleCmd[]): { out: string; code: number } {
  let text = "";
  let code = 0;
  for (const cmd of pipeline) {
    const r = runStage(run, cmd, text);
    text = r.out;
    code = r.code;
  }
  return { out: text, code };
}

const skip = (join: Join, last: number): boolean =>
  (join === "&&" && last !== 0) || (join === "||" && last === 0);

function runSteps(run: Run, steps: readonly Step[]): { stdout: string; code: number } {
  let stdout = "";
  let code = 0;
  for (const step of steps) {
    if (skip(step.join, code)) continue;
    const r = runPipeline(run, step.pipeline);
    stdout += r.out;
    code = r.code;
  }
  return { stdout, code };
}

/** Run a command line on a host the caller has checked is reachable. */
export function runLine(world: WorldPort, hostId: string, line: string): ShellOutcome {
  const parsed = parseLine(line);
  if (!parsed.ok)
    return {
      stdout: "",
      stderr: `${parsed.error}\n`,
      exitCode: 2,
      outside: parsed.outside ? [parsed.outside] : [],
    };
  const run = new Run(world, hostId);
  const { stdout, code } = runSteps(run, parsed.steps);
  return { stdout, stderr: run.stderr, exitCode: code, outside: run.outside };
}
