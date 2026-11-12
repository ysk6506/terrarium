/** `journalctl` and `dmesg` of the fake shell (ADR-0117 decision 3): the host's one event list, filtered and printed. */
import { has, parseArgs } from "./args";
import { dmesgText, formatJournal, type JournalOptions, journalLines, PRIORITY } from "./journal";
import { badFlag } from "./real-options";
import { posixRegExp } from "./regex";
import { looksLikeTime, parseTimeSpec, TIME_FORMS } from "./timespec";
import { type Cmd, emulationGap, fail, joinLines, ok, type R, softGap } from "./types";

const FLAGS = {
  bool: "kbrfxeaN",
  val: "unpSUgo",
  long: {
    "no-pager": "bool",
    "no-hostname": "bool",
    since: "val",
    until: "val",
    unit: "val",
    priority: "val",
    lines: "val",
    boot: "val",
    reverse: "bool",
    follow: "bool",
    grep: "val",
    output: "val",
    kernel: "bool",
    "case-sensitive": "val",
    "disk-usage": "bool",
    "user-unit": "val",
    "list-boots": "bool",
    utc: "bool",
    "show-cursor": "bool",
  },
} as const;

function priorityOf(spec: string | undefined): number | undefined {
  if (spec === undefined) return undefined;
  const top = (spec.split("..").pop() ?? spec).toLowerCase();
  return /^\d$/.test(top) ? Number(top) : PRIORITY[top];
}

const UNIT_FLAG = /^--unit=(.*)$/;

/** Every `-u unit` and `--unit=unit`, without `.service`. */
function unitsOf(args: readonly string[]): string[] {
  const units: string[] = [];
  args.forEach((a, i) => {
    const long = UNIT_FLAG.exec(a)?.[1];
    if (a === "-u" || a === "--unit") units.push(args[i + 1] ?? "");
    else if (long !== undefined) units.push(long);
  });
  return units.map((u) => u.replace(/\.service$/, ""));
}

const flagOf = (p: ReturnType<typeof parseArgs>, short: string, long: string): string | undefined =>
  p.flags.get(short) ?? p.flags.get(long);

/** `--since` and `--until` as world times, or the error to print. */
function windowOf(c: Cmd, p: ReturnType<typeof parseArgs>): { since?: number; until?: number } | R {
  const out: { since?: number; until?: number } = {};
  for (const [key, short, long] of [
    ["since", "S", "--since"],
    ["until", "U", "--until"],
  ] as const) {
    const text = flagOf(p, short, long);
    if (text === undefined) continue;
    const t = parseTimeSpec(text, c.h.t);
    if (t === undefined && looksLikeTime(text))
      return emulationGap({
        tool: "journalctl",
        feature: "time-format",
        what: `${long} ${text}`,
        supported: TIME_FORMS,
        example: "journalctl --since '1 hour ago' -n 5",
      });
    if (t === undefined) return fail(`Failed to parse timestamp: ${text}`, 1);
    out[key] = t;
  }
  return out;
}

function grepOf(p: ReturnType<typeof parseArgs>): RegExp | undefined {
  const src = flagOf(p, "g", "--grep");
  return src
    ? posixRegExp(src, { extended: true, ignoreCase: src === src.toLowerCase() })
    : undefined;
}

/** The yes/no switches of a `journalctl` call. */
function switchesOf(
  p: ReturnType<typeof parseArgs>,
): Pick<JournalOptions, "kernel" | "boot" | "reverse" | "cat"> {
  return {
    ...(has(p, "k") || has(p, "--kernel") ? { kernel: true } : {}),
    ...(has(p, "b") || has(p, "--boot") ? { boot: bootArg(p.flags.get("--boot")) } : {}),
    ...(has(p, "r") || has(p, "--reverse") ? { reverse: true } : {}),
    ...(flagOf(p, "o", "--output") === "cat" ? { cat: true } : {}),
  };
}

