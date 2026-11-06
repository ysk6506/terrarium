/** `find` of the fake shell (ADR-0117 decision 4): `-name -type -size -mtime -newer`, `-print`, `-ls`, `-delete` and `-exec`. */

import { removeAll, shown } from "./cmd-fs";
import { longLine } from "./fmt";
import { baseName } from "./fs";
import { globToRegExp } from "./glob";
import { type Cmd, joinLines, type R, unsupported } from "./types";

// ── find ────────────────────────────────────────────────────────────────────────────────────

type FindTest = (path: string, st: NonNullable<ReturnType<Cmd["fs"]["stat"]>>) => boolean;

function sizeTest(spec: string): FindTest | undefined {
  const m = /^([+-]?)(\d+)([cwbkMG]?)$/.exec(spec);
  if (!m) return undefined;
  const mult =
    { c: 1, w: 2, b: 512, k: 1024, M: 1048576, G: 1073741824, "": 512 }[m[3] as "c"] ?? 512;
  const n = Number(m[2]) * mult;
  return (_p, st) =>
    m[1] === "+"
      ? st.size > n
      : m[1] === "-"
        ? st.size < n
        : Math.ceil(st.size / mult) * mult === n;
}

function ageTest(spec: string, unit: number, now: number): FindTest | undefined {
  const m = /^([+-]?)(\d+)$/.exec(spec);
  if (!m) return undefined;
  const n = Number(m[2]);
  return (_p, st) => {
    const age = Math.floor((now - st.mtime) / unit);
    return m[1] === "+" ? age > n : m[1] === "-" ? age < n : age === n;
  };
}

interface FindPlan {
  readonly tests: FindTest[];
  readonly roots: string[];
  readonly maxDepth: number;
  readonly minDepth: number;
  readonly action: "print" | "ls" | "delete" | "exec";
  readonly exec?: string[];
  readonly bad?: string;
}

const NUMERIC_OPTIONS = new Set(["-maxdepth", "-mindepth"]);
const ACTIONS: Readonly<Record<string, FindPlan["action"]>> = {
  "-print": "print",
  "-ls": "ls",
  "-delete": "delete",
};

/** The words before the first option are the places to search. */
function rootsOf(args: string[]): string[] {
  const roots: string[] = [];
  while (args[0] !== undefined && !args[0].startsWith("-") && args[0] !== "!" && args[0] !== "(")
    roots.push(args.shift() as string);
  return roots.length ? roots : ["."];
}

function planFind(c: Cmd): FindPlan {
  const args = [...c.args];
  const roots = rootsOf(args);
  const tests: FindTest[] = [];
  const plan = {
    roots,
    tests,
    maxDepth: Number.POSITIVE_INFINITY,
    minDepth: 0,
    action: "print" as FindPlan["action"],
  };
  let exec: string[] | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    const v = args[i + 1] ?? "";
    const made = makeTest(c, a, v, c.h.t);
    if (made) {
      tests.push(made);
      i++;
    } else if (NUMERIC_OPTIONS.has(a)) {
      if (a === "-maxdepth") plan.maxDepth = Number(v);
      else plan.minDepth = Number(v);
      i++;
    } else if (ACTIONS[a]) plan.action = ACTIONS[a] as FindPlan["action"];
    else if (a === "-exec") {
      const end = args.findIndex((x, k) => k > i && (x === ";" || x === "+"));
      exec = args.slice(i + 1, end < 0 ? undefined : end);
      plan.action = "exec";
      i = end < 0 ? args.length : end;
    } else return { ...plan, bad: a };
  }
  return { ...plan, ...(exec ? { exec } : {}) };
}

function makeTest(c: Cmd, flag: string, v: string, now: number): FindTest | undefined {
  switch (flag) {
    case "-name":
      return (p) => globToRegExp(v).test(baseName(p));
    case "-iname":
      return (p) => new RegExp(globToRegExp(v).source, "i").test(baseName(p));
    case "-path":
      return (p) => globToRegExp(v).test(p);
    case "-type":
      return (_p, st) => st.type === v;
    case "-size":
      return sizeTest(v);
    case "-mtime":
      return ageTest(v, 86_400, now);
    case "-mmin":
      return ageTest(v, 60, now);
    case "-newer":
      return (_p, st) => st.mtime > (c.fs.stat(shown(c, v))?.mtime ?? Number.POSITIVE_INFINITY);
    case "-user":
      return (_p, st) => st.owner === v;
    case "-empty":
      return (p, st) => (st.type === "d" ? (c.fs.list(p) ?? []).length === 0 : st.size === 0);
    default:
      return undefined;
  }
}

export function find(c: Cmd): R {
  if (c.args.some((a) => ["-o", "-or", "(", "!", "-not", "-regex", "-perm", "-printf"].includes(a)))
    return unsupported(
      "find",
      c.args.find((a) =>
        ["-o", "-or", "(", "!", "-not", "-regex", "-perm", "-printf"].includes(a),
      ) as string,
    );
  const plan = planFind(c);
  if (plan.bad) return unsupported("find", plan.bad);
  const out: string[] = [];
  const errs: string[] = [];
  const hit: string[] = [];
  for (const root of plan.roots) {
    const path = shown(c, root);
    if (!c.fs.exists(path)) {
      errs.push(`find: '${root}': No such file or directory`);
      continue;
    }
    for (const p of c.fs.walk(path)) {
      const depth = p === path ? 0 : p.slice(path.length).split("/").length - 1;
      const st = c.fs.stat(p);
      if (
        !st ||
        depth < plan.minDepth ||
        depth > plan.maxDepth ||
        !plan.tests.every((t) => t(p, st))
      )
        continue;
      hit.push(p);
      out.push(plan.action === "ls" ? longLine(p, st) : label(root, path, p));
    }
  }
  return finishFind(c, plan, hit, out, errs);
}

const label = (root: string, path: string, p: string): string =>
  root === path ? p : root + p.slice(path.length);

function finishFind(c: Cmd, plan: FindPlan, hit: string[], out: string[], errs: string[]): R {
  const err = errs.length ? `${errs.join("\n")}\n` : "";
  if (plan.action === "delete") return removeAll(c, hit, true, true, err);
  if (plan.action === "exec" && plan.exec) {
    let text = "";
    let e = err;
    for (const p of hit) {
      const r = c.run(
        plan.exec.map((w) => w.split("{}").join(p)),
        "",
      );
      text += r.out;
      e += r.err ?? "";
    }
    return { out: text, err: e, code: errs.length ? 1 : 0 };
  }
  return { out: joinLines(out), err, code: errs.length ? 1 : 0 };
}
