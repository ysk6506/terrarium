/** The tokens of the small `awk` (ADR-0117): numbers, strings, regular expressions, names and punctuation. */

export type Tok =
  | { readonly k: "num"; readonly v: number }
  | { readonly k: "str"; readonly v: string }
  | { readonly k: "re"; readonly v: string }
  | { readonly k: "name"; readonly v: string }
  | { readonly k: "p"; readonly v: string }
  | { readonly k: "nl" };

export class AwkSyntax extends Error {
  constructor(
    message: string,
    readonly outside?: string,
  ) {
    super(message);
  }
}

const PUNCT = [
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "^=",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "++",
  "--",
  "!~",
  ">>",
  "+",
  "-",
  "*",
  "/",
  "%",
  "^",
  "<",
  ">",
  "=",
  "!",
  "~",
  "?",
  ":",
  ",",
  ";",
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
  "$",
];

const ESC: Readonly<Record<string, string>> = {
  n: "\n",
  t: "\t",
  "\\": "\\",
  '"': '"',
  "/": "/",
  r: "\r",
};

function readString(src: string, from: number): { v: string; end: number } {
  let v = "";
  let i = from + 1;
  while (i < src.length && src[i] !== '"') {
    const hex = /^\\x([0-9a-fA-F]{1,2})/.exec(src.slice(i, i + 4));
    if (hex) {
      v += String.fromCharCode(Number.parseInt(hex[1] as string, 16));
      i += hex[0].length;
    } else if (src[i] === "\\" && i + 1 < src.length) {
      v += ESC[src.charAt(i + 1)] ?? `\\${src.charAt(i + 1)}`;
      i += 2;
    } else v += src.charAt(i++);
  }
  if (i >= src.length) throw new AwkSyntax("non-terminated string");
  return { v, end: i + 1 };
}

function readRegex(src: string, from: number): { v: string; end: number } {
  let v = "";
  let i = from + 1;
  while (i < src.length && src[i] !== "/") {
    if (src[i] === "\\" && src[i + 1] === "/") {
      v += "/";
      i += 2;
    } else {
      if (src[i] === "\\" && i + 1 < src.length) v += src.charAt(i++);
      v += src.charAt(i++);
    }
  }
  if (i >= src.length) throw new AwkSyntax("non-terminated regular expression");
  return { v, end: i + 1 };
}

/** Whether a `/` after this token starts a regular expression and not a division. */
function startsOperand(prev: Tok | undefined): boolean {
  if (!prev) return true;
  if (prev.k === "num" || prev.k === "str" || prev.k === "re") return false;
  if (prev.k === "name") return false;
  return prev.k === "nl" || !(prev.v === ")" || prev.v === "]" || prev.v === "$");
}

/** Read one token at `i`: where it ends, and the token (none for white space and comments). */
function readToken(src: string, i: number, prev: Tok | undefined): { end: number; tok?: Tok } {
  const ch = src.charAt(i);
  if (ch === "\n") return { end: i + 1, tok: { k: "nl" } };
  if (ch === " " || ch === "\t" || ch === "\r") return { end: i + 1 };
  if (ch === "#") return { end: src.indexOf("\n", i) < 0 ? src.length : src.indexOf("\n", i) };
  if (ch === "\\" && src[i + 1] === "\n") return { end: i + 2 };
  if (ch === '"') {
    const s = readString(src, i);
    return { end: s.end, tok: { k: "str", v: s.v } };
  }
  if (ch === "/" && startsOperand(prev)) {
    const r = readRegex(src, i);
    return { end: r.end, tok: { k: "re", v: r.v } };
  }
  return readWordOrPunct(src, i);
}

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const NAME = /^[A-Za-z_]\w*/;

function readWordOrPunct(src: string, i: number): { end: number; tok: Tok } {
  const rest = src.slice(i);
  const num = NUMBER.exec(rest);
  if (num) return { end: i + num[0].length, tok: { k: "num", v: Number(num[0]) } };
  const name = NAME.exec(rest);
  if (name) return { end: i + name[0].length, tok: { k: "name", v: name[0] } };
  const p = PUNCT.find((q) => src.startsWith(q, i));
  if (!p)
    throw new AwkSyntax(`syntax error at source line 1: unexpected character '${src.charAt(i)}'`);
  return { end: i + p.length, tok: { k: "p", v: p } };
}

export function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const r = readToken(src, i, out[out.length - 1]);
    if (r.tok) out.push(r.tok);
    i = r.end;
  }
  return out;
}
