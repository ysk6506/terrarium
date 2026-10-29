/**
 * TypeScript AST helpers shared by the checks: imports, comments, structural fingerprints,
 * functions and cyclomatic complexity. Built on the TypeScript compiler API (typescript 5.x).
 */
import { createHash } from "node:crypto";
import ts from "typescript";

export function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * Parsed files, reused while the text is unchanged: one run of all checks reads each file once
 * instead of once per check (ADR-0029).
 */
const parsed = new Map<string, { readonly text: string; readonly sf: ts.SourceFile }>();

export function parse(file: string, text: string): ts.SourceFile {
  const hit = parsed.get(file);
  if (hit?.text === text) return hit.sf;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  parsed.set(file, { text, sf });
  return sf;
}

export function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

export interface ModuleRef {
  readonly specifier: string;
  readonly line: number;
  readonly typeOnly: boolean;
}

function declarationRef(sf: ts.SourceFile, node: ts.Node): ModuleRef | undefined {
  if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier)
    return undefined;
  if (!ts.isStringLiteral(node.moduleSpecifier)) return undefined;
  const typeOnly = ts.isImportDeclaration(node)
    ? Boolean(node.importClause?.isTypeOnly)
    : node.isTypeOnly;
  return { specifier: node.moduleSpecifier.text, line: lineOf(sf, node.getStart(sf)), typeOnly };
}

function callRef(sf: ts.SourceFile, node: ts.Node): ModuleRef | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  const first = node.arguments[0];
  const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
  if (!(isDynamicImport || isRequire) || !first || !ts.isStringLiteralLike(first)) return undefined;
  return { specifier: first.text, line: lineOf(sf, node.getStart(sf)), typeOnly: false };
}

/** Every module a file depends on: static imports/exports, dynamic import(), require(). */
export function moduleRefs(sf: ts.SourceFile): ModuleRef[] {
  const refs: ModuleRef[] = [];
  walk(sf, (node) => {
    const ref = declarationRef(sf, node) ?? callRef(sf, node);
    if (ref) refs.push(ref);
  });
  return refs;
}

export interface Comment {
  readonly line: number;
  readonly text: string;
}

/** All comments in a file with their line numbers (strings and templates are not comments). */
export function comments(file: string, text: string): Comment[] {
  const sf = parse(file, text);
  const found = new Map<number, Comment>();
  const collect = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      if (!found.has(range.pos))
        found.set(range.pos, {
          line: lineOf(sf, range.pos),
          text: text.slice(range.pos, range.end),
        });
    }
  };
  // getChildren() includes punctuation tokens, so a comment right after `{` is found too.
  const visit = (node: ts.Node): void => {
    collect(ts.getLeadingCommentRanges(text, node.pos));
    collect(ts.getTrailingCommentRanges(text, node.end));
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  return [...found.values()].sort((a, b) => a.line - b.line);
}

/** Literal-ish nodes whose text is part of the program's meaning. */
function meaningfulText(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text;
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) || ts.isBigIntLiteral(node))
    return node.text;
  if (
    ts.isRegularExpressionLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  ) {
    return node.text;
  }
  if (ts.isJsxText(node)) return node.text.replace(/\s+/g, " ").trim();
  return undefined;
}

/**
 * The structure of a node as text: node kinds, identifiers and literal values. Comments, whitespace,
 * line breaks, optional semicolons and quote style do not change it; any change in meaning does.
 */
export function structureOf(node: ts.Node): string {
  const parts: string[] = [];
  const visit = (current: ts.Node): void => {
    parts.push(ts.SyntaxKind[current.kind] ?? String(current.kind));
    const text = meaningfulText(current);
    if (text !== undefined) parts.push(JSON.stringify(text));
    parts.push("(");
    ts.forEachChild(current, visit);
    parts.push(")");
  };
  visit(node);
  return parts.join("");
}

/** Structure of a whole file (see structureOf). */
export function normalized(file: string, text: string): string {
  return structureOf(parse(file, text));
}

export function sha16(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** `a.b.c` for an identifier/property-access chain, else "". */
export function dotted(node: ts.Node): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const head = dotted(node.expression);
    return head ? `${head}.${node.name.text}` : "";
  }
  if (node.kind === ts.SyntaxKind.ThisKeyword) return "this";
  return "";
}

export type FunctionLike =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

export function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function functionName(node: FunctionLike): string {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.name
  ) {
    return node.name.getText();
  }
  const parent = node.parent;
  if (
    parent &&
    (ts.isVariableDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent)) &&
    parent.name
  ) {
    return parent.name.getText();
  }
  return "<anonymous>";
}

export interface FunctionInfo {
  readonly qualname: string;
  readonly node: FunctionLike;
  readonly line: number;
  readonly lines: number;
  readonly params: number;
}

/** Every function in a file, with a qualified name like `Class.method` or `outer.inner`. */
export function functions(sf: ts.SourceFile): FunctionInfo[] {
  const out: FunctionInfo[] = [];
  const visit = (node: ts.Node, prefix: string): void => {
    if (isFunctionLike(node)) {
      const name = functionName(node);
      const qualname = `${prefix}${name}`;
      const start = lineOf(sf, node.getStart(sf));
      const end = lineOf(sf, node.getEnd());
      out.push({
        qualname,
        node,
        line: start,
        lines: end - start + 1,
        params: node.parameters.filter((p) => p.name.getText() !== "this").length,
      });
      ts.forEachChild(node, (child) => visit(child, `${qualname}.`));
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const name = node.name?.text ?? "<class>";
      ts.forEachChild(node, (child) => visit(child, `${prefix}${name}.`));
      return;
    }
    ts.forEachChild(node, (child) => visit(child, prefix));
  };
  visit(sf, "");
  return out;
}

const BRANCH_KINDS = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.CaseClause,
]);
const BRANCH_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

/** McCabe complexity of a function body, not counting nested functions. */
export function complexity(fn: ts.Node): number {
  let total = 1;
  const visit = (node: ts.Node): void => {
    if (node !== fn && isFunctionLike(node)) return;
    if (BRANCH_KINDS.has(node.kind)) total += 1;
    if (ts.isBinaryExpression(node) && BRANCH_OPERATORS.has(node.operatorToken.kind)) total += 1;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn, visit);
  return total;
}

export { ts };
