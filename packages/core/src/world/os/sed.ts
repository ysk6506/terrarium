/** `sed` of the fake shell (ADR-0117 decision 4): the stream editor, run for real over the file text. */
import { allValues, hasAny, parseArgs } from "./args";
import { normalize } from "./fs";
import { errText, readInputs } from "./io";
import { badFlag } from "./real-options";
import { posixRegExp } from "./regex";
import { type Address, parseSed, type SedCmd, SedSyntax } from "./sed-parse";
import { act, type Cmd, emulationGap, fail, linesOf, type R } from "./types";

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
  /** What ends a record: a newline, or nothing / NUL for `-z`. */
  readonly eol: string;
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

/** The text a replacement builds from one match: `&`, `\1`…, `\n`, `\t` and the case changes `\U \L \E \u \l`. */
class Replacement {
  out = "";
  private mode: "" | "U" | "L" = "";
  private once: "" | "u" | "l" = "";

  put(text: string): void {
    if (text === "") return;
    let x = this.mode === "U" ? text.toUpperCase() : this.mode === "L" ? text.toLowerCase() : text;
    if (this.once !== "") {
      x = (this.once === "u" ? x.charAt(0).toUpperCase() : x.charAt(0).toLowerCase()) + x.slice(1);
      this.once = "";
    }
    this.out += x;
  }

  /** What follows a backslash. */
  escape(ch: string, m: RegExpMatchArray): void {
    if (ch === "U" || ch === "L") this.mode = ch;
    else if (ch === "E") this.mode = "";
    else if (ch === "u" || ch === "l") this.once = ch;
    else if (/\d/.test(ch)) this.put(m[Number(ch)] ?? "");
    else this.put(ch === "n" ? "\n" : ch === "t" ? "\t" : ch);
  }
}

function expandReplacement(repl: string, m: RegExpMatchArray): string {
  const r = new Replacement();
  for (let i = 0; i < repl.length; i++) {
    const ch = repl.charAt(i);
    if (ch === "&") r.put(m[0]);
    else if (ch === "\\" && i + 1 < repl.length) r.escape(repl.charAt(++i), m);
    else r.put(ch);
  }
  return r.out;
}

/** The matches of a substitution; an empty one right after the previous match does not count (the text b under a b-star pattern is one match). */
function matchesOf(text: string, re: RegExp): RegExpMatchArray[] {
  const found: RegExpMatchArray[] = [];
  let previousEnd = -1;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (!(m[0] === "" && at === previousEnd)) found.push(m);
    previousEnd = at + m[0].length;
  }
  return found;
}

function substitute(cmd: SedCmd, s: State): void {
  const base = cmd.re as RegExp;
  const re = new RegExp(base.source, `${base.flags.replace("g", "")}g`);
  const from = cmd.nth ?? 1;
  let count = 0;
  let last = 0;
  let out = "";
  let changed = false;
  for (const m of matchesOf(s.pattern, re)) {
    count++;
    if (cmd.global ? count < from : count !== from) continue;
    out += s.pattern.slice(last, m.index) + expandReplacement(cmd.repl ?? "", m);
    last = (m.index ?? 0) + m[0].length;
    changed = true;
    if (!cmd.global) break;
  }
  if (!changed) return;
  s.pattern = out + s.pattern.slice(last);
  if (cmd.print) s.out += `${s.pattern}${s.eol}`;
}

