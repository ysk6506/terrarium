/** `awk` of the fake shell (ADR-0117 decision 4): a small, real implementation, not a table of canned answers. */
import { allValues, has, parseArgs } from "./args";
import { AwkSyntax } from "./awk-lex";
import { type Program, parseAwk, type Rule } from "./awk-parse";
import { ev, exec, type Flow, Rt, runBlock, StrNum, toNum, toStr, truthy } from "./awk-run";
import { errText, readInputs } from "./io";
import { badFlag } from "./real-options";
import { posixRegExp } from "./regex";
import type { Cmd } from "./types";
import { emulationGap, fail, linesOf, type R } from "./types";

function ruleMatches(rt: Rt, rule: Rule, index: number): boolean {
  if (rule.range) {
    const active = rt.ranges.get(index) ?? false;
    if (!active) {
      if (!truthy(ev(rt, rule.range[0]))) return false;
      rt.ranges.set(index, !truthy(ev(rt, rule.range[1])));
      return true;
    }
    if (truthy(ev(rt, rule.range[1]))) rt.ranges.set(index, false);
    return true;
  }
  return rule.pattern === undefined || truthy(ev(rt, rule.pattern));
}

function runRecord(rt: Rt, program: Program): Flow {
  const nr = toNum(rt.get("NR")) + 1;
  rt.vars.set("NR", nr);
  for (const [i, rule] of program.rules.entries()) {
    if (!ruleMatches(rt, rule, i)) continue;
    const flow = rule.action ? runBlock(rt, rule.action) : exec(rt, { t: "print", args: [] });
    if (flow === "next") return undefined;
    if (flow === "exit") return "exit";
  }
  return undefined;
}

/** The records of an input under `RS`: lines, paragraphs (`RS = ""`), or what lies between a character or a regular expression. */
function recordsOf(text: string, rs: string): string[] {
  if (rs === "\n") return linesOf(text);
  if (rs === "")
    return text
      .split(/\n{2,}/)
      .map((r) => r.replace(/^\n+|\n+$/g, ""))
      .filter((r) => r !== "");
  const parts = text.split(rs.length === 1 ? rs : posixRegExp(rs, { extended: true }));
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

function runProgram(rt: Rt, program: Program, texts: readonly string[]): void {
  // `exit` in BEGIN skips the input but not the END rules
  let stopped = program.begin.some((body) => runBlock(rt, body) === "exit");
  const needsInput = program.rules.length > 0 || program.end.length > 0;
  if (needsInput && !stopped)
    for (const text of texts) {
      for (const line of recordsOf(text, toStr(rt.get("RS")))) {
        rt.setRecord(line);
        if (runRecord(rt, program) === "exit") {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
    }
  for (const body of program.end) if (runBlock(rt, body) === "exit") return;
}

function unescapeFs(fs: string): string {
  if (fs === "t") return "\t";
  return fs.replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
}

const ASSIGNMENT = /^([A-Za-z_]\w*)=(.*)$/s;
const AWK_FLAGS = { bool: "", val: "Fvf", long: { version: "bool", assign: "val" } } as const;

/** The escapes awk reads in a value given on the command line: `\\n`, `\\t` and `\\\\`. */
const escapes = (v: string): string =>
  v.replace(/\\([nt\\])/g, (_x, ch: string) => (ch === "n" ? "\n" : ch === "t" ? "\t" : "\\"));

/** `-v name=value` (also `-vname=value`, `--assign`) and `name=value` operands: the assignments of a call, in order. */
function assignments(args: readonly string[], operands: readonly string[]): [string, string][] {
  return [
    ...allValues(args, AWK_FLAGS, "v", "assign"),
    ...operands.filter((o) => ASSIGNMENT.test(o)),
  ]
    .map((a) => ASSIGNMENT.exec(a))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1] as string, escapes(m[2] as string)]);
}

export const AWK_SUPPORTED =
  "-F 구분자, -v 변수=값, -f 프로그램파일; 패턴 { 동작 } 규칙과 BEGIN/END, 변수·배열·정규식, if/while/do/for/delete/next/exit, print/printf, 내장 함수 length substr index split sub gsub match sprintf tolower toupper int sqrt exp log sin cos atan2 rand srand";
export const AWK_EXAMPLES: Readonly<Record<string, string>> = {
  "redirect-output": "awk '{print $1}' /etc/hosts > /tmp/awk-out.txt",
  system: "echo hi | awk '{print toupper($0)}'",
  function: "awk 'BEGIN{x=3; print x*x}'",
};
export const AWK_EXAMPLE = "awk 'NR==2{print $1}' /etc/hosts";

/** What awk says about a program it cannot run: its own words for a mistake, the gap's lines for a feature it lacks. */
function awkRefusal(e: AwkSyntax): R {
  if (!e.gap) return { out: "", err: `awk: ${e.message}\n`, code: 2 };
  return emulationGap({
    tool: "awk",
    feature: e.gap.feature,
    what: e.gap.what,
    supported: AWK_SUPPORTED,
    example: AWK_EXAMPLES[e.gap.feature] ?? AWK_EXAMPLE,
  });
}

function compileProgram(source: string): Program | R {
  try {
    return parseAwk(source);
  } catch (e) {
    if (e instanceof AwkSyntax) return awkRefusal(e);
    throw e;
  }
}

/** The runtime with -F and the `var=value` operands set before the program starts. */
function startRt(c: Cmd, p: ReturnType<typeof parseArgs>): Rt {
  const rt = new Rt();
  const fs = p.flags.get("F");
  if (fs !== undefined) rt.vars.set("FS", unescapeFs(fs));
  for (const [name, value] of assignments(c.args, p.rest)) rt.vars.set(name, new StrNum(value));
  return rt;
}

export function awk(c: Cmd): R {
  const p = parseArgs(c.args, AWK_FLAGS);
  if (p.bad) return badFlag("awk", p, AWK_SUPPORTED);
  if (has(p, "--version"))
    return emulationGap({
      tool: "awk",
      feature: "flag:--version",
      what: "--version",
      supported: AWK_SUPPORTED,
      example: AWK_EXAMPLE,
    });
  const file = p.flags.get("f");
  const source = file !== undefined ? c.fs.read(file) : p.rest.shift();
  if (file !== undefined && source === undefined) return fail(`awk: couldn't open file ${file}`, 2);
  if (source === undefined) return fail("awk: no program given", 2);
  const program = compileProgram(source);
  if ("code" in program) return program;
  const rt = startRt(c, p);
  const { inputs, errors } = readInputs(
    c,
    p.rest.filter((o) => !ASSIGNMENT.test(o)),
  );
  try {
    runProgram(
      rt,
      program,
      inputs.map((i) => i.text),
    );
  } catch (e) {
    if (e instanceof AwkSyntax) return { ...awkRefusal(e), out: rt.out };
    throw e;
  }
  return { out: rt.out, err: errText(errors), code: rt.exitCode ?? (errors.length ? 2 : 0) };
}
