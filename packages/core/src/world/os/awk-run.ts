/** The interpreter of the small `awk` (ADR-0117): values, fields, variables, arrays, expressions and statements. */
import { numToStr, sprintf } from "./awk-fmt";
import { AwkSyntax } from "./awk-lex";
import type { Expr, Stmt } from "./awk-parse";
import { posixRegExp } from "./regex";

/** A field or other input string that counts as a number when it looks like one. */
export class StrNum {
  constructor(readonly s: string) {}
  get numeric(): boolean {
    return /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(this.s);
  }
}

export type Val = number | string | StrNum;
export type Flow = "next" | "exit" | "break" | "continue" | undefined;

const STEP_LIMIT = 2_000_000;

export function toNum(v: Val): number {
  if (typeof v === "number") return v;
  const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(typeof v === "string" ? v : v.s);
  return m ? Number(m[0]) : 0;
}

export function toStr(v: Val): string {
  if (typeof v === "number") return numToStr(v);
  return typeof v === "string" ? v : v.s;
}

function truthy(v: Val): boolean {
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "";
  return v.numeric ? toNum(v) !== 0 : v.s !== "";
}

const isNumeric = (v: Val): boolean => typeof v === "number" || (v instanceof StrNum && v.numeric);

function compare(a: Val, b: Val): number {
  if (isNumeric(a) && isNumeric(b)) return toNum(a) - toNum(b);
  const [x, y] = [toStr(a), toStr(b)];
  return x < y ? -1 : x > y ? 1 : 0;
}

export class Rt {
  readonly vars = new Map<string, Val>([
    ["FS", " "],
    ["OFS", " "],
    ["ORS", "\n"],
    ["NR", 0],
    ["NF", 0],
    ["RSTART", 0],
    ["RLENGTH", -1],
    ["SUBSEP", "\u001c"],
    ["FILENAME", ""],
  ]);
  readonly arrays = new Map<string, Map<string, Val>>();
  fields: string[] = [];
  rec = "";
  out = "";
  steps = 0;
  exitCode: number | undefined;
  private seed = 1;
  private readonly regexes = new Map<string, RegExp>();
  readonly ranges = new Map<number, boolean>();

  tick(): void {
    if (++this.steps > STEP_LIMIT) throw new AwkSyntax("프로그램이 너무 오래 걸려요");
  }

  get(name: string): Val {
    return this.vars.get(name) ?? new StrNum("");
  }

  set(name: string, v: Val): void {
    if (name === "RS" && toStr(v) !== "\n")
      throw new AwkSyntax("RS (레코드 구분자는 줄바꿈만 돼요)는 이 흉내에서 안 돼요", "awk RS");
    this.vars.set(name, v);
    if (name === "NF") this.setNF(toNum(v));
  }

  array(name: string): Map<string, Val> {
    let a = this.arrays.get(name);
    if (!a) {
      a = new Map();
      this.arrays.set(name, a);
    }
    return a;
  }

  regex(src: string): RegExp {
    let re = this.regexes.get(src);
    if (!re) {
      re = posixRegExp(src, { extended: true });
      this.regexes.set(src, re);
    }
    return re;
  }

  global(src: string): RegExp {
    return posixRegExp(src, { extended: true, global: true });
  }

  random(): number {
    this.seed = (this.seed * 1103515245 + 12345) % 2_147_483_648;
    return this.seed / 2_147_483_648;
  }

  reseed(n: number): void {
    this.seed = Math.trunc(n) || 1;
  }

  setRecord(line: string): void {
    this.rec = line;
    this.fields = this.split(line, toStr(this.get("FS")));
    this.vars.set("NF", this.fields.length);
  }

  split(text: string, fs: string): string[] {
    if (text === "") return [];
    if (fs === " ")
      return text
        .trim()
        .split(/\s+/)
        .filter((s) => s !== "");
    if (fs === "\t" || fs.length === 1)
      return text.split(fs === "\t" ? "\t" : fs.replace(/^\\/, ""));
    return text.split(this.regex(fs));
  }

  field(n: number): Val {
    if (n === 0) return new StrNum(this.rec);
    return new StrNum(this.fields[n - 1] ?? "");
  }

