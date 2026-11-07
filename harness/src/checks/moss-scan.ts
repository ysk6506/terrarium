/** What the `moss` check reads out of the web sources: routes, registry entries, handlers, buttons (REQ-103, ADR-0124). */
import ts from "typescript";
import { lineOf, parse, walk } from "../ts-ast";

export interface RegistryAction {
  readonly id: string;
  readonly kind: string;
  /** Needs no handler from a screen: it only navigates or lists steps of other actions. */
  readonly isStatic: boolean;
  readonly steps: readonly string[];
}

export interface RegistryScan {
  readonly routes: ReadonlySet<string>;
  readonly actions: readonly RegistryAction[];
}

const str = (node: ts.Node | undefined): string | undefined =>
  node && ts.isStringLiteralLike(node) ? node.text : undefined;

function propOf(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (
      ts.isPropertyAssignment(p) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
      p.name.text === name
    )
      return p.initializer;
  }
  return undefined;
}

const hasProp = (obj: ts.ObjectLiteralExpression, name: string): boolean =>
  obj.properties.some(
    (p) =>
      p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name,
  );

function stepsOf(obj: ts.ObjectLiteralExpression): string[] {
  const steps = propOf(obj, "steps");
  if (!steps || !ts.isArrayLiteralExpression(steps)) return [];
  return steps.elements.map(str).filter((s): s is string => s !== undefined);
}

/** Routes and actions written in `apps/web/src/moss/registry.ts`: objects with `id` + `kind`, calls of `nav("id", ...)`, objects with `route`. */
export function scanRegistry(file: string, text: string): RegistryScan {
  const sf = parse(file, text);
  const routes = new Set<string>();
  const actions: RegistryAction[] = [];
  walk(sf, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "nav"
    ) {
      const id = str(node.arguments[0]);
      if (id) actions.push({ id, kind: "navigate", isStatic: true, steps: [] });
    }
    if (!ts.isObjectLiteralExpression(node)) return;
    const route = str(propOf(node, "route"));
    if (route && hasProp(node, "oneLine")) routes.add(route);
    const id = str(propOf(node, "id"));
    const kind = str(propOf(node, "kind"));
    if (id && kind)
      actions.push({
        id,
        kind,
        isStatic: hasProp(node, "go") || hasProp(node, "steps"),
        steps: stepsOf(node),
      });
  });
  return { routes, actions };
}

/** The pages `App.tsx` switches on: every `case "name":` of a string literal. */
export function appRoutes(file: string, text: string): string[] {
  const sf = parse(file, text);
  const out: string[] = [];
  walk(sf, (node) => {
    if (ts.isCaseClause(node)) {
      const name = str(node.expression);
      if (name) out.push(name);
    }
  });
  return out;
}

export interface Reference {
  readonly id: string;
  readonly line: number;
  /** `handler`: a key handed to useMossScreen/useMossActions; `attr`: a `data-moss-action` on an element. */
  readonly via?: "handler" | "attr";
}

const BINDERS = new Set(["useMossScreen", "useMossActions"]);

/** Action ids a source file hands a handler to (`useMossScreen`/`useMossActions` keys) or names on an element (`data-moss-action`). */
export function referencedActions(file: string, text: string): Reference[] {
  const sf = parse(file, text);
  const out: Reference[] = [];
  walk(sf, (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === "data-moss-action") {
      const init = node.initializer;
      const id = init && ts.isStringLiteral(init) ? init.text : undefined;
      if (id) out.push({ id, line: lineOf(sf, node.getStart(sf)), via: "attr" });
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      BINDERS.has(node.expression.text)
    ) {
      walk(node, (inner) => {
        if (ts.isPropertyAssignment(inner) || ts.isMethodDeclaration(inner)) {
          const id = ts.isStringLiteral(inner.name) ? inner.name.text : undefined;
          if (id && /^[a-z0-9]+(-[a-z0-9]+)+$/.test(id))
            out.push({ id, line: lineOf(sf, inner.getStart(sf)), via: "handler" });
        }
      });
    }
  });
  return out;
}

export interface ButtonUse {
  readonly line: number;
  readonly tag: string;
  readonly action?: string;
  readonly skip: boolean;
}

function attrText(
  el: ts.JsxOpeningLikeElement,
  sf: ts.SourceFile,
  name: string,
): { present: boolean; text?: string } {
  for (const a of el.attributes.properties) {
    if (!ts.isJsxAttribute(a) || a.name.getText(sf) !== name) continue;
    const init = a.initializer;
    if (!init) return { present: true };
    if (ts.isStringLiteral(init)) return { present: true, text: init.text };
    if (ts.isJsxExpression(init) && init.expression)
      return { present: true, text: init.expression.getText(sf) };
    return { present: true };
  }
  return { present: false };
}

/** Is the element inside another element that carries `data-moss-skip` (a whole form or card 이끼 leaves alone)? */
function inSkipped(el: ts.JsxOpeningLikeElement, sf: ts.SourceFile): boolean {
  for (let node: ts.Node | undefined = el.parent?.parent; node; node = node.parent) {
    if (ts.isJsxElement(node) && attrText(node.openingElement, sf, "data-moss-skip").present)
      return true;
  }
  return false;
}

/**
 * Buttons a person presses in a page: `<Button>`, `<button className="btn ...">` and `<Go className="btn ...">`.
 * Danger buttons count too (they change things); icon-less quiet links inside lists do not, they are `Go` without `btn`.
 */
export function buttonsIn(file: string, text: string): ButtonUse[] {
  const sf = parse(file, text);
  const out: ButtonUse[] = [];
  const visit = (el: ts.JsxOpeningLikeElement): void => {
    const tag = el.tagName.getText(sf);
    const cls = attrText(el, sf, "className").text ?? "";
    const isButton =
      tag === "Button" ||
      ((tag === "button" || tag === "Go") && /(^|[\s"'`])btn(\s|$|-)/.test(cls));
    if (!isButton) return;
    const action = attrText(el, sf, "data-moss-action");
    out.push({
      line: lineOf(sf, el.getStart(sf)),
      tag,
      ...(action.text ? { action: action.text } : {}),
      skip: attrText(el, sf, "data-moss-skip").present || inSkipped(el, sf),
    });
  };
  walk(sf, (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) visit(node);
  });
  return out;
}

/** Does the file draw `<MossAsk ...>`, and which of `classNames` does it put on an element? */
export function tileClasses(
  file: string,
  text: string,
  classNames: readonly string[],
): { usesAsk: boolean; hits: Reference[] } {
  const sf = parse(file, text);
  let usesAsk = false;
  const hits: Reference[] = [];
  walk(sf, (node) => {
    if (!(ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))) return;
    if (node.tagName.getText(sf) === "MossAsk") usesAsk = true;
    const cls = attrText(node, sf, "className").text;
    if (!cls) return;
    for (const token of cls.split(/[\s"'`]+/)) {
      if (classNames.includes(token)) hits.push({ id: token, line: lineOf(sf, node.getStart(sf)) });
    }
  });
  return { usesAsk, hits };
}
