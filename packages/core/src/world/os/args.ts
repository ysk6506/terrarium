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
  return { flags, rest, ...(bad ? { bad } : {}) };
}

export const has = (p: Parsed, flag: string): boolean => p.flags.has(flag);

/** A flag's value as a non-negative integer; `def` when absent, NaN when it is not one. */
export function intOf(p: Parsed, flag: string, def: number): number {
  const v = p.flags.get(flag);
  if (v === undefined) return def;
  return /^\d+$/.test(v) ? Number(v) : Number.NaN;
}