  setField(n: number, v: string): void {
    if (n === 0) {
      this.setRecord(v);
      return;
    }
    while (this.fields.length < n) this.fields.push("");
    this.fields[n - 1] = v;
    this.vars.set("NF", this.fields.length);
    this.rec = this.fields.join(toStr(this.get("OFS")));
  }

  private setNF(n: number): void {
    this.fields = this.fields.slice(0, n);
    while (this.fields.length < n) this.fields.push("");
    this.rec = this.fields.join(toStr(this.get("OFS")));
  }
}

// ── expressions ─────────────────────────────────────────────────────────────────────────────

const key = (rt: Rt, sub: Expr[]): string =>
  sub.map((e) => toStr(ev(rt, e))).join(toStr(rt.get("SUBSEP")));

function assignTo(rt: Rt, lhs: Expr, v: Val): void {
  if (lhs.t === "var") rt.set(lhs.name, v);
  else if (lhs.t === "idx") rt.array(lhs.name).set(key(rt, lhs.sub), v);
  else if (lhs.t === "field") rt.setField(Math.trunc(toNum(ev(rt, lhs.e))), toStr(v));
}

const ARITH: Readonly<Record<string, (a: number, b: number) => number>> = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => {
    if (b === 0) throw new AwkSyntax("division by zero");
    return a / b;
  },
  "%": (a, b) => {
    if (b === 0) throw new AwkSyntax("division by zero in %");
    return a % b;
  },
  "^": (a, b) => a ** b,
};

const COMPARE: Readonly<Record<string, (c: number) => boolean>> = {
  "<": (c) => c < 0,
  "<=": (c) => c <= 0,
  "==": (c) => c === 0,
  "!=": (c) => c !== 0,
  ">": (c) => c > 0,
  ">=": (c) => c >= 0,
};

function matchOp(rt: Rt, e: Extract<Expr, { t: "bin" }>): Val {
  const hit = rt.regex(e.r.t === "re" ? e.r.v : toStr(ev(rt, e.r))).test(toStr(ev(rt, e.l)));
  return hit === (e.op === "~") ? 1 : 0;
}

const LOGIC: Readonly<Record<string, (rt: Rt, e: Extract<Expr, { t: "bin" }>) => Val>> = {
  "&&": (rt, e) => (truthy(ev(rt, e.l)) && truthy(ev(rt, e.r)) ? 1 : 0),
  "||": (rt, e) => (truthy(ev(rt, e.l)) || truthy(ev(rt, e.r)) ? 1 : 0),
  "~": matchOp,
  "!~": matchOp,
};

function binary(rt: Rt, e: Extract<Expr, { t: "bin" }>): Val {
  const logic = LOGIC[e.op];
  if (logic) return logic(rt, e);
  const [a, b] = [ev(rt, e.l), ev(rt, e.r)];
  const cmp = COMPARE[e.op];
  if (cmp) return cmp(compare(a, b)) ? 1 : 0;
  return (ARITH[e.op] as (x: number, y: number) => number)(toNum(a), toNum(b));
}

function assign(rt: Rt, e: Extract<Expr, { t: "asg" }>): Val {
  let v = ev(rt, e.rhs);
  if (e.op !== "=") {
    const arith = ARITH[e.op.slice(0, -1)] as (x: number, y: number) => number;
    v = arith(toNum(ev(rt, e.lhs)), toNum(v));
  } else if (v instanceof StrNum) v = new StrNum(v.s);
  assignTo(rt, e.lhs, v);
  return v;
}

function incr(rt: Rt, e: Extract<Expr, { t: "incr" }>): Val {
  const before = toNum(ev(rt, e.lhs));
  const after = before + (e.op === "++" ? 1 : -1);
  assignTo(rt, e.lhs, after);
  return e.pre ? after : before;
}

type Evals = { [K in Expr["t"]]: (rt: Rt, e: Extract<Expr, { t: K }>) => Val };