/** `-n`, as a count; the error to print when it is not one. */
function countOf(p: ReturnType<typeof parseArgs>): number | undefined | R {
  const n = flagOf(p, "n", "--lines");
  if (n === undefined) return undefined;
  return Number.isInteger(Number(n)) ? Number(n) : fail(`Failed to parse lines '${n}'`, 1);
}

/** `-p`, as a priority; the error to print when it is not one. */
function levelOf(p: ReturnType<typeof parseArgs>): number | undefined | R {
  const level = flagOf(p, "p", "--priority");
  if (level === undefined) return undefined;
  return priorityOf(level) ?? fail(`Unknown log level ${level}`, 1);
}

const isFailure = (v: unknown): v is R => typeof v === "object" && v !== null && "code" in v;

/** The options of a `journalctl` call, or the error to print. */
function optionsOf(c: Cmd, p: ReturnType<typeof parseArgs>): JournalOptions | R {
  const count = countOf(p);
  if (isFailure(count)) return count;
  const win = windowOf(c, p);
  if (isFailure(win)) return win;
  const prio = levelOf(p);
  if (isFailure(prio)) return prio;
  const units = unitsOf(c.args);
  const grep = grepOf(p);
  return {
    ...(units.length ? { units } : {}),
    ...(count !== undefined ? { n: count } : {}),
    ...win,
    ...(prio !== undefined ? { priority: prio } : {}),
    ...(grep ? { grep } : {}),
    ...switchesOf(p),
  };
}

export function journalctl(c: Cmd): R {
  const p = parseArgs(normalizeBoot(c.args), FLAGS);
  if (p.bad) return badFlag("journalctl", p);
  if (has(p, "--disk-usage"))
    return ok("Archived and active journals take up 128.0M in the file system.\n");
  if (has(p, "--list-boots"))
    return ok(
      `-1 4a1c0f0e2b7d4c1e9d0a3b5c6e7f8091 ${c.h.name}\n 0 9b2d1e3f4a5b4c6d8e9f0a1b2c3d4e5f ${c.h.name}\n`,
    );
  const opts = optionsOf(c, p);
  if (isFailure(opts)) return opts;
  const follow = has(p, "f") || has(p, "--follow");
  const lines = journalLines(c.h, follow ? { ...opts, n: opts.n ?? 10 } : opts);
  const text = lines.length
    ? joinLines(lines.map((l) => formatJournal(c.h, l, opts.cat)))
    : "-- No entries --\n";
  return follow
    ? softGap(ok(text), {
        tool: "journalctl",
        feature: "flag:--follow",
        what: "-f",
        supported:
          "-u 유닛, -n N, -p 우선순위, --since --until, -k, -b, -g 패턴, -o cat, -r, --no-pager",
        example: "journalctl -n 5",
      })
    : ok(text);
}

/** `-b -1` and `-b 0` as `--boot=-1`, since the number is not a flag. */
function normalizeBoot(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    const next = args[i + 1];
    if (a === "-b" && next !== undefined && /^-?\d+$/.test(next)) {
      out.push(`--boot=${next}`);
      i++;
    } else out.push(a);
  }
  return out;
}

const bootArg = (v: string | undefined): number => (v !== undefined && Number(v) < 0 ? -1 : 0);

export function dmesg(c: Cmd): R {
  const p = parseArgs(c.args, {
    bool: "THwcxk",
    val: "l",
    long: { level: "val", ctime: "bool", human: "bool" },
  });
  if (p.bad) return badFlag("dmesg", p);
  if (has(p, "w"))
    return emulationGap({
      tool: "dmesg",
      feature: "flag:--follow",
      what: "-w",
      supported: "-T -H -c -x -k, -l 수준",
      example: "dmesg",
    });
  const level = priorityOf(p.flags.get("l") ?? p.flags.get("--level"));
  const text = dmesgText(c.h, {
    human: has(p, "T") || has(p, "--ctime"),
    ...(level !== undefined ? { priority: level } : {}),
  });
  return ok(text === "" ? "" : `${text}\n`);
}
