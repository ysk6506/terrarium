/** `grep`, `egrep` and `fgrep` of the fake shell (ADR-0117 decision 4): the real options, JavaScript regular expressions underneath. */
import { allValues, has, intOf, parseArgs } from "./args";
import { baseName, normalize } from "./fs";
import { globToRegExp } from "./glob";
import { errText, readInputs } from "./io";
import { badFlag } from "./real-options";
import { escapeLiteral, translate } from "./regex";
import { type Cmd, emulationGap, fail, joinLines, linesOf, type R } from "./types";

const GREP_FLAGS = {
  bool: "ivcnEFrRlLwxohHqsaIP",
  val: "emABCf",
  long: {
    color: "val",
    colour: "val",
    include: "val",
    exclude: "val",
    "max-count": "val",
    "no-messages": "bool",
    "ignore-case": "bool",
    "invert-match": "bool",
    count: "bool",
    "line-number": "bool",
    recursive: "bool",
    regexp: "val",
    file: "val",
  },
} as const;

type Flags = ReturnType<typeof parseArgs>;

/** The pattern wrapped for `-w` and `-x`, translated to JavaScript unless it is a fixed string. */
function wrapped(p: Flags, body: string): string {
  if (p.flags.has("x")) return `^(?:${body})$`;
  return p.flags.has("w") ? `\\b(?:${body})\\b` : body;
}

/** The regular expression of a grep call: one alternative per pattern, or the error to print. */
function compile(c: Cmd, p: Flags, sources: readonly string[]): RegExp | R {
  const fixed = p.flags.has("F") || c.name === "fgrep";
  const extended = p.flags.has("E") || p.flags.has("P") || c.name === "egrep";
  const ignoreCase = p.flags.has("i");
  try {
    const bodies = sources.map((src) => (fixed ? escapeLiteral(src) : translate(src, extended)));
    const body =
      bodies.length === 1 ? (bodies[0] as string) : bodies.map((b) => `(?:${b})`).join("|");
    return new RegExp(bodies.length === 0 ? "(?!)" : wrapped(p, body), ignoreCase ? "i" : "");
  } catch {
    return fail("grep: Invalid regular expression", 2);
  }
}

/** The patterns of `-e` (each, and each line of it), of `-f` files, or the first word; and the files left. */
function patternsOf(c: Cmd, p: Flags): { sources: string[]; files: string[] } | R {
  const given = allValues(c.args, GREP_FLAGS, "e", "regexp");
  const lists = allValues(c.args, GREP_FLAGS, "f", "file");
  const rest = [...p.rest];
  const sources = given.flatMap((g) => g.split("\n"));
  for (const name of lists) {
    const text = c.fs.read(normalize(c.cwd, name));
    if (text === undefined) return fail(`grep: ${name}: No such file or directory`, 2);
    sources.push(...linesOf(text));
  }
  if (given.length === 0 && lists.length === 0) {
    const first = rest.shift();
    if (first === undefined) return fail("Usage: grep [OPTION]... PATTERNS [FILE]...", 2);
    sources.push(...first.split("\n"));
  }
  return { sources, files: rest };
}

function patternOf(c: Cmd, p: Flags): { re: RegExp; files: string[] } | R {
  const found = patternsOf(c, p);
  if ("code" in found) return found;
  const re = compile(c, p, found.sources);
  return "code" in re ? re : { re, files: found.files };
}

interface Match {
  readonly file: string;
  readonly lines: string[];
  readonly hits: number[];
}

function scan(
  text: string,
  re: RegExp,
  invert: boolean,
  max: number,
): { lines: string[]; hits: number[] } {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const hits: number[] = [];
  lines.forEach((l, i) => {
    if (hits.length < max && re.test(l) !== invert) hits.push(i);
  });
  return { lines, hits };
}

type Row = { i: number; hit: boolean } | "--";

/** The lines to print for one file with the `-A`/`-B`/`-C` context. */
function withContext(m: Match, before: number, after: number): Row[] {
  const keep = new Map<number, boolean>();
  for (const h of m.hits)
    for (let k = Math.max(0, h - before); k <= Math.min(m.lines.length - 1, h + after); k++)
      keep.set(k, keep.get(k) || k === h);
  const idx = [...keep.keys()].sort((a, b) => a - b);
  const out: Row[] = [];
  idx.forEach((i, n) => {
    if (n > 0 && (before > 0 || after > 0) && i !== (idx[n - 1] as number) + 1) out.push("--");
    out.push({ i, hit: keep.get(i) === true });
  });
  return out;
}

/** Whether `--include` and `--exclude` let a file name through. */
function wanted(c: Cmd, name: string): boolean {
  const include = allValues(c.args, GREP_FLAGS, "", "include");
  const exclude = allValues(c.args, GREP_FLAGS, "", "exclude");
  const base = baseName(name);
  return (
    (include.length === 0 || include.some((g) => globToRegExp(g).test(base))) &&
    !exclude.some((g) => globToRegExp(g).test(base))
  );
}

function allFiles(c: Cmd, files: readonly string[], recursive: boolean): string[] {
  const names: string[] = [];
  for (const f of files) {
    const path = normalize(c.cwd, f);
    if (recursive && c.fs.isDir(path))
      names.push(
        ...c.fs
          .walk(path)
          .filter((q) => c.fs.stat(q)?.type === "f")
          .map((q) => (f.startsWith("/") ? q : q.slice(c.cwd.length + 1))),
      );
    else names.push(f);
  }
  return names.filter((n) => wanted(c, n));
}

