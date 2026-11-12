/** `find` of the fake shell (ADR-0117 decision 4): `-name -type -size -mtime -newer`, `-print`, `-ls`, `-delete` and `-exec`. */

import { removeAll, shown } from "./cmd-fs";
import { longLine } from "./fmt";
import { baseName } from "./fs";
import { globToRegExp } from "./glob";
import { type Cmd, emulationGap, fail, joinLines, type R } from "./types";

// ── find ────────────────────────────────────────────────────────────────────────────────────

/** A test on one file: its real path, its stat, and the path as `find` prints it (for `-path`). */
type FindTest = (
  path: string,
  st: NonNullable<ReturnType<Cmd["fs"]["stat"]>>,
  label: string,
) => boolean;

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
  readonly test: FindTest;
  readonly roots: string[];
  readonly maxDepth: number;
  readonly minDepth: number;
  readonly action: "print" | "ls" | "delete" | "exec";
  readonly exec?: string[];
  /** Why the line cannot run: what the real find says, or the gap when the real find would run it. */
  readonly refusal?: R;
}

const NUMERIC_OPTIONS = new Set(["-maxdepth", "-mindepth"]);
/** The tests the fake has (a value that does not suit one is a mistake the real find also refuses). */
const OWN_TESTS = new Set([
  "-name",
  "-iname",
  "-path",
  "-type",
  "-size",
  "-mtime",
  "-mmin",
  "-newer",
  "-user",
  "-empty",
]);
/** Tests, actions and options of the real find (GNU findutils manual) that the fake lacks. */
const REAL_ONLY = new Set(
  "-regex -iregex -ipath -wholename -iwholename -atime -ctime -amin -cmin -anewer -cnewer -newerXY -group -nouser -nogroup -uid -gid -perm -links -inum -samefile -lname -ilname -readable -writable -executable -fstype -xtype -used -depth -xdev -mount -follow -daystart -noleaf -regextype -true -false -prune -quit -print0 -printf -fprint -fprint0 -fprintf -fls -ok -okdir -execdir -L -H -P -D -O".split(
    " ",
  ),
);
const FIND_SUPPORTED =
  "-name -iname -path -type -size -mtime -mmin -newer -user -empty, -maxdepth -mindepth, 묶기 ( ) ! -a -o, 동작 -print -ls -delete -exec ... ;";
const FIND_EXAMPLE = "find /etc -name 'host*'";

/** What the real find answers when a test cannot be used, and a gap when the real find has the test. */
function findRefusal(word: string, value: string | undefined, atEnd: boolean): R {
  if (OWN_TESTS.has(word)) {
    if (atEnd && word !== "-empty") return fail(`find: missing argument to \`${word}'`, 1);
    if (word === "-size") return fail(`find: invalid -size type \`${(value ?? "").slice(-1)}'`, 1);
    if (word === "-type") return fail(`find: Unknown argument to -type: ${value}`, 1);
    return fail(`find: invalid argument \`${value}' to \`${word}'`, 1);
  }
  if (REAL_ONLY.has(word))
    return emulationGap({
      tool: "find",
      feature: `test:${word}`,
      what: word,
      supported: FIND_SUPPORTED,
      example: FIND_EXAMPLE,
    });
  return fail(`find: unknown predicate \`${word}'`, 1);
}
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
  const plan = {
    roots,
    maxDepth: Number.POSITIVE_INFINITY,
    minDepth: 0,
    action: "print" as FindPlan["action"],
  };
  let exec: string[] | undefined;
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (NUMERIC_OPTIONS.has(a)) {
      const given = args[i + 1];
      if (given === undefined)
        return { ...plan, test: () => true, refusal: fail(`find: missing argument to \`${a}'`, 1) };
      if (!/^\d+$/.test(given))
        return {
          ...plan,
          test: () => true,
          refusal: fail(
            `find: Expected a positive decimal integer argument to ${a}, but got '${given}'`,
            1,
          ),
        };
      if (a === "-maxdepth") plan.maxDepth = Number(given);
      else plan.minDepth = Number(given);
      i++;
    } else if (ACTIONS[a]) plan.action = ACTIONS[a] as FindPlan["action"];
    else if (a === "-exec") {
      const end = args.findIndex((x, k) => k > i && (x === ";" || x === "+"));
      exec = args.slice(i + 1, end < 0 ? undefined : end);
      plan.action = "exec";
      i = end < 0 ? args.length : end;
    } else words.push(a);
  }
  const parsed = parseExpression(c, words);
  return "refusal" in parsed
    ? { ...plan, test: () => true, refusal: parsed.refusal }
    : { ...plan, test: parsed.test, ...(exec ? { exec } : {}) };
}

type Parsed = { test: FindTest } | { refusal: R };

