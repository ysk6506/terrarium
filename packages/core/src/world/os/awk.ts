/** `awk` of the fake shell (ADR-0117 decision 4): a small, real implementation, not a table of canned answers. */
import { parseArgs } from "./args";
import { AwkSyntax } from "./awk-lex";
import { type Program, parseAwk, type Rule } from "./awk-parse";
import { ev, exec, type Flow, Rt, runBlock, StrNum, toNum, truthy } from "./awk-run";
import { errText, readInputs } from "./io";
import type { Cmd } from "./types";
import { fail, linesOf, type R, unsupported } from "./types";

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

function runProgram(rt: Rt, program: Program, texts: readonly string[]): void {
  for (const body of program.begin) if (runBlock(rt, body) === "exit") return;
  const needsInput = program.rules.length > 0 || program.end.length > 0;
  let stopped = false;
  if (needsInput)
    for (const text of texts) {
      for (const line of linesOf(text)) {
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

/** `-v name=value` assignments from the call. */
function presets(args: readonly string[], rt: Rt): void {
  args.forEach((a, i) => {
    const eq = a.indexOf("=");
    if (args[i - 1] === "-v" && eq > 0) rt.vars.set(a.slice(0, eq), new StrNum(a.slice(eq + 1)));
  });
}

function compileProgram(source: string): Program | R {
  try {
    return parseAwk(source);
  } catch (e) {
    if (e instanceof AwkSyntax)
      return {
        out: "",
        err: `awk: ${e.message}`,
        code: 2,
        ...(e.outside ? { outside: e.outside } : {}),
      };
    throw e;
  }
}

export function awk(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "", val: "Fvf", long: { version: "bool" } });
  if (p.bad) return unsupported("awk", p.bad);
  const file = p.flags.get("f");
  const source = file !== undefined ? c.fs.read(file) : p.rest.shift();
  if (source === undefined) return fail("awk: no program given", 2);
  const program = compileProgram(source);
  if ("code" in program) return program;
  const rt = new Rt();
  const fs = p.flags.get("F");
  if (fs !== undefined) rt.vars.set("FS", unescapeFs(fs));
  presets(c.args, rt);
  const { inputs, errors } = readInputs(c, p.rest);
  try {
    runProgram(
      rt,
      program,
      inputs.map((i) => i.text),
    );
  } catch (e) {
    if (e instanceof AwkSyntax) return { out: rt.out, err: `awk: ${e.message}\n`, code: 2 };
    throw e;
  }
  return { out: rt.out, err: errText(errors), code: rt.exitCode ?? (errors.length ? 2 : 0) };
}