interface Shown {
  readonly p: Flags;
  /** Whether each line starts with the name of its file (`-H`, or several files and no `-h`). */
  readonly names: boolean;
  readonly re: RegExp;
  readonly ctx: [number, number];
}

/** The parts of a line that matched, for `-o`; none when the lines asked for are the ones that did not match. */
function parts(line: string, s: Shown): string[] {
  if (s.p.flags.has("v")) return [];
  const all = new RegExp(s.re.source, `${s.re.flags}g`);
  return [...line.matchAll(all)].map((m) => m[0]).filter((m) => m !== "");
}

function describeMatch(m: Match, s: Shown): string[] {
  const label = (i: number, sep: string): string =>
    `${s.names ? `${m.file}${sep}` : ""}${s.p.flags.has("n") ? `${i + 1}${sep}` : ""}`;
  return withContext(m, s.ctx[0], s.ctx[1]).flatMap((row) => {
    if (row === "--") return ["--"];
    const line = m.lines[row.i] as string;
    if (s.p.flags.has("o"))
      return row.hit ? parts(line, s).map((x) => `${label(row.i, ":")}${x}`) : [];
    return [`${label(row.i, row.hit ? ":" : "-")}${line}`];
  });
}

/** The lines one file adds to the output, and whether it matched. */
function grepFile(
  input: { name: string; text: string },
  re: RegExp,
  s: Shown,
): { out: string[]; hit: boolean } {
  const { p } = s;
  if (input.text.startsWith("\u007fELF"))
    return { out: re.test(input.text) ? [`Binary file ${input.name} matches`] : [], hit: false };
  const found = scan(input.text, re, has(p, "v"), intOf(p, "m", Number.POSITIVE_INFINITY));
  const hit = found.hits.length > 0;
  if (has(p, "q")) return { out: [], hit };
  if (has(p, "l")) return { out: hit ? [input.name] : [], hit };
  if (has(p, "L")) return { out: hit ? [] : [input.name], hit };
  if (has(p, "c"))
    return {
      out: [s.names ? `${input.name}:${found.hits.length}` : String(found.hits.length)],
      hit,
    };
  return { out: describeMatch({ file: input.name, ...found }, s), hit };
}

/** The `-A`, `-B` and `-C` context, before and after. */
function contextOf(p: Flags): [number, number] {
  const both = intOf(p, "C", 0) || 0;
  return [intOf(p, "B", both) || both, intOf(p, "A", both) || both];
}

function exitCode(p: Flags, errors: number, anyHit: boolean): number {
  if (errors > 0 && !anyHit) return 2;
  return anyHit || has(p, "c") ? 0 : 1;
}

const GREP_SUPPORTED =
  "-e -f -E -F -P(-E처럼) -i -v -c -n -l -L -w -x -o -h -H -q -s -a -I -r -R -m N -A N -B N -C N, --include --exclude --color=auto|never";

/** `--color=always` writes escape codes this fake does not make; `auto` and `never` print plain text, as a pipe does. */
function colorRefusal(p: Flags): R | undefined {
  const mode = p.flags.get("--color") ?? p.flags.get("--colour");
  if (mode === undefined || ["", "auto", "never", "none", "no", "tty", "if-tty"].includes(mode))
    return undefined;
  if (["always", "yes", "force"].includes(mode))
    return emulationGap({
      tool: "grep",
      feature: "color-always",
      what: `--color=${mode}`,
      supported: GREP_SUPPORTED,
      example: "grep -n root /etc/passwd",
    });
  return fail(
    `grep: invalid argument ‘${mode}’ for ‘--color’\nValid arguments are:\n  - ‘always’, ‘yes’, ‘force’\n  - ‘never’, ‘no’, ‘none’\n  - ‘auto’, ‘tty’, ‘if-tty’\nUsage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.`,
    2,
  );
}

export function grep(c: Cmd): R {
  const p = parseArgs(c.args, GREP_FLAGS);
  if (p.bad) return badFlag("grep", p, GREP_SUPPORTED);
  const color = colorRefusal(p);
  if (color) return color;
  const parsed = patternOf(c, p);
  if ("code" in parsed) return parsed;
  const recursive = has(p, "r") || has(p, "R") || has(p, "--recursive");
  const files = parsed.files.length === 0 && recursive ? ["."] : parsed.files;
  const { inputs, errors } = readInputs(c, allFiles(c, files, recursive));
  // a single file named on the command line is not labelled, even with -r (a directory is)
  const several =
    inputs.length > 1 || files.some((f) => recursive && c.fs.isDir(normalize(c.cwd, f)));
  const shown: Shown = {
    p,
    names: has(p, "H") || (several && !has(p, "h")),
    re: parsed.re,
    ctx: contextOf(p),
  };
  const results = inputs.map((input) => grepFile(input, parsed.re, shown));
  const anyHit = results.some((r) => r.hit);
  return {
    out: joinLines(results.flatMap((r) => r.out)),
    err: has(p, "s") ? "" : errText(errors),
    code: exitCode(p, errors.length, anyHit),
  };
}
