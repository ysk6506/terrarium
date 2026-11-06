/** `sed` of the fake shell (ADR-0117 decision 4): the stream editor, run for real over the file text. */
import { has, parseArgs } from "./args";
import { normalize } from "./fs";
import { errText, readInputs } from "./io";
import { posixRegExp } from "./regex";
import { type Address, parseSed, type SedCmd, SedSyntax } from "./sed-parse";
import { act, type Cmd, fail, linesOf, type R, unsupported } from "./types";

interface State {
  pattern: string;
  hold: string;
  out: string;
  n: number;
  total: number;
  quit: boolean;
  deleted: boolean;
  pendingAppend?: string;
  readonly ranges: Map<SedCmd, boolean>;
  readonly quiet: boolean;
}

function hits(a: Address, s: State): boolean {
  if (a.kind === "line") return s.n === a.n;
  if (a.kind === "last") return s.n === s.total;
  return (a.re as RegExp).test(s.pattern);
}

function selected(cmd: SedCmd, s: State): boolean {
  let on: boolean;
  if (!cmd.a1) on = true;
  else if (!cmd.a2) on = hits(cmd.a1, s);
  else if (s.ranges.get(cmd)) {
    on = true;
    if (cmd.a2.kind === "line" ? s.n >= (cmd.a2.n as number) : hits(cmd.a2, s))
      s.ranges.set(cmd, false);
  } else if (hits(cmd.a1, s)) {
    on = true;
    const closes =
      cmd.a2.kind === "line"
        ? (cmd.a2.n as number) <= s.n
        : cmd.a2.kind === "last" && s.n === s.total;
    s.ranges.set(cmd, !closes);
  } else on = false;
  return on !== cmd.negate;
}

function expandReplacement(repl: string, m: RegExpMatchArray): string {
  return repl.replace(/\\(.)|&/g, (x, ch: string | undefined) => {
    if (x === "&") return m[0];
    if (ch === undefined) return x;
    if (/\d/.test(ch)) return m[Number(ch)] ?? "";
    return ch === "n" ? "\n" : ch === "t" ? "\t" : ch;
  });
}

function substitute(cmd: SedCmd, s: State): void {
  const base = cmd.re as RegExp;
  const re = new RegExp(base.source, `${base.flags.replace("g", "")}g`);
  const from = cmd.nth ?? 1;
  let count = 0;
  let last = 0;
  let out = "";
  let changed = false;
  for (const m of s.pattern.matchAll(re)) {
    count++;
    if (cmd.global ? count < from : count !== from) continue;
    out += s.pattern.slice(last, m.index) + expandReplacement(cmd.repl ?? "", m);
    last = (m.index ?? 0) + m[0].length;
    changed = true;
    if (!cmd.global) break;
  }
  if (!changed) return;
  s.pattern = out + s.pattern.slice(last);
  if (cmd.print) s.out += `${s.pattern}\n`;
}

const emit = (s: State, text: string): void => {
  s.out += `${text}\n`;
};

type OpFn = (cmd: SedCmd, s: State) => void;

const OPS: Readonly<Record<string, OpFn>> = {
  s: substitute,
  d: (_c, s) => {
    s.deleted = true;
  },
  p: (_c, s) => emit(s, s.pattern),
  q: (_c, s) => {
    s.quit = true;
  },
  "=": (_c, s) => emit(s, String(s.n)),
  a: (c, s) => {
    s.pendingAppend = c.text;
  },
  i: (c, s) => emit(s, c.text ?? ""),
  c: (c, s) => {
    s.deleted = true;
    emit(s, c.text ?? "");
  },
  y: (c, s) => {
    s.pattern = [...s.pattern].map((ch) => c.map?.get(ch) ?? ch).join("");
  },
  h: (_c, s) => {
    s.hold = s.pattern;
  },
  H: (_c, s) => {
    s.hold = `${s.hold}\n${s.pattern}`;
  },
  g: (_c, s) => {
    s.pattern = s.hold;
  },
  G: (_c, s) => {
    s.pattern = `${s.pattern}\n${s.hold}`;
  },
  x: (_c, s) => {
    [s.pattern, s.hold] = [s.hold, s.pattern];
  },
};

