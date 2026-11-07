/**
 * 이끼 coverage (REQ-103, ADR-0124): nothing the app shows may be out of 이끼's reach.
 *
 * MOSS001 a route of App.tsx has no entry in the screen registry (or the registry names a route App.tsx lacks)
 * MOSS002 an action id used by a screen is not registered, a registered action has no handler, or a page button
 *         has neither `data-moss-action` nor `data-moss-skip="reason"`
 * MOSS003 the docs index does not build, or a doc chunk cannot be found again by its own title
 * MOSS004 a score / metric / ladder / setting tile does not wrap its label in `MossAsk`
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  findRoot,
  finish,
  flag,
  isMain,
  parseArgs,
  readText,
  type Violation,
  violation,
} from "../common";
import { listFiles } from "../files";
import { appRoutes, buttonsIn, referencedActions, scanRegistry, tileClasses } from "./moss-scan";

const APP = "apps/web/src/ui/App.tsx";
const REGISTRY = "apps/web/src/moss/registry.ts";
const INDEX = "apps/server/src/runtime/moss-index.ts";
const PAGES = "apps/web/src/ui/pages";
const UI = "apps/web/src/ui";
/** Class names of the tiles whose numbers and terms 이끼 can explain. A file that draws one must draw `MossAsk`. */
export const TILE_CLASSES: readonly string[] = [
  "figure-label",
  "score-tile",
  "metric-tile",
  "we-lname",
  "we-d-head",
  "setting-term",
];

const tsx = (name: string): boolean => name.endsWith(".tsx") || name.endsWith(".ts");

function routeRules(root: string, v: Violation[]): void {
  const reg = scanRegistry(REGISTRY, readText(path.join(root, REGISTRY)));
  const routes = appRoutes(APP, readText(path.join(root, APP)));
  for (const r of routes)
    if (!reg.routes.has(r))
      v.push(
        violation(
          "MOSS001",
          APP,
          0,
          `route "${r}" has no entry in the 이끼 registry`,
          `Add a screen "${r}" to SCREENS in ${REGISTRY} (title, oneLine, three questions, actions).`,
        ),
      );
  for (const r of reg.routes)
    if (!routes.includes(r))
      v.push(
        violation(
          "MOSS001",
          REGISTRY,
          0,
          `registry names route "${r}" that App.tsx does not have`,
          "Remove the entry or add the route.",
        ),
      );
}

function actionRules(root: string, v: Violation[]): void {
  const reg = scanRegistry(REGISTRY, readText(path.join(root, REGISTRY)));
  const known = new Set(reg.actions.map((a) => a.id));
  const used = new Set<string>();
  for (const file of listFiles(root, [UI], tsx)) {
    for (const ref of referencedActions(file, readText(path.join(root, file)))) {
      if (ref.via === "handler") used.add(ref.id);
      if (!known.has(ref.id))
        v.push(
          violation(
            "MOSS002",
            file,
            ref.line,
            `action "${ref.id}" is not in the registry`,
            `Register it in ${REGISTRY} or fix the name.`,
          ),
        );
    }
  }
  for (const a of reg.actions) {
    for (const s of a.steps)
      if (!known.has(s))
        v.push(
          violation(
            "MOSS002",
            REGISTRY,
            0,
            `step "${s}" of "${a.id}" is not a registered action`,
            "Register it or fix the name.",
          ),
        );
    if (!a.isStatic && !used.has(a.id))
      v.push(
        violation(
          "MOSS002",
          REGISTRY,
          0,
          `action "${a.id}" has no handler`,
          "Hand the screen's real button handler to useMossScreen/useMossActions under this id, or give the action a `go`.",
        ),
      );
  }
}

function buttonRules(root: string, v: Violation[]): void {
  const known = new Set(
    scanRegistry(REGISTRY, readText(path.join(root, REGISTRY))).actions.map((a) => a.id),
  );
  for (const file of listFiles(root, [PAGES], (n) => n.endsWith(".tsx"))) {
    for (const b of buttonsIn(file, readText(path.join(root, file)))) {
      if (b.skip || (b.action && known.has(b.action))) continue;
      v.push(
        violation(
          "MOSS002",
          file,
          b.line,
          b.action
            ? `button names unknown action "${b.action}"`
            : `<${b.tag}> button has no data-moss-action`,
          'Add data-moss-action="<registered id>", or data-moss-skip="why 이끼 need not press it".',
        ),
      );
    }
  }
}

function tileRules(root: string, v: Violation[]): void {
  for (const file of listFiles(root, [UI], (n) => n.endsWith(".tsx"))) {
    const found = tileClasses(file, readText(path.join(root, file)), TILE_CLASSES);
    if (found.hits.length > 0 && !found.usesAsk) {
      const first = found.hits[0];
      v.push(
        violation(
          "MOSS004",
          file,
          first?.line ?? 0,
          `tile "${first?.id}" is drawn without MossAsk`,
          "Wrap its label in <MossAsk question=...> from apps/web/src/moss.",
        ),
      );
    }
  }
}

/** Builds the index in a child process (the harness imports no product code) and asks it for every chunk by its own title. */
const PROBE = `
const [{ buildMossIndex }, dir] = [await import(process.argv[1]), process.argv[2]];
const index = buildMossIndex(dir);
const bad = [];
for (const c of index.chunks) {
  const hit = index.search(c.title + " " + c.file, 8);
  if (!hit.some((h) => h.chunk.file === c.file && h.chunk.title === c.title)) bad.push(c.id);
}
console.log(JSON.stringify({ size: index.size, bad }));
`;

function indexRules(root: string, v: Violation[]): void {
  if (!existsSync(path.join(root, INDEX)) || !existsSync(path.join(root, "docs"))) return;
  try {
    const tsxLoader = pathToFileURL(path.join(root, "node_modules/tsx/dist/esm/index.mjs")).href;
    const out = execFileSync(
      process.execPath,
      [
        "--import",
        tsxLoader,
        "--input-type=module",
        "-e",
        PROBE,
        pathToFileURL(path.join(root, INDEX)).href,
        path.join(root, "docs"),
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 8_000_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    const result = JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as {
      size: number;
      bad: string[];
    };
    if (result.size === 0)
      v.push(
        violation(
          "MOSS003",
          INDEX,
          0,
          "the docs index has no chunks",
          "Check docs/ and the heading parser.",
        ),
      );
    for (const id of result.bad)
      v.push(
        violation(
          "MOSS003",
          INDEX,
          0,
          `doc chunk "${id}" is not reachable by its own title`,
          "Give the section a distinct heading, or fix the tokenizer.",
        ),
      );
  } catch (error) {
    v.push(
      violation(
        "MOSS003",
        INDEX,
        0,
        `the docs index does not build: ${(error as Error).message.split("\n")[0]}`,
        "Run the index on docs/ and fix the error.",
      ),
    );
  }
}

export function run(root: string): Violation[] {
  const v: Violation[] = [];
  const has = (f: string) => existsSync(path.join(root, f));
  if (has(APP) && has(REGISTRY)) {
    routeRules(root, v);
    actionRules(root, v);
    buttonRules(root, v);
  } else if (has(APP)) {
    v.push(
      violation(
        "MOSS001",
        REGISTRY,
        0,
        "there is no 이끼 registry",
        `Create ${REGISTRY} with one entry per route.`,
      ),
    );
  }
  tileRules(root, v);
  indexRules(root, v);
  return v;
}

export function main(argv: readonly string[], out: (line: string) => void = console.log): number {
  const { flags } = parseArgs(argv);
  return finish("moss", run(findRoot(flag(flags, "root"))), out);
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
