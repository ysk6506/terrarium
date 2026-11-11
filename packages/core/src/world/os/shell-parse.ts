/**
 * The parser of the fake shell (ADR-0117 decision 4): words with '…', "…" and backslash quoting; pipes; `>` `>>`
 * `<` `2>` `2>>` `2>&1`; and `&&` `||` `;` between pipelines. There are no variables, no `$(...)`, no heredocs,
 * no background jobs; a line that uses one is refused with a one-line comment (exit 2) so it counts as
 * outside the simulation instead of silently doing something else.
 */

export interface Word {
  readonly text: string;
  /** An unquoted `*`, `?` or `[` is in it: it is expanded against the file system. */
  readonly glob: boolean;
}

export interface Redirect {
  readonly kind: "out" | "append" | "in" | "err" | "errAppend" | "errToOut";
  readonly target?: Word;
}

export interface SimpleCmd {
  readonly words: Word[];
  readonly redirs: Redirect[];
}

export type Join = ";" | "&&" | "||";

export interface Step {
  /** How this pipeline is joined to the one before it. */
  readonly join: Join;
  readonly pipeline: SimpleCmd[];
}

export type ParseResult =
  | { readonly ok: true; readonly steps: Step[] }
  | { readonly ok: false; readonly error: string; readonly outside?: string };

type Token =
  | { readonly kind: "word"; readonly word: Word }
  | { readonly kind: "op"; readonly op: string };

class Refused extends Error {
  constructor(
    message: string,
    readonly outside?: string,
  ) {
    super(message);
  }
}

const SINGLE_OPS = new Set([">", "<", "|", ";", "&", "\n"]);
const OPS = ["2>>", "2>&1", "&&", "||", ">>", "2>", "&>", "<<", ">", "<", "|", ";", "&", "\n"];

/** Read the double-quoted part of a word starting after its opening quote; returns the text and where it ended. */
function doubleQuoted(src: string, from: number): { text: string; end: number } {
  let text = "";
  let i = from;
  while (i < src.length && src[i] !== '"') {
    const ch = src.charAt(i);
    if (ch === "$" || ch === "`")
      throw new Refused(`bash: 변수와 명령 치환(${ch})은 이 흉내에서 안 돼요`, `셸 문법 ${ch}`);
    if (ch === "\\" && i + 1 < src.length && '$`"\\'.includes(src.charAt(i + 1))) {
      text += src.charAt(i + 1);
      i += 2;
    } else {
      text += ch;
      i++;
    }
  }
  if (i >= src.length) throw new Refused("bash: unexpected EOF while looking for matching `\"'");
  return { text, end: i + 1 };
}

function singleQuoted(src: string, from: number): { text: string; end: number } {
  const end = src.indexOf("'", from);
  if (end < 0) throw new Refused("bash: unexpected EOF while looking for matching `''");
  return { text: src.slice(from, end), end: end + 1 };
}

const isSpace = (ch: string): boolean => ch === " " || ch === "\t" || ch === "\r";

const REFUSE_EXPANSION = (ch: string): Refused =>
  new Refused(`bash: 변수와 명령 치환(${ch})은 이 흉내에서 안 돼요`, `셸 문법 ${ch}`);

/** The `~` at the start of a word is the home directory. */
const isHomeTilde = (src: string, i: number, from: number): boolean =>
  src.charAt(i) === "~" &&
  i === from &&
  (src[i + 1] === "/" || i + 1 >= src.length || isSpace(src.charAt(i + 1)));

/** One piece of a word at `i`: quoted text, an escaped character, or a plain character. */
function readPiece(
  src: string,
  i: number,
  from: number,
): { text: string; end: number; glob: boolean } {
  const ch = src.charAt(i);
  if (ch === "'" || ch === '"') {
    const q = ch === "'" ? singleQuoted(src, i + 1) : doubleQuoted(src, i + 1);
    return { text: q.text, end: q.end, glob: false };
  }
  if (ch === "\\") return { text: src.charAt(i + 1), end: i + 2, glob: false };
  if (ch === "$" || ch === "`") throw REFUSE_EXPANSION(ch);
  return {
    text: isHomeTilde(src, i, from) ? "/home/ops" : ch,
    end: i + 1,
    glob: ch === "*" || ch === "?" || ch === "[",
  };
}

