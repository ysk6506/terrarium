/** Text commands of the fake shell: echo, printf, cat, head, tail, wc, tee, tr, cut, uniq, xargs, test (ADR-0117). */
import { intOf, parseArgs } from "./args";
import { normalize } from "./fs";
import { errText, readInputs } from "./io";
import {
  act,
  byteLength,
  type Cmd,
  fail,
  joinLines,
  linesOf,
  ok,
  type R,
  unsupported,
} from "./types";

const ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "\\": "\\",
  "0": "\0",
  a: "\u0007",
};

/** Read backslash escapes (`\n`, `\t`, `\\`, `\0`) the way `echo -e`, `printf` and `tr` do. */
export function unescapeText(s: string): string {
  return s.replace(/\\(.)/g, (m, ch: string) => ESCAPES[ch] ?? m);
}

export function echo(c: Cmd): R {
  let args = [...c.args];
  let newline = true;
  let escapes = false;
  while (/^-[neE]+$/.test(args[0] ?? "")) {
    const flag = args[0] as string;
    if (flag.includes("n")) newline = false;
    if (flag.includes("e")) escapes = true;
    args = args.slice(1);
  }
  const text = args.join(" ");
  return ok(`${escapes ? unescapeText(text) : text}${newline ? "\n" : ""}`);
}

export function printf(c: Cmd): R {
  const [fmt = "", ...values] = c.args;
  let i = 0;
  const out = unescapeText(fmt).replace(
    /%(-?\d*)(?:\.(\d+))?([sdif%])/g,
    (_m, width: string, prec: string | undefined, kind: string) => {
      if (kind === "%") return "%";
      const v = values[i++] ?? "";
      const text =
        kind === "s"
          ? v
          : kind === "f"
            ? Number(v || 0).toFixed(prec === undefined ? 6 : Number(prec))
            : String(Math.trunc(Number(v || 0)));
      const n = Math.abs(Number(width || 0));
      return width.startsWith("-") ? text.padEnd(n) : text.padStart(n);
    },
  );
  return ok(out);
}

export function cat(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "nAvEsbT" });
  if (p.bad) return unsupported("cat", p.bad);
  const { inputs, errors } = readInputs(c, p.rest);
  let text = inputs.map((i) => i.text).join("");
  if (p.flags.has("n") || p.flags.has("b")) {
    const rows = linesOf(text);
    text = joinLines(rows.map((l, k) => `${String(k + 1).padStart(6)}\t${l}`));
  }
  return { out: text, err: errText(errors), code: errors.length ? 1 : 0 };
}

function pick(c: Cmd, from: "head" | "tail"): R {
  const p = parseArgs(c.args, {
    bool: "qv",
    val: "nc",
    digits: true,
    long: { follow: "bool", retry: "bool" },
  });
  if (p.bad) return unsupported(from, p.bad);
  const n = intOf(p, "n", 10);
  if (Number.isNaN(n) && !/^[+-]?\d+$/.test(p.flags.get("n") ?? ""))
    return fail(`${from}: invalid number of lines: '${p.flags.get("n")}'`);
  const raw = p.flags.get("n") ?? "10";
  const { inputs, errors } = readInputs(c, p.rest);
  const bytes = p.flags.get("c");
  const parts = inputs.map((i) => {
    const body =
      bytes !== undefined
        ? from === "head"
          ? i.text.slice(0, Number(bytes))
          : i.text.slice(-Number(bytes))
        : selectLines(i.text, from, raw);
    return inputs.length > 1 && !p.flags.has("q") ? `==> ${i.name} <==\n${body}` : body;
  });
  const following = p.flags.has("f") || p.flags.has("--follow");
  const base: R = { out: parts.join("\n"), err: errText(errors), code: errors.length ? 1 : 0 };
  return following
    ? {
        ...base,
        err: `${base.err}tail: -f는 이 흉내에서 안 돼요, 지금까지의 마지막 줄만 보여요\n`,
        outside: "tail -f",
      }
    : base;
}

function selectLines(text: string, from: "head" | "tail", raw: string): string {
  const lines = linesOf(text);
  const n = Math.abs(Number(raw));
  if (from === "head")
    return joinLines(
      raw.startsWith("-") ? lines.slice(0, Math.max(0, lines.length - n)) : lines.slice(0, n),
    );
  return joinLines(
    raw.startsWith("+") ? lines.slice(Math.max(0, n - 1)) : n === 0 ? [] : lines.slice(-n),
  );
}

export const head = (c: Cmd): R => pick(c, "head");
export const tail = (c: Cmd): R => {
  const withF: Cmd = { ...c, args: c.args.map((a) => (a === "-f" || a === "-F" ? "--follow" : a)) };
  return pick(withF, "tail");
};

