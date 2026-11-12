/**
 * Documentation quality (REQ-020, ADR-0002): docs must prove they are current.
 *
 * A doc declares `covers` (globs of the code it describes). `covers_hash` fingerprints those files
 * (TypeScript by structure, so comment and format changes do not churn docs). When the code changes
 * the doc is stale until someone re-reads it, fixes it and runs `reverify --note`.
 *
 * DOC001 front matter   DOC002 bad kind/status   DOC010 stale   DOC011 never verified
 * DOC012 covers nothing DOC020 too old           DOC021 future date
 * DOC030 broken link    DOC031 dead path         DOC040 orphan  DOC050 too long
 * DOC060 wrong place    DOC070 sealed ADR edited DOC071 ADR not sealed  DOC080 ADR unenforced
 * DOC090 new ADR's updates_docs (doc-diff.ts)  DOC091 amends/amended_by  DOC092 no covers or follows
 * DOC093 goal sentence (doc-follow.ts, ADR-0180)  DOC094/DOC095 notices
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  daysBetween,
  findRoot,
  finish,
  flag,
  isIsoDate,
  isMain,
  joinFrontMatter,
  loadYaml,
  parseArgs,
  splitFrontMatter,
  today,
  type Violation,
  violation,
} from "../common";
import { expandGlobs, listFiles } from "../files";
import { checkAdr } from "./doc-adr";
import { audit, auditQueue, formatQueue, noteVerification } from "./doc-audit";
import { ClaimContext, checkClaims, proseLines } from "./doc-claims";
import { linkAmends, writeDecisions } from "./doc-decisions";
import { checkFacts, FactCounter } from "./doc-facts";
import { checkAmendLinks, checkFollows, checkGoal, reverifyCommand } from "./doc-follow";
import { bodyFingerprint, coversFingerprint, followsFingerprint } from "./doc-print";

const CONFIG_PATH = "harness/config/docs.yaml";
const LINK_RE = /(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const PATH_LIKE_RE = /^[A-Za-z0-9_.\-/]+\.(?:ts|tsx|md|yaml|yml|json|txt|toml|css|html)$/;

export interface DocsConfig {
  docs_root: string;
  index: string;
  root_docs: string[];
  adr_dir: string;
  generated_dir: string;
  archive_dir: string;
  kinds: string[];
  statuses: string[];
  required_keys: string[];
  max_age_days: Record<string, number | null>;
  max_lines: Record<string, number>;
  path_roots: string[];
  root_files: string[];
  /** Spec whose bold goal sentence must lead `goal_docs` (DOC093). */
  goal_source?: string;
  goal_docs?: string[];
  decisions_file?: string;
}

export const loadDocsConfig = (root: string): DocsConfig =>
  loadYaml<DocsConfig>(path.join(root, CONFIG_PATH));

export function discoverDocs(root: string, config: DocsConfig): string[] {
  const rootDocs = config.root_docs.filter((name) => existsSync(path.join(root, name)));
  const skipped = [`${config.generated_dir}/`, `${config.archive_dir}/`];
  const nested = listFiles(root, [config.docs_root], (name) => name.endsWith(".md")).filter(
    (f) => !skipped.some((s) => f.startsWith(s)),
  );
  return [...rootDocs, ...nested];
}

function checkFrontMatter(
  config: DocsConfig,
  file: string,
  data: Record<string, unknown> | null,
  now: string,
): Violation[] {
  if (data === null) {
    return [
      violation(
        "DOC001",
        file,
        1,
        "missing YAML front matter",
        `Start the file with --- front matter containing: ${config.required_keys.join(", ")}.`,
      ),
    ];
  }
  const out: Violation[] = config.required_keys
    .filter((key) => !(key in data))
    .map((key) => violation("DOC001", file, 1, `front matter lacks '${key}'`, `Add '${key}'.`));
  for (const [key, allowed] of [
    ["kind", config.kinds],
    ["status", config.statuses],
  ] as const) {
    if (key in data && !allowed.includes(String(data[key]))) {
      out.push(
        violation(
          "DOC002",
          file,
          1,
          `${key} '${String(data[key])}' is invalid`,
          `Use one of: ${allowed.join(", ")}.`,
        ),
      );
    }
  }
  return [...out, ...checkDates(config, file, data, now)];
}

function checkDates(
  config: DocsConfig,
  file: string,
  data: Record<string, unknown>,
  now: string,
): Violation[] {
  if (!("last_verified" in data)) return [];
  const verified = data.last_verified;
  if (!isIsoDate(verified))
    return [
      violation("DOC001", file, 1, "last_verified is not a YYYY-MM-DD date", "Use YYYY-MM-DD."),
    ];
  const age = daysBetween(verified, now);
  if (age < 0)
    return [
      violation(
        "DOC021",
        file,
        1,
        "last_verified is in the future",
        "Use the real date you verified the doc.",
      ),
    ];
  const limit = config.max_age_days[String(data.kind)];
  if (limit === null || limit === undefined || data.status !== "active" || age <= limit) return [];
  return [
    violation(
      "DOC020",
      file,
      1,
      `last verified ${age} days ago (limit ${limit} for ${String(data.kind)})`,
      `Read the doc against the code, fix it, then run: ${reverifyCommand(file)}`,
    ),
  ];
}