const EVALS: Evals = {
  num: (_rt, e) => e.v,
  str: (_rt, e) => e.v,
  re: (rt, e) => (rt.regex(e.v).test(rt.rec) ? 1 : 0),
  var: (rt, e) => rt.get(e.name),
  idx: (rt, e) => {
    const a = rt.array(e.name);
    const k = key(rt, e.sub);
    if (!a.has(k)) a.set(k, new StrNum(""));
    return a.get(k) as Val;
  },
  field: (rt, e) => rt.field(Math.trunc(toNum(ev(rt, e.e)))),
  asg: assign,
  cond: (rt, e) => (truthy(ev(rt, e.c)) ? ev(rt, e.a) : ev(rt, e.b)),
  bin: binary,
  un: (rt, e) => {
    const v = ev(rt, e.e);
    return e.op === "!" ? (truthy(v) ? 0 : 1) : e.op === "-" ? -toNum(v) : toNum(v);
  },
  incr,
  call: (rt, e) => callBuiltin(rt, e.name, e.args),
  in: (rt, e) => (rt.array(e.name).has(key(rt, e.sub)) ? 1 : 0),
  cat: (rt, e) => toStr(ev(rt, e.l)) + toStr(ev(rt, e.r)),
};

export function ev(rt: Rt, e: Expr): Val {
  rt.tick();
  return (EVALS[e.t] as (r: Rt, x: Expr) => Val)(rt, e);
}

// ── built-in functions ──────────────────────────────────────────────────────────────────────

function substitute(rt: Rt, args: Expr[], all: boolean): Val {
  const [reE, replE, targetE] = args;
  if (!reE || !replE) throw new AwkSyntax("sub/gsub need a pattern and a replacement");
  const re = all
    ? rt.global(reE.t === "re" ? reE.v : toStr(ev(rt, reE)))
    : rt.regex(reE.t === "re" ? reE.v : toStr(ev(rt, reE)));
  const repl = toStr(ev(rt, replE));
  const target: Expr = targetE ?? { t: "field", e: { t: "num", v: 0 } };
  const text = toStr(ev(rt, target));
  let n = 0;
  const done = text.replace(re, (m) => {
    n++;
    return repl.replace(/\\&|&/g, (x) => (x === "&" ? m : "&"));
  });
  if (n > 0) assignTo(rt, target, done);
  return n;
}

function match(rt: Rt, args: Expr[]): Val {
  const [sE, reE] = args;
  if (!sE || !reE) throw new AwkSyntax("match needs a string and a pattern");
  const m = rt.regex(reE.t === "re" ? reE.v : toStr(ev(rt, reE))).exec(toStr(ev(rt, sE)));
  rt.set("RSTART", m ? m.index + 1 : 0);
  rt.set("RLENGTH", m ? m[0].length : -1);
  return m ? m.index + 1 : 0;
}

function split(rt: Rt, args: Expr[]): Val {
  const [sE, aE, fE] = args;
  if (!sE || aE?.t !== "var") throw new AwkSyntax("split needs a string and an array");
  const fs = fE ? (fE.t === "re" ? fE.v : toStr(ev(rt, fE))) : toStr(rt.get("FS"));
  const parts = rt.split(toStr(ev(rt, sE)), fs);
  const arr = rt.array(aE.name);
  arr.clear();
  for (const [i, p] of parts.entries()) arr.set(String(i + 1), new StrNum(p));
  return parts.length;
}

type Builtin = (rt: Rt, args: Expr[]) => Val;
const num1 =
  (f: (n: number) => number): Builtin =>
  (rt, a) =>
    f(toNum(a[0] ? ev(rt, a[0]) : 0));

const BUILTINS: Readonly<Record<string, Builtin>> = {
  length: (rt, a) => toStr(a[0] ? ev(rt, a[0]) : rt.field(0)).length,
  substr: (rt, a) => {
    const s = toStr(a[0] ? ev(rt, a[0]) : "");
    const start = Math.max(1, Math.round(toNum(a[1] ? ev(rt, a[1]) : 1)));
    const len = a[2] ? Math.round(toNum(ev(rt, a[2]))) : s.length;
    return s.substr(start - 1, Math.max(0, len));
  },
  index: (rt, a) => toStr(a[0] ? ev(rt, a[0]) : "").indexOf(toStr(a[1] ? ev(rt, a[1]) : "")) + 1,
  split,
  sub: (rt, a) => substitute(rt, a, false),
  gsub: (rt, a) => substitute(rt, a, true),
  match,
  sprintf: (rt, a) => {
    const vals = a.map((x) => ev(rt, x));
    return sprintf(toStr(vals[0] ?? ""), vals.slice(1), toNum, toStr);
  },
  tolower: (rt, a) => toStr(a[0] ? ev(rt, a[0]) : "").toLowerCase(),
  toupper: (rt, a) => toStr(a[0] ? ev(rt, a[0]) : "").toUpperCase(),
  int: num1(Math.trunc),
  sqrt: num1(Math.sqrt),
  exp: num1(Math.exp),
  log: num1(Math.log),
  sin: num1(Math.sin),
  cos: num1(Math.cos),
  atan2: (rt, a) => Math.atan2(toNum(a[0] ? ev(rt, a[0]) : 0), toNum(a[1] ? ev(rt, a[1]) : 0)),
  rand: (rt) => rt.random(),
  srand: (rt, a) => {
    rt.reseed(toNum(a[0] ? ev(rt, a[0]) : 0));
    return 0;
  },
};

