/** `printf` of the fake shell: the format is used again for as many rounds as there are arguments left (ADR-0117). */
import { sprintf } from "./awk-fmt";
import { unescapeText } from "./cmd-text";
import { type Cmd, fail, ok, type R } from "./types";

const SPEC = /%([-+ 0#]*)(\d*)(?:\.(\d+))?([diouxXeEfgGcsb%])/g;

/** The number a shell argument stands for: its leading digits, else 0. */
const numberOf = (v: string): number => {
  const n = Number.parseFloat(v);
  return Number.isNaN(n) ? 0 : n;
};

/** One conversion of the format with one argument; `%c` takes the first character and `%b` reads escapes. */
function one(flags: string, width: string, prec: string | undefined, conv: string, arg: string) {
  const dot = prec === undefined ? "" : `.${prec}`;
  if (conv === "c") return sprintf(`%${flags}${width}s`, [arg.charAt(0)], numberOf, String);
  if (conv === "b")
    return sprintf(`%${flags}${width}${dot}s`, [unescapeText(arg)], numberOf, String);
  return sprintf(`%${flags}${width}${dot}${conv}`, [arg], numberOf, String);
}

/** How many arguments one round of the format takes. */
const takes = (fmt: string): number => [...fmt.matchAll(SPEC)].filter((m) => m[4] !== "%").length;

export function printf(c: Cmd): R {
  const [raw, ...values] = c.args;
  if (raw === undefined) return fail("printf: usage: printf [-v var] format [arguments]", 2);
  const fmt = unescapeText(raw);
  const per = takes(fmt);
  let at = 0;
  let out = "";
  do {
    out += fmt.replace(
      SPEC,
      (_m, flags: string, width: string, prec: string | undefined, conv: string) =>
        conv === "%" ? "%" : one(flags, width, prec, conv, values[at++] ?? ""),
    );
  } while (per > 0 && at < values.length);
  return ok(out);
}
