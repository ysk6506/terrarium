/**
 * `sort` of the fake shell (ADR-0117 decision 4): keys (`-k F[,F]` with `n r f h b V`, as many as given), `-t`, `-u`,
 * `-s`, `-c` and `-o`. Order is by byte (the C locale); a host with `LANG=en_US.UTF-8` would order letters and
 * punctuation by its locale, which this fake does not do (see "정직한 한계").
 */
import { allValues, has, hasAny, parseArgs } from "./args";
import { normalize } from "./fs";
import { errText, readInputs } from "./io";
import { act, type Cmd, fail, joinLines, linesOf, ok, type R, unsupported } from "./types";

const SORT_FLAGS = {
  bool: "nrufhbcsV",
  val: "ktoT",
  long: {
    reverse: "bool",
    unique: "bool",
    "numeric-sort": "bool",
    "ignore-case": "bool",
    "human-numeric-sort": "bool",
    "version-sort": "bool",
    stable: "bool",
    check: "bool",
    "ignore-leading-blanks": "bool",
    key: "val",
    "field-separator": "val",
    output: "val",
  },
} as const;

type Flags = ReturnType<typeof parseArgs>;

/** How one key is compared. */
interface Key {
  /** First and last field (1-based); 0 for the whole line; `to` 0 for "to the end of the line". */
  readonly from: number;
  readonly to: number;
  readonly numeric: boolean;
  readonly human: boolean;
  readonly version: boolean;
  readonly fold: boolean;
  readonly blanks: boolean;
  readonly reverse: boolean;
}

const LONG_OF: Readonly<Record<string, string>> = {
  n: "numeric-sort",
  r: "reverse",
  f: "ignore-case",
  h: "human-numeric-sort",
  V: "version-sort",
  b: "ignore-leading-blanks",
};
const on = (p: Flags, f: string): boolean => has(p, f) || has(p, `--${LONG_OF[f] ?? f}`);

/** The ordering letters of a global option set, or of a key's own `nrfhbV` suffix when it has one. */
function ordering(letters: (f: string) => boolean): Omit<Key, "from" | "to"> {
  return {
    numeric: letters("n"),
    human: letters("h"),
    version: letters("V"),
    fold: letters("f"),
    blanks: letters("b"),
    reverse: letters("r"),
  };
}

/** `-k 2,3nr` as a key; a character position inside a field (`2.3`) is not simulated. */
function keyOf(spec: string, p: Flags): Key | string {
  const m = /^(\d+)(?:,(\d+))?([bfhnrV]*)$/.exec(spec);
  if (!m) return spec;
  const own = m[3] ?? "";
  return {
    from: Number(m[1]),
    to: Number(m[2] ?? 0),
    ...ordering(own === "" ? (f) => on(p, f) : (f) => own.includes(f)),
  };
}

const wholeLine = (p: Flags): Key => ({ from: 0, to: 0, ...ordering((f) => on(p, f)) });

/** The text of a key in a line: the fields it spans, as they stand in the line. */
function text(line: string, k: Key, sep: string | undefined): string {
  if (k.from === 0) return line;
  if (sep !== undefined) {
    const parts = line.split(sep);
    return parts.slice(k.from - 1, k.to === 0 ? undefined : k.to).join(sep);
  }
  const words = [...line.matchAll(/\S+/g)];
  const first = words[k.from - 1];
  if (!first) return "";
  const last = k.to === 0 ? undefined : words[k.to - 1];
  return line.slice(first.index, last ? (last.index ?? 0) + last[0].length : undefined);
}

const leadingNumber = (s: string): number => {
  const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]) : 0;
};

const HUMAN: Readonly<Record<string, number>> = {
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4,
};
const humanNumber = (s: string): number => {
  const m = /^\s*(\d+(?:\.\d+)?)([KMGT]?)/.exec(s);
  return m ? Number(m[1]) * (HUMAN[m[2] ?? ""] ?? 1) : 0;
};

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `1.9` before `1.10`: runs of digits count as numbers, the rest as text. */
function versionOrder(a: string, b: string): number {
  const x = a.match(/\d+|\D+/g) ?? [];
  const y = b.match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const [u, v] = [x[i] as string, y[i] as string];
    const r = /^\d/.test(u) && /^\d/.test(v) ? Number(u) - Number(v) : order(u, v);
    if (r !== 0) return r;
  }
  return x.length - y.length;
}