/** `a -o b -a ! c ( d )`: `-o` is looser than `-a` (or just writing two tests), `!` binds closest. */
function parseExpression(c: Cmd, words: readonly string[]): Parsed {
  let at = 0;
  let refusal: R | undefined;
  const refuse = (r: R): FindTest => {
    refusal ??= r;
    return () => true;
  };
  const or = (): FindTest => {
    let left = and();
    while (words[at] === "-o" || words[at] === "-or") {
      at++;
      const [l, r] = [left, and()];
      left = (p, st, lab) => l(p, st, lab) || r(p, st, lab);
    }
    return left;
  };
  const and = (): FindTest => {
    let left = not();
    while (at < words.length && words[at] !== "-o" && words[at] !== "-or" && words[at] !== ")") {
      if (words[at] === "-a" || words[at] === "-and") at++;
      const [l, r] = [left, not()];
      left = (p, st, lab) => l(p, st, lab) && r(p, st, lab);
    }
    return left;
  };
  const not = (): FindTest => {
    if (words[at] === "!" || words[at] === "-not") {
      at++;
      const inner = not();
      return (p, st, lab) => !inner(p, st, lab);
    }
    return primary();
  };
  const primary = (): FindTest => {
    const w = words[at++];
    if (w === undefined) return refuse(findRefusal(words[at - 2] ?? "", undefined, true));
    if (w === "(") {
      const inner = or();
      if (words[at++] !== ")")
        return refuse(
          fail(
            "find: invalid expression; I was expecting to find a ')' somewhere but did not see one.",
            1,
          ),
        );
      return inner;
    }
    const made = makeTest(c, w, words[at] ?? "", c.h.t);
    if (!made) return refuse(findRefusal(w, words[at], at >= words.length));
    if (!NO_VALUE_TESTS.has(w)) at++;
    return made;
  };
  const test = words.length === 0 ? () => true : or();
  if (refusal === undefined && at < words.length) refusal = strayWord(words, at);
  return refusal === undefined ? { test } : { refusal };
}

/** A word where the real find expects an operator: it is a path after the expression began. */
function strayWord(words: readonly string[], at: number): R {
  const before = words[at - 2];
  const unquoted = before !== undefined && ["-name", "-iname", "-path"].includes(before);
  return fail(
    `find: paths must precede expression: \`${words[at]}'${
      unquoted ? `\nfind: possible unquoted pattern after predicate \`${before}'?` : ""
    }`,
    1,
  );
}

/** Tests that stand alone, with no value after them. */
const NO_VALUE_TESTS: ReadonlySet<string> = new Set(["-empty"]);

function makeTest(c: Cmd, flag: string, v: string, now: number): FindTest | undefined {
  switch (flag) {
    case "-name":
      return (p) => globToRegExp(v).test(baseName(p));
    case "-iname":
      return (p) => new RegExp(globToRegExp(v).source, "i").test(baseName(p));
    case "-path":
      return (_p, _st, lab) => globToRegExp(v).test(lab);
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
  const plan = planFind(c);
  if (plan.refusal) return plan.refusal;
  const out: string[] = [];
  const errs: string[] = [];
  const hit: string[] = [];
  const shownAs = new Map<string, string>();
  for (const root of plan.roots) {
    const path = shown(c, root);
    if (!c.fs.exists(path)) {
      errs.push(`find: '${root}': No such file or directory`);
      continue;
    }
    for (const p of c.fs.walk(path)) {
      const depth = p === path ? 0 : p.slice(path.length).split("/").length - 1;
      const st = c.fs.stat(p);
      const where = label(root, path, p);
      if (!st || depth < plan.minDepth || depth > plan.maxDepth || !plan.test(p, st, where))
        continue;
      hit.push(p);
      shownAs.set(p, where);
      out.push(plan.action === "ls" ? longLine(p, st) : where);
    }
  }
  return finishFind(c, plan, { hit, shownAs }, out, errs);
}

const label = (root: string, path: string, p: string): string =>
  root === path ? p : root + p.slice(path.length);

function finishFind(
  c: Cmd,
  plan: FindPlan,
  found: { hit: string[]; shownAs: Map<string, string> },
  out: string[],
  errs: string[],
): R {
  const { hit } = found;
  const err = errs.length ? `${errs.join("\n")}\n` : "";
  if (plan.action === "delete") return removeAll(c, hit, true, true, err);
  if (plan.action === "exec" && plan.exec) {
    let text = "";
    let e = err;
    let inner: Pick<R, "gap" | "outside"> = {};
    for (const p of hit) {
      const r = c.run(
        plan.exec.map((w) => w.split("{}").join(found.shownAs.get(p) ?? p)),
        "",
      );
      text += r.out;
      e += r.err ?? "";
      if (inner.gap === undefined && r.gap)
        inner = { gap: r.gap, ...(r.outside ? { outside: r.outside } : {}) };
    }
    return { out: text, err: e, code: errs.length ? 1 : 0, ...inner };
  }
  return { out: joinLines(out), err, code: errs.length ? 1 : 0 };
}
