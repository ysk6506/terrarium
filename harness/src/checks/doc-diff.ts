/**
 * Checks that compare this change with its base (ADR-0180).
 *
 * DOC090 a new ADR does not name the docs it updates, or a named doc is unchanged in the same change
 * DOC097 (notice) docs whose body is unchanged and that were only re-verified
 * DOC098 (notice) the generated decisions table is behind the ADR front matter
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { git, splitFrontMatter, type Violation, violation } from "../common";
import { decisionsStale } from "./doc-decisions";
import { bodyFingerprint } from "./doc-print";
import { testRowNotes } from "./doc-tests";
import { type DocsConfig, discoverDocs, loadDocsConfig } from "./docs";
import { changedFiles } from "./protected";

const REVERIFY_ONLY_CODE = "DOC097";

function checkAddedAdr(root: string, file: string, changed: ReadonlySet<string>): Violation[] {
  const { data } = splitFrontMatter(readFileSync(path.join(root, file), "utf8"));
  if (data === null) return [];
  const listed = data.updates_docs;
  if (!Array.isArray(listed)) {
    return [
      violation(
        "DOC090",
        file,
        1,
        "new ADR does not say which docs it updates",
        "Add `updates_docs: [paths]` (the docs this decision changes, edited in this same change), or `updates_docs: []` plus `updates_docs_reason`.",
      ),
    ];
  }
  if (listed.length === 0) {
    return typeof data.updates_docs_reason === "string" && data.updates_docs_reason.trim()
      ? []
      : [
          violation(
            "DOC090",
            file,
            1,
            "updates_docs is empty without updates_docs_reason",
            "Say why no doc changes, or list the docs this decision changes.",
          ),
        ];
  }
  return listed.map(String).flatMap((doc) => {
    if (!existsSync(path.join(root, doc)))
      return [
        violation(
          "DOC090",
          file,
          1,
          `updates_docs names ${doc}, which does not exist`,
          "Fix the path to the doc this decision changes.",
        ),
      ];
    return changed.has(doc)
      ? []
      : [
          violation(
            "DOC090",
            file,
            1,
            `updates_docs names ${doc}, but this change does not edit it`,
            `Update ${doc} in this same change to follow the decision, or take it off the list.`,
          ),
        ];
  });
}

/** What a re-verification changes in the front matter: the date and the log (other key edits are not a re-check). */
const verifiedStamp = (data: Record<string, unknown> | null): unknown[] => [
  data?.last_verified,
  data?.verification_log,
];

/** Non-ADR docs whose body is the same as at the base but whose front matter changed (a bare re-verify). */
function reverifiedOnly(
  root: string,
  config: DocsConfig,
  base: string,
  changed: ReadonlySet<string>,
): string[] {
  return discoverDocs(root, config)
    .filter((file) => changed.has(file) && !file.startsWith(`${config.adr_dir}/`))
    .filter((file) => {
      const before = git(root, "show", `${base}:${file}`);
      if (before === null) return false;
      const old = splitFrontMatter(before);
      const now = splitFrontMatter(readFileSync(path.join(root, file), "utf8"));
      return (
        bodyFingerprint(old.body) === bodyFingerprint(now.body) &&
        JSON.stringify(verifiedStamp(old.data)) !== JSON.stringify(verifiedStamp(now.data))
      );
    });
}

export function report(
  root: string,
  base: string | undefined,
): { violations: Violation[]; notes: string[] } {
  const config = loadDocsConfig(root);
  const notes: string[] = [];
  const stale = decisionsStale(root, config);
  if (stale) notes.push(stale);
  notes.push(
    ...testRowNotes(
      root,
      discoverDocs(root, config).filter((f) => !f.startsWith(`${config.adr_dir}/`)),
    ),
  );
  if (!base) return { violations: [], notes };
  const changes = changedFiles(root, base);
  const changed = new Set(changes.filter(([status]) => status !== "D").map(([, file]) => file));
  const violations = changes
    .filter(
      ([status, file]) =>
        status === "A" && file.startsWith(`${config.adr_dir}/`) && file.endsWith(".md"),
    )
    .filter(([, file]) => existsSync(path.join(root, file)))
    .flatMap(([, file]) => checkAddedAdr(root, file, changed));
  const stamped = reverifiedOnly(root, config, base, changed);
  if (stamped.length > 0)
    notes.push(
      `NOTE docs [${REVERIFY_ONLY_CODE}] 본문은 그대로이고 다시 확인만 된 문서 ${stamped.length}개: ${stamped.join(", ")}. 정말 읽고 맞는지 확인했는지 봐 주세요.`,
    );
  return { violations, notes };
}

export const run = (root: string, base: string | undefined): Violation[] =>
  report(root, base).violations;
