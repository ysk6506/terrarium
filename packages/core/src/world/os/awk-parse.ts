/** The parser of the small `awk` (ADR-0117): patterns and actions, `BEGIN`/`END`, expressions with the usual precedence, arrays, `if`/`for`/`while`. */
import { AwkSyntax, lex, type Tok } from "./awk-lex";

export type Expr =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "re"; v: string }
  | { t: "var"; name: string }
  | { t: "idx"; name: string; sub: Expr[] }
  | { t: "field"; e: Expr }
  | { t: "asg"; op: string; lhs: Expr; rhs: Expr }
  | { t: "cond"; c: Expr; a: Expr; b: Expr }
  | { t: "bin"; op: string; l: Expr; r: Expr }
  | { t: "un"; op: string; e: Expr }
  | { t: "incr"; op: "++" | "--"; pre: boolean; lhs: Expr }
  | { t: "call"; name: string; args: Expr[] }
  | { t: "in"; sub: Expr[]; name: string }
  | { t: "cat"; l: Expr; r: Expr };

export type Stmt =
  | { t: "print"; args: Expr[] }
  | { t: "printf"; args: Expr[] }
  | { t: "expr"; e: Expr }
  | { t: "if"; c: Expr; a: Stmt; b?: Stmt }
  | { t: "while"; c: Expr; body: Stmt }
  | { t: "do"; c: Expr; body: Stmt }
  | { t: "for"; init?: Stmt; cond?: Expr; step?: Stmt; body: Stmt }
  | { t: "forin"; v: string; arr: string; body: Stmt }
  | { t: "block"; body: Stmt[] }
  | { t: "next" }
  | { t: "exit"; e?: Expr }
  | { t: "delete"; name: string; sub?: Expr[] }
  | { t: "break" }
  | { t: "continue" };

export interface Rule {
  readonly pattern?: Expr;
  readonly range?: [Expr, Expr];
  readonly action?: Stmt[];
}

export interface Program {
  readonly begin: Stmt[][];
  readonly rules: Rule[];
  readonly end: Stmt[][];
}

const LEVELS: ReadonlyArray<readonly string[]> = [
  ["||"],
  ["&&"],
  ["in"],
  ["~", "!~"],
  ["<", "<=", "!=", "==", ">", ">="],
  ["cat"],
  ["+", "-"],
  ["*", "/", "%"],
];
const ASSIGN = new Set(["=", "+=", "-=", "*=", "/=", "%=", "^="]);
const UNSUPPORTED_NAMES = new Set([
  "getline",
  "system",
  "close",
  "function",
  "func",
  "fflush",
  "nextfile",
]);

/** Functions of GNU awk (and POSIX awk) that this one does not have; awk itself would run them. */
const REAL_FUNCTIONS = new Set([
  "gensub",
  "strftime",
  "systime",
  "mktime",
  "asort",
  "asorti",
  "strtonum",
  "and",
  "or",
  "xor",
  "compl",
  "lshift",
  "rshift",
  "patsplit",
  "isarray",
  "typeof",
]);

/** A keyword or builtin of awk that this one lacks: the real awk runs it, so it is a gap. */
function missing(name: string): AwkSyntax {
  const feature = name === "func" ? "function" : name;
  return new AwkSyntax(name, { feature, what: feature });
}

/** A call to a name that is no function: awk says so; if GNU awk has the function, this one lacks it. */
export function undefinedFunction(name: string): AwkSyntax {
  return REAL_FUNCTIONS.has(name)
    ? new AwkSyntax(name, { feature: `function:${name}`, what: `${name}()` })
    : new AwkSyntax(`function ${name} never defined`);
}

class Parser {
  private i = 0;
  private noGt = false;
  private noIn = false;

  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private isP(v: string): boolean {
    const t = this.peek();
    return t?.k === "p" && t.v === v;
  }

  private isName(v: string): boolean {
    const t = this.peek();
    return t?.k === "name" && t.v === v;
  }

  private eat(v: string): boolean {
    if (!this.isP(v)) return false;
    this.i++;
    return true;
  }