function keyOrder(a: string, b: string, k: Key, sep: string | undefined): number {
  let [x, y] = [text(a, k, sep), text(b, k, sep)];
  if (k.blanks) [x, y] = [x.trimStart(), y.trimStart()];
  if (k.fold) [x, y] = [x.toLowerCase(), y.toLowerCase()];
  let r: number;
  if (k.human) r = humanNumber(x) - humanNumber(y);
  else if (k.numeric) r = leadingNumber(x) - leadingNumber(y);
  else r = k.version ? versionOrder(x, y) : order(x, y);
  return k.reverse ? -r : r;
}

/** The order of two lines by the keys alone. */
function byKeys(keys: readonly Key[], sep: string | undefined): (a: string, b: string) => number {
  return (a, b) => {
    for (const k of keys) {
      const r = keyOrder(a, b, k, sep);
      if (r !== 0) return r;
    }
    return 0;
  };
}

/** `-c`: the first line that is out of order, as sort says it. */
function disorder(
  rows: readonly string[],
  name: string,
  same: (a: string, b: string) => number,
  unique: boolean,
): R | undefined {
  for (let i = 1; i < rows.length; i++) {
    const r = same(rows[i - 1] as string, rows[i] as string);
    if (r > 0 || (unique && r === 0))
      return fail(`sort: ${name}:${i + 1}: disorder: ${rows[i]}`, 1);
  }
  return undefined;
}

/** The comparison `sort` orders by: the keys, then (unless -s) the whole line as a last resort. */
function comparison(p: ReturnType<typeof parseArgs>, byKey: (a: string, b: string) => number) {
  const lastResort = hasAny(p, "s", "--stable") ? 0 : 1;
  const direction = on(p, "r") ? -1 : 1;
  return (a: string, b: string): number => byKey(a, b) || lastResort * order(a, b) * direction;
}

/** `-o FILE`: write the result there (through the world) instead of printing it. */
function writeOutput(c: Cmd, target: string, text: string, errors: readonly string[]): R {
  const path = normalize(c.cwd, target);
  const denied = c.fs.denyWrite(path);
  const code = errors.length ? 2 : 0;
  if (denied)
    return fail(
      `sort: open failed: ${target}: ${denied === "ro" ? "Read-only file system" : "Permission denied"}`,
      2,
    );
  act(c, "write", path, text);
  return { out: "", err: errText(errors), code };
}

/** The keys of the call (`-k`, or the whole line), or the refusal for one that cannot be done. */
function keysOf(args: readonly string[], p: ReturnType<typeof parseArgs>): Key[] | R {
  const specs = allValues(args, SORT_FLAGS, "k", "key").map((s) => keyOf(s, p));
  const bad = specs.find((k): k is string => typeof k === "string");
  if (bad !== undefined) return unsupported("sort", `-k ${bad} (글자 위치는 안 돼요)`);
  return specs.length ? (specs as Key[]) : [wholeLine(p)];
}

export function sort(c: Cmd): R {
  const p = parseArgs(c.args, SORT_FLAGS);
  if (p.bad) return unsupported("sort", p.bad);
  const keys = keysOf(c.args, p);
  if (!Array.isArray(keys)) return keys;
  const byKey = byKeys(keys, p.flags.get("t") ?? p.flags.get("--field-separator"));
  const cmp = comparison(p, byKey);
  const { inputs, errors } = readInputs(c, p.rest);
  const rows = linesOf(inputs.map((i) => i.text).join(""));
  const unique = hasAny(p, "u", "--unique");
  if (hasAny(p, "c", "--check"))
    return disorder(rows, inputs[0]?.name ?? "-", unique ? byKey : cmp, unique) ?? ok("");
  rows.sort(cmp);
  const kept = unique
    ? rows.filter((l, i) => i === 0 || byKey(l, rows[i - 1] as string) !== 0)
    : rows;
  const target = p.flags.get("o") ?? p.flags.get("--output");
  if (target !== undefined) return writeOutput(c, target, joinLines(kept), errors);
  return { ...ok(joinLines(kept)), err: errText(errors), code: errors.length ? 2 : 0 };
}
