/** Throwaway repositories for the document checks that follow decisions (ADR-0180). */
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { followsFingerprint } from "../checks/doc-print";
import { findRoot } from "../common";
import { miniRepo } from "./mini-repo";

export const TODAY = "2026-11-11";
export const ADR_DIR = "docs/design-docs/adr";
const realConfig = readFileSync(path.join(findRoot(), "harness/config/docs.yaml"), "utf8");
export const FOLLOW_HASH = followsFingerprint(miniRepo({}, { "package.json": "{}\n" }), [
  "package.json",
]);

/** Front matter that satisfies every document rule unless `fields` says otherwise. */
export function front(fields: Record<string, unknown> = {}): string {
  const data = {
    title: "T",
    kind: "guide",
    status: "active",
    last_verified: TODAY,
    follows: ["package.json"],
    follows_hash: FOLLOW_HASH,
    ...fields,
  };
  return `---\n${YAML.stringify(data)}---\n`;
}

/** A decision record with the keys the ADR rules need (unsealed). */
export const adr = (fields: Record<string, unknown> = {}, body = "# D\nWe do X.\n"): string =>
  `${front({ kind: "decision", enforced_by: ["ARCH010"], follows: undefined, follows_hash: undefined, ...fields })}${body}`;

export function docsRepo(files: Record<string, string> = {}): string {
  return miniRepo(
    {
      "harness/config/docs.yaml": realConfig,
      "harness/src/rules.ts": 'export const RULE = "ARCH010";\n',
      "docs/index.md": `${front()}# Index\n[guide](guide.md)\n`,
      "docs/guide.md": `${front()}# Guide\n`,
      "apps/x/package.json": '{"scripts":{"check":"x"}}\n',
      ...files,
    },
    { "package.json": "{}\n" },
  );
}