export function wc(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "lwcm" });
  if (p.bad) return unsupported("wc", p.bad);
  const { inputs, errors } = readInputs(c, p.rest);
  const all = !p.flags.has("l") && !p.flags.has("w") && !p.flags.has("c") && !p.flags.has("m");
  const rows = inputs.map((i) => {
    const cols: number[] = [];
    if (all || p.flags.has("l")) cols.push(i.text.split("\n").length - 1);
    if (all || p.flags.has("w")) cols.push(i.text.split(/\s+/).filter(Boolean).length);
    if (all || p.flags.has("c") || p.flags.has("m")) cols.push(byteLength(i.text));
    return { cols, name: i.name };
  });
  const lone = rows.length === 1 && rows[0]?.cols.length === 1;
  const fmt = (r: { cols: number[]; name: string }): string =>
    lone && p.rest.length === 0
      ? String(r.cols[0])
      : `${r.cols.map((n) => String(n).padStart(7)).join("")}${r.name === "-" ? "" : ` ${r.name}`}`;
  const lines = rows.map(fmt);
  if (rows.length > 1)
    lines.push(
      `${(rows[0]?.cols ?? []).map((_, k) => String(rows.reduce((s, r) => s + (r.cols[k] ?? 0), 0)).padStart(7)).join("")} total`,
    );
  return { out: joinLines(lines), err: errText(errors), code: errors.length ? 1 : 0 };
}

export function tee(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "ai" });
  let err = "";
  for (const f of p.rest) {
    const path = normalize(c.cwd, f);
    const denied = c.fs.denyWrite(path);
    if (denied)
      err += `tee: ${f}: ${denied === "ro" ? "Read-only file system" : "Permission denied"}\n`;
    else act(c, "write", path, p.flags.has("a") ? (c.fs.read(path) ?? "") + c.stdin : c.stdin);
  }
  return { out: c.stdin, err, code: err ? 1 : 0 };
}

const CLASS_SETS: Readonly<Record<string, string>> = {
  "[:upper:]": "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "[:lower:]": "abcdefghijklmnopqrstuvwxyz",
  "[:digit:]": "0123456789",
  "[:space:]": " \t\n\r\f\v",
  "[:alpha:]": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  "[:blank:]": " \t",
  "[:punct:]": "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
};

/** Expand a `tr` set: classes, ranges (`a-z`) and escapes. */
export function expandSet(set: string): string[] {
  let s = set;
  for (const [k, v] of Object.entries(CLASS_SETS)) s = s.split(k).join(v);
  const chars = [...unescapeText(s)];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const a = chars[i] as string;
    if (chars[i + 1] === "-" && i + 2 < chars.length) {
      const z = chars[i + 2] as string;
      for (let code = a.charCodeAt(0); code <= z.charCodeAt(0); code++)
        out.push(String.fromCharCode(code));
      i += 2;
    } else out.push(a);
  }
  return out;
}

/** What `tr` writes for one character of its input. */
function translateChar(
  ch: string,
  from: readonly string[],
  to: readonly string[],
  complement: boolean,
): string {
  if (to.length === 0) return ch;
  if (complement) return to[to.length - 1] ?? ch;
  return to[Math.min(from.indexOf(ch), to.length - 1)] ?? ch;
}

export function tr(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "dsc" });
  if (p.bad) return unsupported("tr", p.bad);
  if (p.rest.length === 0) return fail("tr: missing operand", 1);
  const from = expandSet(p.rest[0] ?? "");
  const to = expandSet(p.rest[1] ?? "");
  const complement = p.flags.has("c");
  let out = "";
  let last = "";
  for (const ch of c.stdin) {
    const inSet = from.includes(ch) !== complement;
    if (inSet && p.flags.has("d")) continue;
    const r = inSet ? translateChar(ch, from, to, complement) : ch;
    if (inSet && p.flags.has("s") && r === last) continue;
    out += r;
    last = r;
  }
  return ok(out);
}

/** `1,3-5,7-` as a test on a 1-based position. */
export function rangeTest(spec: string): ((n: number) => boolean) | undefined {
  const parts = spec.split(",").map((s) => /^(\d*)(-?)(\d*)$/.exec(s));
  if (parts.some((m) => !m || (m[1] === "" && m[3] === ""))) return undefined;
  return (n) =>
    parts.some((m) => {
      if (!m) return false;
      const lo = m[1] === "" ? 1 : Number(m[1]);
      const hi = m[2] === "" ? lo : m[3] === "" ? Number.POSITIVE_INFINITY : Number(m[3]);
      return n >= lo && n <= hi;
    });
}