const endsWord = (ch: string): boolean => isSpace(ch) || (ch.length === 1 && SINGLE_OPS.has(ch));

/** Read one word; `from` points at its first character. */
function readWord(src: string, from: number): { word: Word; end: number } {
  let text = "";
  let glob = false;
  let i = from;
  while (i < src.length && !endsWord(src.charAt(i))) {
    const piece = readPiece(src, i, from);
    text += piece.text;
    glob ||= piece.glob;
    i = piece.end;
  }
  return { word: { text, glob }, end: i };
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (isSpace(ch)) i++;
    else if (ch === "#") break;
    else {
      const op = OPS.find((o) => src.startsWith(o, i));
      if (op) {
        out.push({ kind: "op", op });
        i += op.length;
      } else {
        const r = readWord(src, i);
        out.push({ kind: "word", word: r.word });
        i = r.end;
      }
    }
  }
  return out;
}

const REDIRECT_KIND: Readonly<Record<string, Redirect["kind"]>> = {
  ">": "out",
  ">>": "append",
  "<": "in",
  "2>": "err",
  "2>>": "errAppend",
};

function buildCmd(tokens: Token[]): SimpleCmd {
  const words: Word[] = [];
  const redirs: Redirect[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    if (t.kind === "word") {
      words.push(t.word);
      continue;
    }
    if (t.op === "2>&1") {
      redirs.push({ kind: "errToOut" });
      continue;
    }
    const kind = REDIRECT_KIND[t.op];
    const target = tokens[i + 1];
    if (!kind || target?.kind !== "word")
      throw new Refused(`bash: syntax error near unexpected token \`${t.op}'`);
    redirs.push({ kind, target: target.word });
    i++;
  }
  return { words, redirs };
}

const JOINS = new Set<string>([";", "&&", "||", "\n"]);

/** Collects the pipelines of a line while its tokens go by. */
class Assembler {
  readonly steps: Step[] = [];
  private join: Join = ";";
  private pipeline: SimpleCmd[] = [];
  private current: Token[] = [];

  private syntax(op: string): Refused {
    return new Refused(
      `bash: syntax error near unexpected token \`${op === "\n" ? "newline" : op}'`,
    );
  }

  add(t: Token): void {
    if (t.kind === "op" && t.op === "|") this.endCmd("|");
    else if (t.kind === "op" && JOINS.has(t.op))
      this.endPipeline(t.op, t.op === "\n" ? ";" : (t.op as Join));
    else this.current.push(t);
  }

  private endCmd(op: string): void {
    const cmd = buildCmd(this.current);
    if (cmd.words.length === 0) throw this.syntax(op);
    this.pipeline.push(cmd);
    this.current = [];
  }

  private endPipeline(op: string, next: Join): void {
    if (this.current.length === 0 && this.pipeline.length === 0) {
      // an empty line between commands is fine, an empty command before `;` `&&` `||` is not
      if (op === "\n" && this.steps.length > 0) return;
      throw this.syntax(op);
    }
    this.endCmd(op);
    this.steps.push({ join: this.join, pipeline: this.pipeline });
    this.pipeline = [];
    this.join = next;
  }

  finish(last: Token | undefined): Step[] {
    if (last?.kind === "op" && (last.op === "|" || last.op === "&&" || last.op === "||"))
      throw this.syntax("newline");
    if (this.current.length > 0 || this.pipeline.length > 0) this.endPipeline("newline", ";");
    return this.steps;
  }
}