  private need(v: string): void {
    if (!this.eat(v)) throw new AwkSyntax(`syntax error: expected '${v}'`);
  }

  private skipTerms(): void {
    while (this.peek()?.k === "nl" || this.isP(";")) this.i++;
  }

  private skipNl(): void {
    while (this.peek()?.k === "nl") this.i++;
  }

  program(): Program {
    const begin: Stmt[][] = [];
    const end: Stmt[][] = [];
    const rules: Rule[] = [];
    this.skipTerms();
    while (this.peek()) {
      if (this.isName("BEGIN")) {
        this.i++;
        begin.push(this.block());
      } else if (this.isName("END")) {
        this.i++;
        end.push(this.block());
      } else rules.push(this.rule());
      this.skipTerms();
    }
    return { begin, rules, end };
  }

  private rule(): Rule {
    if (this.isP("{")) return { action: this.block() };
    const first = this.expr();
    let range: [Expr, Expr] | undefined;
    if (this.eat(",")) range = [first, this.expr()];
    const action = this.isP("{") ? this.block() : undefined;
    return { ...(range ? { range } : { pattern: first }), ...(action ? { action } : {}) };
  }

  private block(): Stmt[] {
    this.need("{");
    const body: Stmt[] = [];
    this.skipTerms();
    while (!this.isP("}")) {
      if (!this.peek()) throw new AwkSyntax("syntax error: missing }");
      body.push(this.stmt());
      this.skipTerms();
    }
    this.need("}");
    return body;
  }

  private simpleOrBlock(): Stmt {
    this.skipNl();
    return this.stmt();
  }

  private stmt(): Stmt {
    if (this.isP("{")) return { t: "block", body: this.block() };
    const t = this.peek();
    if (t?.k === "name") {
      const keyword = KEYWORDS[t.v];
      if (keyword) {
        this.i++;
        return keyword(this);
      }
      if (UNSUPPORTED_NAMES.has(t.v)) throw missing(t.v);
    }
    return { t: "expr", e: this.expr() };
  }

  // keyword statements (called with the keyword already eaten)
  kwPrint(printf: boolean): Stmt {
    this.noGt = true;
    const args: Expr[] = [];
    const parenthesized = this.isP("(");
    if (!this.endOfStmt()) {
      args.push(this.expr());
      while (this.eat(",")) {
        this.skipNl();
        args.push(this.expr());
      }
    }
    this.noGt = false;
    if (this.isP(">") || this.isP(">>") || this.isP("|"))
      throw new AwkSyntax("print > file", {
        feature: "redirect-output",
        what: "print의 출력 리다이렉트(> >> |)",
      });
    const flat =
      parenthesized && args.length === 1 && args[0]?.t === "call" && args[0].name === ""
        ? (args[0] as { args: Expr[] }).args
        : args;
    return { t: printf ? "printf" : "print", args: flat };
  }

  private endOfStmt(): boolean {
    const t = this.peek();
    return !t || t.k === "nl" || (t.k === "p" && (t.v === ";" || t.v === "}"));
  }

  kwIf(): Stmt {
    this.need("(");
    const c = this.expr();
    this.need(")");
    const a = this.simpleOrBlock();
    const save = this.i;
    this.skipTerms();
    if (this.isName("else")) {
      this.i++;
      return { t: "if", c, a, b: this.simpleOrBlock() };
    }
    this.i = save;
    return { t: "if", c, a };
  }

  kwWhile(): Stmt {
    this.need("(");
    const c = this.expr();
    this.need(")");
    return { t: "while", c, body: this.simpleOrBlock() };
  }

  kwDo(): Stmt {
    const body = this.simpleOrBlock();
    this.skipTerms();
    if (!this.isName("while")) throw new AwkSyntax("syntax error: do without while");
    this.i++;
    this.need("(");
    const c = this.expr();
    this.need(")");
    return { t: "do", c, body };
  }