export function cut(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "s", val: "dfcb", long: { "output-delimiter": "val" } });
  if (p.bad) return unsupported("cut", p.bad);
  const delim = p.flags.get("d") ?? "\t";
  const spec = p.flags.get("f") ?? p.flags.get("c") ?? p.flags.get("b");
  const test = spec === undefined ? undefined : rangeTest(spec);
  if (!test) return fail("cut: you must specify a list of bytes, characters, or fields", 1);
  const byField = p.flags.has("f");
  const joiner = p.flags.get("--output-delimiter") ?? delim;
  const { inputs, errors } = readInputs(c, p.rest);
  const out = inputs.flatMap((i) =>
    linesOf(i.text).flatMap((line) => {
      if (!byField) return [[...line].filter((_, k) => test(k + 1)).join("")];
      if (!line.includes(delim)) return p.flags.has("s") ? [] : [line];
      return [
        line
          .split(delim)
          .filter((_, k) => test(k + 1))
          .join(joiner),
      ];
    }),
  );
  return { out: joinLines(out), err: errText(errors), code: errors.length ? 1 : 0 };
}

export function uniq(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "cduiD" });
  if (p.bad) return unsupported("uniq", p.bad);
  const { inputs, errors } = readInputs(c, p.rest.slice(0, 1));
  const groups: Array<{ line: string; n: number }> = [];
  const norm = (s: string): string => (p.flags.has("i") ? s.toLowerCase() : s);
  for (const line of linesOf(inputs.map((i) => i.text).join(""))) {
    const last = groups[groups.length - 1];
    if (last && norm(last.line) === norm(line)) last.n++;
    else groups.push({ line, n: 1 });
  }
  const shown = groups.filter((g) =>
    p.flags.has("d") ? g.n > 1 : p.flags.has("u") ? g.n === 1 : true,
  );
  const rows = shown.map((g) =>
    p.flags.has("c") ? `${String(g.n).padStart(7)} ${g.line}` : g.line,
  );
  return { out: joinLines(rows), err: errText(errors), code: errors.length ? 1 : 0 };
}

/** The command lines `xargs` runs: one per item with `-I`, else chunks of `-n` (or all items at once). */
function xargsRuns(p: ReturnType<typeof parseArgs>, items: readonly string[]): string[][] {
  const base = p.rest.length ? p.rest : ["echo"];
  const placeholder = p.flags.get("I");
  if (placeholder !== undefined)
    return items.map((item) => base.map((w) => w.split(placeholder).join(item)));
  const per = intOf(p, "n", items.length || 1) || items.length || 1;
  const runs = chunks(items, per).map((chunk) => [...base, ...chunk]);
  return runs.length ? runs : [base];
}

export function xargs(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "t0r", val: "nIL", long: { "no-run-if-empty": "bool" } });
  if (p.bad) return unsupported("xargs", p.bad);
  const items = c.stdin.split(/\s+/).filter(Boolean);
  if (items.length === 0 && (p.flags.has("r") || p.flags.has("--no-run-if-empty"))) return ok("");
  const results = xargsRuns(p, items).map((argv) => c.run(argv, ""));
  const outside = results.find((r) => r.outside)?.outside;
  return {
    out: results.map((r) => r.out).join(""),
    err: results.map((r) => r.err ?? "").join(""),
    code: results.some((r) => r.code !== 0) ? 123 : 0,
    ...(outside ? { outside } : {}),
  };
}

const chunks = <T>(list: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, i * size + size),
  );

/** `test` and `[`: file tests, string tests and numeric comparisons. */
export function testCmd(c: Cmd): R {
  const args = c.name === "[" ? c.args.slice(0, -1) : [...c.args];
  const negate = args[0] === "!";
  const a = negate ? args.slice(1) : args;
  const result = evaluateTest(c, a);
  if (result === undefined) return unsupported(c.name, a.join(" "));
  return { out: "", code: result !== negate ? 0 : 1 };
}

function evaluateTest(c: Cmd, a: readonly string[]): boolean | undefined {
  const [x = "", op = "", y = ""] = a;
  if (a.length === 1) return x !== "";
  if (a.length === 2) return unaryTest(c, x, op);
  const nx = Number(x);
  const ny = Number(y);
  const table: Record<string, boolean> = {
    "=": x === y,
    "==": x === y,
    "!=": x !== y,
    "-eq": nx === ny,
    "-ne": nx !== ny,
    "-gt": nx > ny,
    "-ge": nx >= ny,
    "-lt": nx < ny,
    "-le": nx <= ny,
  };
  return a.length === 3 ? table[op] : undefined;
}

function unaryTest(c: Cmd, flag: string, arg: string): boolean | undefined {
  const path = normalize(c.cwd, arg);
  const table: Record<string, boolean> = {
    "-e": c.fs.exists(path),
    "-f": c.fs.stat(path)?.type === "f",
    "-d": c.fs.isDir(path),
    "-s": (c.fs.stat(path)?.size ?? 0) > 0,
    "-r": c.fs.exists(path),
    "-w": c.fs.exists(path) && !c.fs.denyWrite(path),
    "-z": arg === "",
    "-n": arg !== "",
  };
  return table[flag];
}
