/** Names of awk that this one lacks (ADR-0184): the real awk runs them, so reaching one is an emulation gap. */
import { AwkSyntax } from "./awk-lex";

/** Keywords and builtins that parse as a call or a statement but are not implemented. */
export const UNSUPPORTED_NAMES = new Set([
  "getline",
  "system",
  "close",
  "function",
  "func",
  "fflush",
  "nextfile",
]);

/** Functions of GNU awk (and POSIX awk) that this one does not have; awk itself would run them. */
const REAL_FUNCTIONS = new Set([
  "gensub",
  "strftime",
  "systime",
  "mktime",
  "asort",
  "asorti",
  "strtonum",
  "and",
  "or",
  "xor",
  "compl",
  "lshift",
  "rshift",
  "patsplit",
  "isarray",
  "typeof",
]);

/** A keyword or builtin of awk that this one lacks: the real awk runs it, so it is a gap. */
export function missing(name: string): AwkSyntax {
  const feature = name === "func" ? "function" : name;
  return new AwkSyntax(name, { feature, what: feature });
}

/** A call to a name that is no function: awk says so; if GNU awk has the function, this one lacks it. */
export function undefinedFunction(name: string): AwkSyntax {
  return REAL_FUNCTIONS.has(name)
    ? new AwkSyntax(name, { feature: `function:${name}`, what: `${name}()` })
    : new AwkSyntax(`function ${name} never defined`);
}