const emit = (s: State, text: string): void => {
  s.out += `${text}${s.eol}`;
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

/** The records of a text: its lines, or with `-z` what lies between NULs (a text without one is a single record). */
function recordsOf(text: string, nul: boolean): string[] {
  if (!nul) return linesOf(text);
  const parts = text.split("\0");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

function edit(text: string, cmds: readonly SedCmd[], quiet: boolean, nul = false): string {
  const lines = recordsOf(text, nul);
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
    eol: nul ? (text.includes("\0") ? "\0" : "") : "\n",
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

/** The scripts of a call: every `-e`, every `-f` file, or the first word. */
function scriptsOf(c: Cmd, rest: string[]): string[] | R {
  const scripts = allValues(c.args, SED_FLAGS, "e", "expression");
  const files = allValues(c.args, SED_FLAGS, "f");
  const fileScripts: string[] = [];
  for (const file of files) {
    const text = c.fs.read(normalize(c.cwd, file));
    if (text === undefined)
      return fail(`sed: couldn't open file ${file}: No such file or directory`, 1);
    fileScripts.push(text);
  }
  if (scripts.length === 0 && files.length === 0) {
    const first = rest.shift();
    if (first === undefined)
      return fail("Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...", 1);
    scripts.push(first);
  }
  return [...scripts, ...fileScripts];
}

function compileScript(scripts: readonly string[], extended: boolean): SedCmd[] | R {
  try {
    return parseSed(scripts.join("\n"), (src, ignoreCase) =>
      posixRegExp(src, { extended, ignoreCase }),
    );
  } catch (e) {
    if (!(e instanceof SedSyntax)) throw e;
    if (!e.gap) return fail(`sed: -e expression #1, char 0: ${e.message}`, 1);
    return emulationGap(
      {
        tool: "sed",
        feature: e.gap.feature,
        what: e.gap.what,
        supported: SED_SUPPORTED,
        example: SED_EXAMPLE,
      },
      1,
    );
  }
}

const SED_SUPPORTED =
  "-n -e -f -E -r -s -z -i[접미사]; 주소(줄 번호, $, /정규식/, 구간, !), 명령 s y p d q = h H g G x a i c { }, s의 g p i N 플래그";
const SED_EXAMPLE = "sed -n 1p /etc/hosts";

const SED_FLAGS = {
  bool: "nErsiz",
  val: "ef",
  long: {
    "in-place": "bool",
    expression: "val",
    quiet: "bool",
    silent: "bool",
    "regexp-extended": "bool",
    separate: "bool",
    "null-data": "bool",
  },
} as const;

/** `-i.bak` and `--in-place=.bak`: the suffix of the backup, and the arguments without it. */
function inPlaceSuffix(args: readonly string[]): { suffix: string; args: string[] } {
  let suffix = "";
  const clean = args.map((a) => {
    const long = /^--in-place=(.*)$/.exec(a);
    if (long) {
      suffix = long[1] as string;
      return "--in-place";
    }
    const short = /^-([nErs]*)i(.+)$/.exec(a);
    if (!short) return a;
    suffix = short[2] as string;
    return `-${short[1]}i`;
  });
  return { suffix, args: clean };
}

/** The files as one stream, the way sed reads several (line numbers go on, `$` is the end of the last). */
function oneStream(texts: readonly string[]): string {
  return texts
    .map((t, i) => (i < texts.length - 1 && t !== "" && !t.endsWith("\n") ? `${t}\n` : t))
    .join("");
}

export function sed(c: Cmd): R {
  const { suffix, args } = inPlaceSuffix(c.args);
  const p = parseArgs(args, SED_FLAGS);
  if (p.bad) return badFlag("sed", p, SED_SUPPORTED);
  if (/[*/]/.test(suffix))
    return emulationGap({
      tool: "sed",
      feature: "flag:-i-suffix",
      what: `-i 접미사 ${suffix}`,
      supported: SED_SUPPORTED,
      example: SED_EXAMPLE,
    });
  const rest = [...p.rest];
  const scripts = scriptsOf(c, rest);
  if ("code" in scripts) return scripts;
  const cmds = compileScript(scripts, hasAny(p, "E", "r", "--regexp-extended"));
  if ("code" in cmds) return cmds;
  const quiet = hasAny(p, "n", "--quiet", "--silent");
  const { inputs, errors } = readInputs(c, rest);
  if (hasAny(p, "i", "--in-place"))
    return inPlaceEdit(
      c,
      inputs,
      cmds,
      { quiet, suffix, nul: hasAny(p, "z", "--null-data") },
      errors,
    );
  const nul = hasAny(p, "z", "--null-data");
  const separate = hasAny(p, "s", "--separate");
  const streams = separate ? inputs.map((i) => i.text) : [oneStream(inputs.map((i) => i.text))];
  return {
    out: streams.map((text) => edit(text, cmds, quiet, nul)).join(""),
    err: errText(errors),
    code: errors.length ? 2 : 0,
  };
}

function inPlaceEdit(
  c: Cmd,
  inputs: ReadonlyArray<{ name: string; text: string }>,
  cmds: readonly SedCmd[],
  how: { quiet: boolean; suffix: string; nul: boolean },
  errors: readonly string[],
): R {
  let err = errText(errors);
  for (const i of inputs) {
    const path = normalize(c.cwd, i.name);
    const denied = c.fs.denyWrite(path);
    if (denied)
      err += `sed: couldn't open temporary file ${path}: ${denied === "ro" ? "Read-only file system" : "Permission denied"}\n`;
    else {
      if (how.suffix !== "") act(c, "write", `${path}${how.suffix}`, i.text);
      act(c, "write", path, edit(i.text, cmds, how.quiet, how.nul));
    }
  }
  return { out: "", err, code: err ? 4 : 0 };
}