function assemble(tokens: Token[]): Step[] {
  const a = new Assembler();
  for (const t of tokens) a.add(t);
  return a.finish(tokens.at(-1));
}

const UNSUPPORTED_OPS: Readonly<Record<string, string>> = {
  "&": "백그라운드 실행(&)",
  "<<": "히어독(<<)",
  "&>": "&> 리다이렉트",
};

/** Parse a command line. */
export function parseLine(src: string): ParseResult {
  try {
    const tokens = tokenize(src);
    for (const t of tokens) {
      const what = t.kind === "op" ? UNSUPPORTED_OPS[t.op] : undefined;
      if (what) throw new Refused(`bash: ${what}는 이 흉내에서 안 돼요`, `셸 문법 ${what}`);
    }
    const steps = assemble(tokens);
    const first = steps[0]?.pipeline[0]?.words[0]?.text ?? "";
    if (/^[A-Za-z_]\w*=/.test(first))
      throw new Refused("bash: 변수 지정은 이 흉내에서 안 돼요", "셸 문법 변수");
    return { ok: true, steps };
  } catch (e) {
    if (e instanceof Refused)
      return { ok: false, error: e.message, ...(e.outside ? { outside: e.outside } : {}) };
    throw e;
  }
}

const WRITERS = new Set([
  "rm",
  "truncate",
  "kill",
  "pkill",
  "logrotate",
  "reboot",
  "tee",
  "shutdown",
  "poweroff",
  "touch",
  "cp",
  "mv",
  "mkdir",
  "ln",
]);
const CHANGING_VERBS = new Set([
  "start",
  "stop",
  "restart",
  "reload",
  "try-restart",
  "reload-or-restart",
  "enable",
  "disable",
]);
/** Commands that run another command given in their arguments. */
const WRAPPERS = new Set(["sudo", "nice", "nohup", "time", "env"]);
/** `xargs` options that take a value. */
const XARGS_VALUED = new Set(["-n", "-I", "-L", "-P", "-d", "-s"]);

/** Whether one command (its words) changes the host, looking inside `sudo`, `xargs` and `find -exec`. */
function commandChanges(words: readonly string[]): boolean {
  const [name = "", ...args] = words;
  if (WRITERS.has(name)) return true;
  if (WRAPPERS.has(name)) return commandChanges(afterOptions(args));
  if (name === "systemctl") return args.some((a) => CHANGING_VERBS.has(a));
  if (name === "mount") return args.includes("-o");
  if (name === "sed") return args.some((a) => a === "--in-place" || /^-[a-zA-Z]*i/.test(a));
  if (name === "xargs") return commandChanges(afterXargsOptions(args));
  if (name === "find")
    return (
      args.includes("-delete") ||
      commandChanges(
        args.slice(args.findIndex((a) => a === "-exec" || a === "-execdir") + 1 || args.length),
      )
    );
  return false;
}

/** The command after a wrapper's options (`sudo -n`, `nice -n 5`). */
function afterOptions(args: readonly string[]): string[] {
  let i = 0;
  while (i < args.length && (/^-/.test(args[i] as string) || /^\d+$/.test(args[i] as string))) i++;
  return args.slice(i);
}

function afterXargsOptions(args: readonly string[]): string[] {
  let i = 0;
  while (i < args.length && (args[i] as string).startsWith("-"))
    i += XARGS_VALUED.has(args[i] as string) ? 2 : 1;
  return args.slice(i);
}

/** Whether a line contains a command that changes the host (so the tool counts it as an action, not an observation). */
export function changesWorld(line: string): boolean {
  const r = parseLine(line);
  if (!r.ok) return false;
  return r.steps.some((s) =>
    s.pipeline.some((cmd) => {
      const redirected = cmd.redirs.some(
        (d) => (d.kind === "out" || d.kind === "append") && d.target?.text !== "/dev/null",
      );
      return redirected || commandChanges(cmd.words.map((w) => w.text));
    }),
  );
}