function checkFreshness(root: string, file: string, data: Record<string, unknown>): Violation[] {
  const covers = data.covers;
  if (!Array.isArray(covers) || covers.length === 0) return [];
  const globs = covers.map(String);
  if (expandGlobs(root, globs).length === 0) {
    return [
      violation(
        "DOC012",
        file,
        1,
        `'covers' matches no files: ${globs.join(", ")}`,
        "Fix the globs (the code moved or was deleted) or remove the stale claim.",
      ),
    ];
  }
  const fix = `Re-read the doc against the covered code, update it, then run: ${reverifyCommand(file)}`;
  if (typeof data.covers_hash !== "string")
    return [violation("DOC011", file, 1, "doc declares 'covers' but was never verified", fix)];
  if (data.covers_hash !== coversFingerprint(root, globs)) {
    return [
      violation(
        "DOC010",
        file,
        1,
        "code covered by this doc changed since it was last verified",
        fix,
      ),
    ];
  }
  return [];
}

function checkLength(config: DocsConfig, file: string, text: string): Violation[] {
  const limit = config.max_lines[path.basename(file)] ?? config.max_lines.default ?? 400;
  const count = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  return count <= limit
    ? []
    : [
        violation(
          "DOC050",
          file,
          1,
          `${count} lines exceeds the ${limit} line limit`,
          "Split the doc by topic and link the parts (progressive disclosure).",
        ),
      ];
}

function checkLinksAndPaths(
  root: string,
  config: DocsConfig,
  file: string,
  body: string,
  firstLine: number,
): { violations: Violation[]; links: string[] } {
  const violations: Violation[] = [];
  const links: string[] = [];
  for (const [line, text] of proseLines(body, firstLine)) {
    for (const match of text.matchAll(LINK_RE)) {
      const target = (match[1] as string).split("#")[0] as string;
      if (!target || target.includes("://") || target.startsWith("mailto:")) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
      if (existsSync(path.join(root, resolved))) links.push(resolved.replace(/\/$/, ""));
      else
        violations.push(
          violation(
            "DOC030",
            file,
            line,
            `broken link: ${match[1] as string}`,
            "Fix the path or delete the link.",
          ),
        );
    }
    for (const match of text.matchAll(INLINE_CODE_RE)) {
      const candidate = (match[1] as string).trim();
      if (!PATH_LIKE_RE.test(candidate)) continue;
      const checked =
        config.path_roots.some((p) => candidate.startsWith(p)) ||
        config.root_files.includes(candidate);
      if (checked && !existsSync(path.join(root, candidate))) {
        violations.push(
          violation(
            "DOC031",
            file,
            line,
            `\`${candidate}\` does not exist`,
            "Update the reference to the file's real location or remove it.",
          ),
        );
      }
    }
  }
  return { violations, links };
}

function checkOrphans(
  config: DocsConfig,
  docs: readonly string[],
  links: ReadonlyMap<string, readonly string[]>,
): Violation[] {
  const reachable = new Set<string>();
  const frontier = [config.index, ...config.root_docs];
  while (frontier.length > 0) {
    const current = frontier.pop() as string;
    if (reachable.has(current)) continue;
    reachable.add(current);
    frontier.push(...(links.get(current) ?? []));
  }
  // The ADR folder is reached as a whole once something reachable links to it (ADR-0180).
  const adrFolderLinked = reachable.has(config.adr_dir);
  return docs
    .filter((doc) => doc.startsWith(`${config.docs_root}/`) && !reachable.has(doc))
    .filter((doc) => !(adrFolderLinked && doc.startsWith(`${config.adr_dir}/`)))
    .map((doc) =>
      violation(
        "DOC040",
        doc,
        1,
        "doc is not reachable from docs/index.md or a root doc",
        "Link it from docs/index.md (or a linked doc), or delete it.",
      ),
    );
}

