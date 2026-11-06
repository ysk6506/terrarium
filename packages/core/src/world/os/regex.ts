/** POSIX regular expressions (basic and extended) as JavaScript ones, for `grep`, `sed` and `awk`. */

const CLASSES: Readonly<Record<string, string>> = {
  alpha: "a-zA-Z",
  digit: "0-9",
  alnum: "a-zA-Z0-9",
  upper: "A-Z",
  lower: "a-z",
  space: " \\t\\n\\r\\f\\v",
  blank: " \\t",
  punct: "!-\\/:-@\\[-`{-~",
  xdigit: "0-9A-Fa-f",
  word: "\\w",
};

export interface RegexOptions {
  readonly extended: boolean;
  readonly ignoreCase?: boolean;
  readonly global?: boolean;
}

/** Translate a bracket expression starting at `src[from]` (the `[`); returns the JavaScript text and the index after it. */
function bracket(src: string, from: number): { text: string; end: number } | undefined {
  let i = from + 1;
  let body = "";
  if (src[i] === "^") {
    body += "^";
    i++;
  }
  if (src[i] === "]") {
    body += "\\]";
    i++;
  }
  while (i < src.length && src[i] !== "]") {
    if (src[i] === "[" && src[i + 1] === ":") {
      const close = src.indexOf(":]", i + 2);
      const name = close < 0 ? "" : src.slice(i + 2, close);
      const cls = CLASSES[name];
      if (cls) {
        body += cls;
        i = close + 2;
        continue;
      }
    }
    const ch = src.charAt(i);
    body += ch === "\\" || ch === "[" ? `\\${ch}` : ch;
    i++;
  }
  return i < src.length ? { text: `[${body}]`, end: i + 1 } : undefined;
}

/** What a backslash before a character means in POSIX (basic: grouping and repetition; both: word edges). */
function escaped(ch: string, extended: boolean): string {
  if (ch === "<" || ch === ">") return "\\b";
  if (!extended && "(){}|+?".includes(ch)) return ch;
  return `\\${ch}`;
}

/** A plain character, written so JavaScript reads it literally; extended operators stay operators. */
function plain(ch: string, extended: boolean): string {
  if ("(){}|+?".includes(ch)) return extended ? ch : `\\${ch}`;
  return ch === "/" ? "\\/" : ch;
}

/** Translate a POSIX pattern to JavaScript source. */
export function translate(src: string, extended: boolean): string {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i);
    if (ch === "[") {
      const b = bracket(src, i);
      if (b) {
        out += b.text;
        i = b.end - 1;
      } else out += "\\[";
    } else if (ch === "\\") {
      out += i + 1 < src.length ? escaped(src.charAt(++i), extended) : "\\\\";
    } else out += plain(ch, extended);
  }
  return out;
}

/** Build the regular expression; throws an Error with grep's wording when the pattern is not valid. */
export function posixRegExp(src: string, o: RegexOptions): RegExp {
  try {
    return new RegExp(
      translate(src, o.extended),
      `${o.ignoreCase ? "i" : ""}${o.global ? "g" : ""}`,
    );
  } catch {
    throw new Error("Invalid regular expression");
  }
}

export const escapeLiteral = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
