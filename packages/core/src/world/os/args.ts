/** A small option parser shared by the commands: short flags (combined or with values), long flags, `--`. */

export interface FlagSpec {
  /** Short flags without a value, e.g. "ivc". */
  readonly bool?: string;
  /** Short flags that take a value, e.g. "nk". */
  readonly val?: string;
  /** Long flags: name to "bool" or "val". */
  readonly long?: Readonly<Record<string, "bool" | "val">>;
  /** Accept `-5` as `-n 5` (head, tail). */
  readonly digits?: boolean;
}

export interface Parsed {
  /** The spec the call was parsed with (a refusal lists what it has). */
  readonly spec: FlagSpec;
  readonly flags: Map<string, string>;
  readonly rest: string[];
  /** The first flag the spec does not know, as typed. */
  readonly bad?: string;
}

const NUMBER = /^-\d+$/;

function longFlag(
  arg: string,
  spec: FlagSpec,
  flags: Map<string, string>,
  next: () => string | undefined,
): string | undefined {
  const eq = arg.indexOf("=");
  const name = arg.slice(2, eq < 0 ? undefined : eq);
  const kind = spec.long?.[name];
  if (!kind) return arg;
  flags.set(`--${name}`, kind === "val" ? (eq < 0 ? (next() ?? "") : arg.slice(eq + 1)) : "");
  return undefined;
}

function shortFlags(
  arg: string,
  spec: FlagSpec,
  flags: Map<string, string>,
  next: () => string | undefined,
): string | undefined {
  for (let i = 1; i < arg.length; i++) {
    const ch = arg.charAt(i);
    if (spec.val?.includes(ch)) {
      const inline = arg.slice(i + 1);
      flags.set(ch, inline !== "" ? inline : (next() ?? ""));
      return undefined;
    }
    if (!spec.bool?.includes(ch)) return `-${ch}`;
    flags.set(ch, "");
  }
  return undefined;
}

/** Split `args` into flags and the rest. */
export function parseArgs(args: readonly string[], spec: FlagSpec): Parsed {
  const flags = new Map<string, string>();
  const rest: string[] = [];
  let bad: string | undefined;
  let i = 0;
  const next = (): string | undefined => args[++i];
  for (; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--") {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (spec.digits && NUMBER.test(arg)) flags.set("n", arg.slice(1));
    else if (arg.startsWith("--")) bad ??= longFlag(arg, spec, flags, next);
    else if (arg.length > 1 && arg.startsWith("-")) bad ??= shortFlags(arg, spec, flags, next);
    else rest.push(arg);
  }
  return { spec, flags, rest, ...(bad ? { bad } : {}) };
}

export const has = (p: Parsed, flag: string): boolean => p.flags.has(flag);
/** Whether any of the spellings of an option (`s`, `--symbolic`) was given. */
export const hasAny = (p: Parsed, ...flags: string[]): boolean => flags.some((f) => p.flags.has(f));

/** A flag's value as a non-negative integer; `def` when absent, NaN when it is not one. */
export function intOf(p: Parsed, flag: string, def: number): number {
  const v = p.flags.get(flag);
  if (v === undefined) return def;
  return /^\d+$/.test(v) ? Number(v) : Number.NaN;
}

/**
 * Every value of an option that may be given more than once (`-e a -e b`, `-ea`, `-ne a`, `--expression=a`), in
 * order. `parseArgs` keeps only the last one; the spec is the one the call was parsed with.
 */
export function allValues(
  args: readonly string[],
  spec: FlagSpec,
  short: string,
  long?: string,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--") break;
    const got = arg.startsWith("--")
      ? longValue(args, i, spec, long)
      : arg.length > 1 && arg.startsWith("-")
        ? shortValue(args, i, spec, short)
        : undefined;
    if (!got) continue;
    i += got.used;
    if (got.value !== undefined) out.push(got.value);
  }
  return out;
}

type Taken = { value: string | undefined; used: number };

/** `--name=value` or `--name value`: the value when it is the wanted option, and how many extra arguments it used. */
function longValue(
  args: readonly string[],
  i: number,
  spec: FlagSpec,
  long?: string,
): Taken | undefined {
  const arg = args[i] as string;
  const eq = arg.indexOf("=");
  const name = arg.slice(2, eq < 0 ? undefined : eq);
  if (spec.long?.[name] !== "val") return undefined;
  const value = eq < 0 ? (args[i + 1] ?? "") : arg.slice(eq + 1);
  return { value: name === long ? value : undefined, used: eq < 0 ? 1 : 0 };
}

/** `-x value` or `-xvalue` (also inside a bundle like `-ne`): the value when it is the wanted option. */
function shortValue(
  args: readonly string[],
  i: number,
  spec: FlagSpec,
  short: string,
): Taken | undefined {
  const arg = args[i] as string;
  for (let k = 1; k < arg.length; k++) {
    const ch = arg.charAt(k);
    if (!spec.val?.includes(ch)) continue;
    const inline = arg.slice(k + 1);
    const value = inline !== "" ? inline : (args[i + 1] ?? "");
    return { value: ch === short ? value : undefined, used: inline !== "" ? 0 : 1 };
  }
  return undefined;
}