function checkPlacement(
  config: DocsConfig,
  file: string,
  data: Record<string, unknown>,
): Violation[] {
  const out: Violation[] = [];
  const inAdr = file.startsWith(`${config.adr_dir}/`);
  if (data.kind === "decision" && !inAdr)
    out.push(
      violation(
        "DOC060",
        file,
        1,
        "decisions belong in the ADR directory",
        `Move it to ${config.adr_dir}/.`,
      ),
    );
  if (inAdr && data.kind !== "decision")
    out.push(
      violation(
        "DOC060",
        file,
        1,
        "only kind: decision docs live in the ADR directory",
        "Change the kind or move the file.",
      ),
    );
  if (
    data.kind === "plan" &&
    file.includes("exec-plans/completed/") &&
    data.status !== "archived"
  ) {
    out.push(
      violation(
        "DOC060",
        file,
        1,
        "completed plans must have status: archived",
        "Set status: archived (or move the plan back to active/).",
      ),
    );
  }
  if (data.kind === "plan" && file.includes("exec-plans/active/") && data.status !== "active") {
    out.push(
      violation(
        "DOC060",
        file,
        1,
        "plans in active/ must have status: active",
        "Move finished plans to exec-plans/completed/.",
      ),
    );
  }
  return out;
}

export function run(root: string, now: string = today()): Violation[] {
  const config = loadDocsConfig(root);
  const docs = discoverDocs(root, config);
  const violations: Violation[] = [];
  const links = new Map<string, string[]>();
  const adrs = new Map<string, Record<string, unknown>>();
  const claims = new ClaimContext(root, config.adr_dir);
  const facts = new FactCounter(root, claims);
  for (const file of docs) {
    const text = readFileSync(path.join(root, file), "utf8");
    const { data, body, bodyLine } = splitFrontMatter(text);
    violations.push(
      ...checkFrontMatter(config, file, data, now),
      ...checkLength(config, file, text),
    );
    const scanned = checkLinksAndPaths(root, config, file, body, bodyLine);
    violations.push(...scanned.violations);
    links.set(file, scanned.links);
    if (data === null) continue;
    violations.push(
      ...checkFreshness(root, file, data),
      ...checkFollows(root, file, data),
      ...checkPlacement(config, file, data),
    );
    if (data.kind === "decision") {
      violations.push(...checkAdr(root, file, data, body));
      adrs.set(file, data);
    } else {
      violations.push(
        ...checkClaims(claims, file, body, bodyLine),
        ...checkFacts(facts, file, body, bodyLine),
      );
    }
  }
  return [
    ...violations,
    ...checkAmendLinks(config, adrs),
    ...checkGoal(root, config),
    ...checkOrphans(config, docs, links),
  ];
}

/** Record that someone re-read `file` against its covered code. */
export function reverify(root: string, file: string, note: string, now: string = today()): void {
  const full = path.join(root, file);
  const { data, body } = splitFrontMatter(readFileSync(full, "utf8"));
  if (data === null) throw new Error(`${file} has no front matter`);
  if (!note.trim()) throw new Error("--note is required: say what you checked or changed");
  if (Array.isArray(data.covers))
    data.covers_hash = coversFingerprint(root, data.covers.map(String));
  if (Array.isArray(data.follows) && data.follows.length > 0)
    data.follows_hash = followsFingerprint(root, data.follows.map(String));
  noteVerification(data, body);
  data.last_verified = now;
  const log = Array.isArray(data.verification_log) ? data.verification_log.map(String) : [];
  data.verification_log = [...log, `${now}: ${note.trim()}`].slice(-5);
  writeFileSync(full, joinFrontMatter(data, body), "utf8");
}

export function sealAdr(root: string, file: string): void {
  const full = path.join(root, file);
  const { data, body } = splitFrontMatter(readFileSync(full, "utf8"));
  if (data === null || data.kind !== "decision")
    throw new Error("only kind: decision docs can be sealed");
  data.decision_hash = bodyFingerprint(body);
  writeFileSync(full, joinFrontMatter(data, body), "utf8");
}

const relPath = (root: string, target: string): string =>
  path.relative(root, path.resolve(target)).split(path.sep).join("/");

/** Run a subcommand that takes a document; undefined when `command` is not one of them. */
function onDoc(root: string, command: string | undefined, target: string, note: string): boolean {
  const file = relPath(root, target);
  if (command === "reverify") reverify(root, file, note);
  else if (command === "seal-adr") sealAdr(root, file);
  else if (command === "audit") audit(root, file, note);
  else if (command === "link-amends") {
    for (const changed of linkAmends(root, loadDocsConfig(root), file))
      console.log(`amended_by: ${changed}`);
  } else return false;
  return true;
}

export function main(argv: readonly string[]): number {
  const { positional, flags } = parseArgs(argv);
  const root = findRoot(flag(flags, "root"));
  const [command, target] = positional;
  if (target && onDoc(root, command, target, flag(flags, "note") ?? "")) return 0;
  if (command === "audit-queue") {
    const config = loadDocsConfig(root);
    const plain = discoverDocs(root, config).filter((f) => !f.startsWith(`${config.adr_dir}/`));
    console.log(formatQueue(auditQueue(root, plain)));
    return 0;
  }
  if (command === "decisions") {
    writeDecisions(root, loadDocsConfig(root));
    return 0;
  }
  return finish("docs", run(root));
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