  kwFor(): Stmt {
    this.need("(");
    const save = this.i;
    const v = this.peek();
    if (v?.k === "name") {
      this.i++;
      if (this.isName("in")) {
        this.i++;
        const arr = this.peek();
        if (arr?.k === "name") {
          this.i++;
          this.need(")");
          return { t: "forin", v: v.v, arr: arr.v, body: this.simpleOrBlock() };
        }
      }
    }
    this.i = save;
    const init = this.isP(";") ? undefined : this.stmt();
    this.need(";");
    const cond = this.isP(";") ? undefined : this.expr();
    this.need(";");
    const step = this.isP(")") ? undefined : this.stmt();
    this.need(")");
    return {
      t: "for",
      ...(init ? { init } : {}),
      ...(cond ? { cond } : {}),
      ...(step ? { step } : {}),
      body: this.simpleOrBlock(),
    };
  }

  kwDelete(): Stmt {
    const n = this.peek();
    if (n?.k !== "name") throw new AwkSyntax("syntax error in delete");
    this.i++;
    const sub = this.isP("[") ? this.subscript() : undefined;
    return { t: "delete", name: n.v, ...(sub ? { sub } : {}) };
  }

  kwExit(): Stmt {
    return this.endOfStmt() ? { t: "exit" } : { t: "exit", e: this.expr() };
  }

  // expressions
  expr(): Expr {
    return this.assignment();
  }

  private assignment(): Expr {
    const lhs = this.ternary();
    const t = this.peek();
    if (
      t?.k === "p" &&
      ASSIGN.has(t.v) &&
      (lhs.t === "var" || lhs.t === "idx" || lhs.t === "field")
    ) {
      this.i++;
      return { t: "asg", op: t.v, lhs, rhs: this.assignment() };
    }
    return lhs;
  }

  private ternary(): Expr {
    const c = this.binary(0);
    if (!this.eat("?")) return c;
    const a = this.assignment();
    this.need(":");
    return { t: "cond", c, a, b: this.assignment() };
  }

  private opAt(level: number): string | undefined {
    const t = this.peek();
    const ops = LEVELS[level] ?? [];
    if (!t) return undefined;
    if (ops[0] === "cat") return this.startsOperand(t) ? "cat" : undefined;
    return t.k === "name" ? this.wordOp(t.v, ops) : this.punctOp(t, ops);
  }

  private wordOp(word: string, ops: readonly string[]): string | undefined {
    return word === "in" && ops.includes("in") && !this.noIn ? "in" : undefined;
  }

  private punctOp(t: Tok, ops: readonly string[]): string | undefined {
    return t.k === "p" && ops.includes(t.v) && !(this.noGt && t.v === ">") ? t.v : undefined;
  }

  private startsOperand(t: Tok): boolean {
    if (t.k === "num" || t.k === "str" || t.k === "re") return true;
    if (t.k === "name") return t.v !== "in" && !UNSUPPORTED_NAMES.has(t.v);
    return t.k === "p" && (t.v === "$" || t.v === "(");
  }

  private binary(level: number): Expr {
    if (level >= LEVELS.length) return this.unary();
    let left = this.binary(level + 1);
    for (let op = this.opAt(level); op; op = this.opAt(level)) {
      if (op === "in") {
        this.i++;
        const arr = this.peek();
        if (arr?.k !== "name") throw new AwkSyntax("syntax error after in");
        this.i++;
        left = { t: "in", sub: [left], name: arr.v };
      } else if (op === "cat") left = { t: "cat", l: left, r: this.binary(level + 1) };
      else {
        this.i++;
        if (op === "&&" || op === "||") this.skipNl();
        left = { t: "bin", op, l: left, r: this.binary(level + 1) };
      }
    }
    return left;
  }

  private unary(): Expr {
    if (this.isP("!") || this.isP("-") || this.isP("+")) {
      const op = (this.peek() as { v: string }).v;
      this.i++;
      return { t: "un", op, e: this.unary() };
    }
    return this.power();
  }

  private power(): Expr {
    const base = this.postfix();
    return this.eat("^") ? { t: "bin", op: "^", l: base, r: this.unary() } : base;
  }

