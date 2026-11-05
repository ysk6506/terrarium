/**
 * How a switch CLI reads a line (REQ-062, ADR-0059): words match by unique prefix (`sh int status`), an
 * exact word beats a longer one that merely starts with it, and a line that cannot be read fails the way
 * each OS says it does: where the caret goes and what the message says differ between EOS, NX-OS and IOS XE.
 */
import type { Os } from "./netos-model";

/** A command word: a keyword, or a value (`{ arg }`; `rest` takes the rest of the line). */
export type Word = string | { readonly arg: string; readonly rest?: true };

export interface Token {
  readonly text: string;
  readonly start: number;
}

export type FailKind = "invalid" | "ambiguous" | "incomplete";

export interface Failure {
  readonly kind: FailKind;
  /** Index of the token the problem is at (the token count for an incomplete line). */
  readonly at: number;
}

export interface Matched<T> {
  readonly spec: T;
  /** The values of the command's `arg` words, with the token index each started at. */
  readonly args: readonly string[];
  readonly argAt: readonly number[];
}

export function tokenize(line: string): Token[] {
  return [...line.matchAll(/\S+/g)].map((m) => ({ text: m[0], start: m.index ?? 0 }));
}

interface Candidate<T> {
  readonly spec: T;
  readonly args: string[];
  readonly argAt: number[];
}

const wordAt = (words: readonly Word[], i: number): Word | undefined => {
  if (i < words.length) return words[i];
  const last = words[words.length - 1];
  return typeof last === "object" && last.rest ? last : undefined;
};

function keywordMatches<T extends { words: readonly Word[] }>(
  live: readonly Candidate<T>[],
  i: number,
  token: string,
): Candidate<T>[] | "ambiguous" {
  const starts = live.filter((c) => {
    const w = wordAt(c.spec.words, i);
    return typeof w === "string" && w.startsWith(token);
  });
  const exact = starts.filter((c) => wordAt(c.spec.words, i) === token);
  if (exact.length > 0) return exact;
  return new Set(starts.map((c) => wordAt(c.spec.words, i))).size > 1 ? "ambiguous" : starts;
}

function takeValue<T extends { words: readonly Word[] }>(
  c: Candidate<T>,
  i: number,
  token: Token,
): Candidate<T> {
  const word = wordAt(c.spec.words, i);
  const joinsRest = typeof word === "object" && word.rest && i >= c.spec.words.length;
  if (joinsRest) {
    const args = [...c.args];
    args[args.length - 1] = `${args.at(-1)} ${token.text}`;
    return { ...c, args };
  }
  return { ...c, args: [...c.args, token.text], argAt: [...c.argAt, i] };
}

/** The command a line stands for among `specs` (already limited to what this mode and OS allow). */
export function matchCommand<T extends { words: readonly Word[] }>(
  specs: readonly T[],
  tokens: readonly Token[],
): Matched<T> | Failure {
  let live: Candidate<T>[] = specs.map((spec) => ({ spec, args: [], argAt: [] }));
  for (const [i, token] of tokens.entries()) {
    const text = token.text.toLowerCase();
    const keywords = keywordMatches(live, i, text);
    if (keywords === "ambiguous") return { kind: "ambiguous", at: i };
    if (keywords.length > 0) {
      live = keywords;
      continue;
    }
    const values = live.filter((c) => typeof wordAt(c.spec.words, i) === "object");
    if (values.length === 0) return { kind: "invalid", at: i };
    live = values.map((c) => takeValue(c, i, token));
  }
  // Every token was read; the line is whole when the command has no word left over.
  const pick = live.find((c) => c.spec.words.length <= tokens.length);
  return pick
    ? { spec: pick.spec, args: pick.args, argAt: pick.argAt }
    : { kind: "incomplete", at: tokens.length };
}

export const isFailure = <T>(m: Matched<T> | Failure): m is Failure => "kind" in m;

/** The text a person sees when a line cannot be read, in the OS's own words. */
export function failureText(
  os: Os,
  failure: Failure,
  tokens: readonly Token[],
  prompt: string,
  line: string,
): string {
  const token = tokens[failure.at];
  const caret = `${" ".repeat(prompt.length + (token?.start ?? line.length))}^`;
  if (os === "eos") {
    if (failure.kind === "ambiguous") return "% Ambiguous command";
    if (failure.kind === "incomplete") return "% Incomplete command";
    return `% Invalid input (at token ${failure.at}: '${token?.text ?? ""}')`;
  }
  if (os === "nxos") {
    const what = {
      invalid: "Invalid command",
      ambiguous: "Ambiguous command",
      incomplete: "Incomplete command",
    }[failure.kind];
    return `${caret}\n% ${what} at '^' marker.`;
  }
  if (failure.kind === "ambiguous") return `% Ambiguous command:  "${line}"`;
  if (failure.kind === "incomplete") return "% Incomplete command.";
  return `${caret}\n% Invalid input detected at '^' marker.`;
}

const FILTERS = [
  "include",
  "exclude",
  "begin",
  "section",
  "grep",
  "count",
  "json",
  "no-more",
] as const;
type FilterName = (typeof FILTERS)[number];

export interface Filter {
  readonly name: FilterName;
  readonly pattern: string;
}

/** Splits `show x | include y | count` into the command and its filters. */
export function splitPipes(line: string): { command: string; pipes: string[] } {
  const [command = "", ...pipes] = line.split("|");
  return { command, pipes: pipes.map((p) => p.trim()) };
}

export function parseFilter(os: Os, text: string): Filter | undefined {
  const [word = "", ...rest] = text.split(/\s+/);
  const allowed = FILTERS.filter(
    (f) => !(os === "iosxe" && (f === "grep" || f === "json" || f === "count" || f === "no-more")),
  );
  const hits = allowed.filter((f) => f.startsWith(word.toLowerCase()));
  const name = hits.includes(word.toLowerCase() as FilterName)
    ? (word.toLowerCase() as FilterName)
    : hits[0];
  if (!name || (hits.length > 1 && !hits.includes(name))) return undefined;
  return { name, pattern: rest.join(" ") };
}

function lineTest(pattern: string): ((line: string) => boolean) | undefined {
  const flags = /^-i\s+/.test(pattern) ? "i" : "";
  const invert = /^(-i\s+)?-v\s+/.test(pattern);
  const cleaned = pattern.replace(/^(-[iv]\s+)+/, "");
  try {
    const re = new RegExp(cleaned, flags);
    return (line) => re.test(line) !== invert;
  } catch {
    return undefined;
  }
}

/** Applies a filter to output text; undefined when the pattern is not a valid expression. */
export function applyFilter(filter: Filter, text: string): string | undefined {
  const lines = text.split("\n");
  if (filter.name === "count") return `Total number of lines: ${lines.length}`;
  if (filter.name === "no-more" || filter.name === "json") return text;
  const test = lineTest(filter.pattern);
  if (!test) return undefined;
  if (filter.name === "include" || filter.name === "grep") return lines.filter(test).join("\n");
  if (filter.name === "exclude") return lines.filter((l) => !test(l)).join("\n");
  if (filter.name === "begin") {
    const from = lines.findIndex(test);
    return from < 0 ? "" : lines.slice(from).join("\n");
  }
  return sections(lines, test).join("\n");
}

/** `section`: a matching line and the indented lines under it. */
function sections(lines: readonly string[], test: (line: string) => boolean): string[] {
  const out: string[] = [];
  let open = false;
  for (const line of lines) {
    const indented = /^\s/.test(line);
    if (test(line)) {
      open = true;
      out.push(line);
    } else if (open && indented) out.push(line);
    else open = false;
  }
  return out;
}