function runCommands(cmds: readonly SedCmd[], s: State): void {
  for (const cmd of cmds) {
    if (s.deleted || s.quit) return;
    if (!selected(cmd, s)) continue;
    if (cmd.block) runCommands(cmd.block, s);
    else (OPS[cmd.op] as OpFn)(cmd, s);
  }
}

function edit(text: string, cmds: readonly SedCmd[], quiet: boolean): string {
  const lines = linesOf(text);
  const s: State = {
    pattern: "",
    hold: "",
    out: "",
    n: 0,
    total: lines.length,
    quit: false,
    deleted: false,
    ranges: new Map(),
    quiet,
  };
  for (const line of lines) {
    s.n++;
    s.pattern = line;
    s.deleted = false;
    runCommands(cmds, s);
    if (!s.deleted && !quiet) emit(s, s.pattern);
    if (s.pendingAppend !== undefined) {
      emit(s, s.pendingAppend);
      s.pendingAppend = undefined;
    }
    if (s.quit) break;
  }
  return s.out;
}

/** The scripts of a call: every `-e`, a `-f` file, or the first word. */
function scriptsOf(c: Cmd, p: ReturnType<typeof parseArgs>, rest: string[]): string[] | R {
  const scripts = c.args.flatMap((a, i) =>
    a === "-e" || a === "--expression" ? [c.args[i + 1] ?? ""] : [],
  );
  const file = p.flags.get("f");
  const fileScript = file === undefined ? undefined : c.fs.read(normalize(c.cwd, file));
  if (scripts.length === 0 && fileScript === undefined) {
    const first = rest.shift();
    if (first === undefined)
      return fail("Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...", 1);
    scripts.push(first);
  }
  if (fileScript !== undefined) scripts.push(fileScript);
  return scripts;
}

function compileScript(scripts: readonly string[], extended: boolean): SedCmd[] | R {
  try {
    return parseSed(scripts.join("\n"), (src, ignoreCase) =>
      posixRegExp(src, { extended, ignoreCase }),
    );
  } catch (e) {
    if (e instanceof SedSyntax)
      return {
        out: "",
        err: `sed: -e expression #1, char 0: ${e.message}`,
        code: 1,
        ...(e.outside ? { outside: e.outside } : {}),
      };
    throw e;
  }
}

export function sed(c: Cmd): R {
  const p = parseArgs(c.args, {
    bool: "nErsiz",
    val: "ef",
    long: {
      "in-place": "bool",
      expression: "val",
      quiet: "bool",
      silent: "bool",
      "regexp-extended": "bool",
    },
  });
  if (p.bad) return unsupported("sed", p.bad);
  const rest = [...p.rest];
  const scripts = scriptsOf(c, p, rest);
  if ("code" in scripts) return scripts;
  const cmds = compileScript(scripts, has(p, "E") || has(p, "r") || has(p, "--regexp-extended"));
  if ("code" in cmds) return cmds;
  const quiet = has(p, "n") || has(p, "--quiet") || has(p, "--silent");
  const { inputs, errors } = readInputs(c, rest);
  if (has(p, "i") || has(p, "--in-place")) return inPlaceEdit(c, inputs, cmds, quiet, errors);
  return {
    out: inputs.map((i) => edit(i.text, cmds, quiet)).join(""),
    err: errText(errors),
    code: errors.length ? 2 : 0,
  };
}

function inPlaceEdit(
  c: Cmd,
  inputs: ReadonlyArray<{ name: string; text: string }>,
  cmds: readonly SedCmd[],
  quiet: boolean,
  errors: readonly string[],
): R {
  let err = errText(errors);
  for (const i of inputs) {
    const path = normalize(c.cwd, i.name);
    const denied = c.fs.denyWrite(path);
    if (denied)
      err += `sed: couldn't open temporary file ${path}: ${denied === "ro" ? "Read-only file system" : "Permission denied"}\n`;
    else act(c, "write", path, edit(i.text, cmds, quiet));
  }
  return { out: "", err, code: err ? 4 : 0 };
}