  private postfix(): Expr {
    if (this.isP("++") || this.isP("--")) {
      const op = (this.peek() as { v: "++" | "--" }).v;
      this.i++;
      return { t: "incr", op, pre: true, lhs: this.postfix() };
    }
    const e = this.primary();
    if ((this.isP("++") || this.isP("--")) && (e.t === "var" || e.t === "idx" || e.t === "field")) {
      const op = (this.peek() as { v: "++" | "--" }).v;
      this.i++;
      return { t: "incr", op, pre: false, lhs: e };
    }
    return e;
  }

  private subscript(): Expr[] {
    this.need("[");
    const sub = [this.expr()];
    while (this.eat(",")) sub.push(this.expr());
    this.need("]");
    return sub;
  }

  private primary(): Expr {
    const t = this.peek();
    if (!t) throw new AwkSyntax("syntax error: unexpected end of program");
    this.i++;
    if (t.k === "num") return { t: "num", v: t.v };
    if (t.k === "str") return { t: "str", v: t.v };
    if (t.k === "re") return { t: "re", v: t.v };
    if (t.k === "name") return this.named(t.v);
    if (t.k === "p" && t.v === "$") return { t: "field", e: this.fieldIndex() };
    if (t.k === "p" && t.v === "(") return this.group();
    throw new AwkSyntax(`syntax error near '${t.k === "p" ? t.v : t.k}'`);
  }

  private fieldIndex(): Expr {
    if (this.isP("++") || this.isP("--")) return this.postfix();
    return this.isP("-") || this.isP("!") ? this.unary() : this.primary();
  }

  private group(): Expr {
    const saveGt = this.noGt;
    const saveIn = this.noIn;
    this.noGt = false;
    this.noIn = false;
    const e = this.expr();
    if (this.isP(",")) {
      const args = [e];
      while (this.eat(",")) args.push(this.expr());
      this.need(")");
      this.noGt = saveGt;
      this.noIn = saveIn;
      if (this.isName("in")) {
        this.i++;
        const arr = this.peek();
        if (arr?.k !== "name") throw new AwkSyntax("syntax error after in");
        this.i++;
        return { t: "in", sub: args, name: arr.v };
      }
      return { t: "call", name: "", args };
    }
    this.need(")");
    this.noGt = saveGt;
    this.noIn = saveIn;
    return e;
  }

  private named(name: string): Expr {
    if (UNSUPPORTED_NAMES.has(name)) throw missing(name);
    if (this.isP("(") && FUNCS.has(name)) {
      this.i++;
      const args: Expr[] = [];
      if (!this.isP(")")) {
        args.push(this.expr());
        while (this.eat(",")) args.push(this.expr());
      }
      this.need(")");
      return { t: "call", name, args };
    }
    if (name === "length") return { t: "call", name, args: [] };
    const written = this.toks[this.i - 1];
    if (written?.k === "name" && written.call && name !== "in") throw undefinedFunction(name);
    if (this.isP("[")) return { t: "idx", name, sub: this.subscript() };
    return { t: "var", name };
  }
}

const FUNCS = new Set([
  "length",
  "substr",
  "index",
  "split",
  "sub",
  "gsub",
  "match",
  "sprintf",
  "tolower",
  "toupper",
  "int",
  "sqrt",
  "exp",
  "log",
  "sin",
  "cos",
  "atan2",
  "rand",
  "srand",
]);

const KEYWORDS: Readonly<Record<string, (p: Parser) => Stmt>> = {
  print: (p) => p.kwPrint(false),
  printf: (p) => p.kwPrint(true),
  if: (p) => p.kwIf(),
  while: (p) => p.kwWhile(),
  do: (p) => p.kwDo(),
  for: (p) => p.kwFor(),
  delete: (p) => p.kwDelete(),
  exit: (p) => p.kwExit(),
  next: () => ({ t: "next" }),
  break: () => ({ t: "break" }),
  continue: () => ({ t: "continue" }),
};

export function parseAwk(src: string): Program {
  return new Parser(lex(src)).program();
}
