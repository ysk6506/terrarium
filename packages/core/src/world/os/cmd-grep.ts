/** `grep`, `egrep`, `fgrep` and `sort` of the fake shell (ADR-0117 decision 4): the real options, JavaScript regular expressions underneath. */
import { has, intOf, parseArgs } from "./args";
import { normalize } from "./fs";
import { errText, readInputs } from "./io";
import { escapeLiteral, translate } from "./regex";
import { type Cmd, fail, joinLines, linesOf, ok, type R, unsupported } from "./types";

const GREP_FLAGS = {
  bool: "ivcnEFrRlLwxohHqsaIPz",
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
  },
} as const;

type Flags = ReturnType<typeof parseArgs>;

/** The pattern wrapped for `-w` and `-x`, translated to JavaScript unless it is a fixed string. */
function wrapped(p: Flags, body: string): string {
  if (p.flags.has("x")) return `^(?:${body})$`;
  return p.flags.has("w") ? `\\b(?:${body})\\b` : body;
}

/** The regular expression of a grep call, or the error to print. */
function compile(c: Cmd, p: Flags, src: string): RegExp | R {
  const fixed = p.flags.has("F") || c.name === "fgrep";
  const extended = p.flags.has("E") || p.flags.has("P") || c.name === "egrep";
  const ignoreCase = p.flags.has("i");
  try {
    const body = fixed ? escapeLiteral(src) : translate(src, extended);
    return new RegExp(wrapped(p, body), ignoreCase ? "i" : "");
  } catch {
    return fail("grep: Invalid regular expression", 2);
  }
}

function patternOf(c: Cmd, p: Flags): { re: RegExp; files: string[] } | R {
  const explicit = p.flags.get("e") ?? p.flags.get("--regexp");
  const src = explicit ?? p.rest[0];
  if (src === undefined) return fail("Usage: grep [OPTION]... PATTERNS [FILE]...", 2);
  const re = compile(c, p, src);
  return "code" in re ? re : { re, files: explicit === undefined ? p.rest.slice(1) : p.rest };
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
  return names;
}

interface Shown {
  readonly p: Flags;
  readonly multi: boolean;
  readonly ctx: [number, number];
}

function describeMatch(m: Match, s: Shown): string[] {
  const label = (i: number, sep: string): string =>
    `${s.multi && !s.p.flags.has("h") ? `${m.file}${sep}` : ""}${s.p.flags.has("n") ? `${i + 1}${sep}` : ""}`;
  return withContext(m, s.ctx[0], s.ctx[1]).flatMap((row) => {
    if (row === "--") return ["--"];
    if (s.p.flags.has("o") && row.hit) return (m.lines[row.i] as string).match(/.+/g) ?? [];
    return [`${label(row.i, row.hit ? ":" : "-")}${m.lines[row.i]}`];
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
      out: [s.multi ? `${input.name}:${found.hits.length}` : String(found.hits.length)],
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

export function grep(c: Cmd): R {
  const p = parseArgs(c.args, GREP_FLAGS);
  if (p.bad) return unsupported("grep", p.bad);
  const parsed = patternOf(c, p);
  if ("code" in parsed) return parsed;
  const recursive = has(p, "r") || has(p, "R") || has(p, "--recursive");
  const files = parsed.files.length === 0 && recursive ? ["."] : parsed.files;
  const { inputs, errors } = readInputs(c, allFiles(c, files, recursive));
  const shown: Shown = { p, multi: inputs.length > 1 || recursive, ctx: contextOf(p) };
  const results = inputs.map((input) => grepFile(input, parsed.re, shown));
  const anyHit = results.some((r) => r.hit);
  return {
    out: joinLines(results.flatMap((r) => r.out)),
    err: has(p, "s") ? "" : errText(errors),
    code: exitCode(p, errors.length, anyHit),
  };
}

// ── sort ────────────────────────────────────────────────────────────────────────────────────

interface Key {
  readonly field: number;
  readonly numeric: boolean;
  readonly reverse: boolean;
}

function keyOf(spec: string | undefined, flags: { n: boolean; r: boolean }): Key {
  if (spec === undefined) return { field: 0, numeric: flags.n, reverse: flags.r };
  const m = /^(\d+)(?:,\d+)?([a-zA-Z]*)/.exec(spec);
  return {
    field: Number(m?.[1] ?? 0),
    numeric: flags.n || (m?.[2] ?? "").includes("n"),
    reverse: flags.r || (m?.[2] ?? "").includes("r"),
  };
}

function fieldOf(line: string, field: number, sep: string | undefined): string {
  if (field === 0) return line;
  const parts = sep === undefined ? line.trim().split(/\s+/) : line.split(sep);
  return parts[field - 1] ?? "";
}

const leadingNumber = (s: string): number => {
  const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]) : 0;
};

const HUMAN: Readonly<Record<string, number>> = {
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4,
};
const humanNumber = (s: string): number => {
  const m = /^\s*(\d+(?:\.\d+)?)([KMGT]?)/.exec(s);
  return m ? Number(m[1]) * (HUMAN[m[2] ?? ""] ?? 1) : 0;
};

export function sort(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "nrufhbcsV", val: "ktoT" });
  if (p.bad) return unsupported("sort", p.bad);
  const key = keyOf(p.flags.get("k"), { n: has(p, "n"), r: has(p, "r") });
  const human = has(p, "h");
  const sep = p.flags.get("t");
  const { inputs, errors } = readInputs(c, p.rest);
  const fold = has(p, "f");
  const value = (l: string): string => {
    const f = fieldOf(l, key.field, sep);
    return fold ? f.toLowerCase() : f;
  };
  const cmp = (a: string, b: string): number => {
    const [x, y] = [value(a), value(b)];
    const r = human
      ? humanNumber(x) - humanNumber(y)
      : key.numeric
        ? leadingNumber(x) - leadingNumber(y)
        : x < y
          ? -1
          : x > y
            ? 1
            : 0;
    return (r !== 0 ? r : a < b ? -1 : a > b ? 1 : 0) * (key.reverse ? -1 : 1);
  };
  let rows = linesOf(inputs.map((i) => i.text).join("")).sort(cmp);
  if (has(p, "u"))
    rows = rows.filter(
      (l, i) =>
        i === 0 || cmp(l, rows[i - 1] as string) !== 0 || value(l) !== value(rows[i - 1] as string),
    );
  return { ...ok(joinLines(rows)), err: errText(errors), code: errors.length ? 2 : 0 };
}
