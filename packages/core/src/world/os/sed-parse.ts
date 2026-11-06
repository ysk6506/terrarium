/** The script parser of the small `sed` (ADR-0117): addresses, `s`, `d`, `p`, `q`, `y`, `=`, `a`/`i`/`c`, hold space, `{ }`. */

export interface Address {
  readonly kind: "line" | "last" | "re";
  readonly n?: number;
  readonly re?: RegExp;
}

export interface SedCmd {
  readonly a1?: Address;
  readonly a2?: Address;
  readonly negate: boolean;
  readonly op: string;
  readonly re?: RegExp;
  readonly repl?: string;
  readonly global?: boolean;
  readonly print?: boolean;
  readonly nth?: number;
  readonly text?: string;
  readonly map?: ReadonlyMap<string, string>;
  readonly block?: SedCmd[];
}

export class SedSyntax extends Error {
  constructor(
    message: string,
    readonly outside?: string,
  ) {
    super(message);
  }
}

export type ReBuilder = (src: string, ignoreCase: boolean) => RegExp;

/** Read up to an unescaped `delim`; `\delim` becomes the delimiter itself, other escapes stay. */
function untilDelim(src: string, from: number, delim: string): { text: string; end: number } {
  let text = "";
  let i = from;
  while (i < src.length && src[i] !== delim) {
    if (src[i] === "\\" && i + 1 < src.length) {
      text += src[i + 1] === delim ? delim : `\\${src.charAt(i + 1)}`;
      i += 2;
    } else text += src.charAt(i++);
  }
  if (i >= src.length) throw new SedSyntax("unterminated `s' command");
  return { text, end: i + 1 };
}

/** Commands that take no argument. */
const SIMPLE_OPS = new Set(["d", "p", "q", "=", "h", "H", "g", "G", "x"]);

class ScriptParser {
  private i = 0;

  constructor(
    private readonly src: string,
    private readonly build: ReBuilder,
  ) {}

  private ws(): void {
    while (/[\s;]/.test(this.src.charAt(this.i)) && this.i < this.src.length) this.i++;
  }

  commands(top: boolean): SedCmd[] {
    const out: SedCmd[] = [];
    for (this.ws(); this.i < this.src.length; this.ws()) {
      if (this.src[this.i] === "}") {
        if (top) throw new SedSyntax("unexpected `}'");
        this.i++;
        return out;
      }
      out.push(this.command());
    }
    if (!top) throw new SedSyntax("unmatched `{'");
    return out;
  }

  private address(): Address | undefined {
    const ch = this.src.charAt(this.i);
    if (/\d/.test(ch)) {
      const m = /^\d+/.exec(this.src.slice(this.i)) as RegExpExecArray;
      this.i += m[0].length;
      return { kind: "line", n: Number(m[0]) };
    }
    if (ch === "$") {
      this.i++;
      return { kind: "last" };
    }
    if (ch === "/" || (ch === "\\" && this.src.length > this.i + 1)) {
      const delim = ch === "\\" ? this.src.charAt(this.i + 1) : "/";
      const r = untilDelim(this.src, this.i + (ch === "\\" ? 2 : 1), delim);
      this.i = r.end;
      const ignore = this.src[this.i] === "I";
      if (ignore) this.i++;
      return { kind: "re", re: this.build(r.text, ignore) };
    }
    return undefined;
  }

  private command(): SedCmd {
    const a1 = this.address();
    let a2: Address | undefined;
    if (a1 && this.src[this.i] === ",") {
      this.i++;
      a2 = this.address();
      if (!a2) throw new SedSyntax("unexpected `,'");
    }
    while (this.src[this.i] === " ") this.i++;
    const negate = this.src[this.i] === "!";
    if (negate) this.i++;
    while (this.src[this.i] === " ") this.i++;
    const op = this.src.charAt(this.i++);
    const base = { ...(a1 ? { a1 } : {}), ...(a2 ? { a2 } : {}), negate, op };
    return this.body(op, base);
  }

  private body(op: string, base: { negate: boolean; op: string }): SedCmd {
    if (SIMPLE_OPS.has(op)) return base;
    switch (op) {
      case "s":
        return { ...base, ...this.substitution() };
      case "y":
        return { ...base, map: this.transliteration() };
      case "{":
        return { ...base, block: this.commands(false) };
      case "a":
      case "i":
      case "c":
        return { ...base, text: this.text() };
      default:
        throw new SedSyntax(`unknown command: \`${op}'`, `sed 명령 ${op}`);
    }
  }

  private substitution(): Partial<SedCmd> {
    const delim = this.src.charAt(this.i++);
    const re = untilDelim(this.src, this.i, delim);
    const repl = untilDelim(this.src, re.end, delim);
    let i = repl.end;
    let global = false;
    let print = false;
    let ignore = false;
    let nth: number | undefined;
    for (; i < this.src.length && /[gpiI0-9]/.test(this.src.charAt(i)); i++) {
      const f = this.src.charAt(i);
      if (f === "g") global = true;
      else if (f === "p") print = true;
      else if (f === "i" || f === "I") ignore = true;
      else nth = Number(`${nth ?? ""}${f}`);
    }
    this.i = i;
    return {
      re: this.build(re.text, ignore),
      repl: repl.text,
      global,
      print,
      ...(nth ? { nth } : {}),
    };
  }

  private transliteration(): ReadonlyMap<string, string> {
    const delim = this.src.charAt(this.i++);
    const from = untilDelim(this.src, this.i, delim);
    const to = untilDelim(this.src, from.end, delim);
    this.i = to.end;
    const a = [...from.text];
    const b = [...to.text];
    if (a.length !== b.length) throw new SedSyntax("strings for `y' command are different lengths");
    return new Map(a.map((ch, k) => [ch, b[k] as string]));
  }

  private text(): string {
    if (this.src[this.i] === "\\") this.i += this.src[this.i + 1] === "\n" ? 2 : 1;
    while (this.src[this.i] === " ") this.i++;
    const end = this.src.indexOf("\n", this.i);
    const text = this.src.slice(this.i, end < 0 ? undefined : end);
    this.i = end < 0 ? this.src.length : end + 1;
    return text;
  }
}

export const parseSed = (src: string, build: ReBuilder): SedCmd[] =>
  new ScriptParser(src, build).commands(true);