function callBuiltin(rt: Rt, name: string, args: Expr[]): Val {
  const f = BUILTINS[name];
  if (!f) throw new AwkSyntax(`function ${name} never defined`);
  return f(rt, args);
}

// ── statements ──────────────────────────────────────────────────────────────────────────────

function printStmt(rt: Rt, s: Extract<Stmt, { t: "print" | "printf" }>): Flow {
  if (s.t === "print") {
    const vals = s.args.length ? s.args.map((a) => toStr(ev(rt, a))) : [rt.rec];
    rt.out += vals.join(toStr(rt.get("OFS"))) + toStr(rt.get("ORS"));
  } else {
    const vals = s.args.map((a) => ev(rt, a));
    rt.out += sprintf(toStr(vals[0] ?? ""), vals.slice(1), toNum, toStr);
  }
  return undefined;
}

function block(rt: Rt, body: readonly Stmt[]): Flow {
  for (const s of body) {
    const f = exec(rt, s);
    if (f) return f;
  }
  return undefined;
}

function loopBody(rt: Rt, body: Stmt): { stop: boolean; flow: Flow } {
  const f = exec(rt, body);
  if (f === "break") return { stop: true, flow: undefined };
  if (f === "next" || f === "exit") return { stop: true, flow: f };
  return { stop: false, flow: undefined };
}

function whileStmt(rt: Rt, s: Extract<Stmt, { t: "while" }>): Flow {
  while (truthy(ev(rt, s.c))) {
    const r = loopBody(rt, s.body);
    if (r.stop) return r.flow;
  }
  return undefined;
}

function forStmt(rt: Rt, s: Extract<Stmt, { t: "for" }>): Flow {
  if (s.init) exec(rt, s.init);
  while (s.cond === undefined || truthy(ev(rt, s.cond))) {
    const r = loopBody(rt, s.body);
    if (r.stop) return r.flow;
    if (s.step) exec(rt, s.step);
  }
  return undefined;
}

function forIn(rt: Rt, s: Extract<Stmt, { t: "forin" }>): Flow {
  for (const k of [...rt.array(s.arr).keys()]) {
    rt.set(s.v, new StrNum(k));
    const r = loopBody(rt, s.body);
    if (r.stop) return r.flow;
  }
  return undefined;
}

type Execs = { [K in Stmt["t"]]: (rt: Rt, s: Extract<Stmt, { t: K }>) => Flow };

const EXECS: Execs = {
  print: printStmt,
  printf: printStmt,
  expr: (rt, s) => {
    ev(rt, s.e);
    return undefined;
  },
  if: (rt, s) => (truthy(ev(rt, s.c)) ? exec(rt, s.a) : s.b ? exec(rt, s.b) : undefined),
  while: whileStmt,
  for: forStmt,
  forin: forIn,
  block: (rt, s) => block(rt, s.body),
  next: () => "next",
  exit: (rt, s) => {
    if (s.e) rt.exitCode = Math.trunc(toNum(ev(rt, s.e)));
    return "exit";
  },
  delete: (rt, s) => {
    if (s.sub) rt.array(s.name).delete(key(rt, s.sub));
    else rt.array(s.name).clear();
    return undefined;
  },
  break: () => "break",
  continue: () => "continue",
};

export function exec(rt: Rt, s: Stmt): Flow {
  rt.tick();
  return (EXECS[s.t] as (r: Rt, x: Stmt) => Flow)(rt, s);
}

export const runBlock = block;
export { truthy };
