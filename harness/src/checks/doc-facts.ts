/**
 * DOC095 (ADR-0180): a number a document quotes about the code is counted and compared. The document writes it as
 * `<!-- fact:tools -->96<!-- /fact -->` (the comments do not show in Markdown or on GitHub). `reverify` does not
 * touch these: a wrong number has to be corrected.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { type Violation, violation } from "../common";
import { type ClaimContext, contractRoutes, proseLines } from "./doc-claims";

const FACT_RE = /<!--\s*fact:([a-z_]+)\s*-->\s*([0-9][0-9,]*)\s*<!--\s*\/fact\s*-->/g;
const CORE_FACTS = ["entity_kinds", "link_kinds", "tools", "scenario_templates"];
const CORE_SCRIPT = "scripts/doc-facts-core.ts";

/** Names a document may state, and how each is counted (the core ones need the running code). */
export const FACT_NAMES = [...CORE_FACTS, "contract_routes", "check_codes"] as const;

function coreFacts(root: string): Record<string, number> | null {
  if (!existsSync(path.join(root, CORE_SCRIPT)) || !existsSync(path.join(root, "packages/core")))
    return null;
  try {
    const out = execFileSync(process.execPath, ["--import", "tsx", CORE_SCRIPT], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(out.trim().split("\n").pop() as string) as Record<string, number>;
  } catch {
    return null;
  }
}

/** Counted value of a fact, or null when this repository cannot tell. */
export class FactCounter {
  private core: Record<string, number> | null | undefined;
  constructor(
    private readonly root: string,
    private readonly ctx: ClaimContext,
  ) {}

  count(name: string): number | null {
    if (name === "contract_routes") {
      const routes = contractRoutes(this.root);
      return routes.length > 0 ? routes.length : null;
    }
    if (name === "check_codes") {
      const codes = new Set(this.ctx.code().match(/"[A-Z]{2,6}\d{3}"/g) ?? []);
      return codes.size > 0 ? codes.size : null;
    }
    if (!CORE_FACTS.includes(name)) return null;
    if (this.core === undefined) this.core = coreFacts(this.root);
    return this.core?.[name] ?? null;
  }
}

export function checkFacts(
  counter: FactCounter,
  file: string,
  body: string,
  firstLine: number,
): Violation[] {
  const out: Violation[] = [];
  for (const [line, text] of proseLines(body, firstLine)) {
    for (const m of text.matchAll(FACT_RE)) {
      const name = m[1] as string;
      if (!(FACT_NAMES as readonly string[]).includes(name)) {
        out.push(
          violation(
            "DOC095",
            file,
            line,
            `unknown fact '${name}'`,
            `Use one of: ${FACT_NAMES.join(", ")}, or add the fact to harness/src/checks/doc-facts.ts.`,
          ),
        );
        continue;
      }
      const counted = counter.count(name);
      const written = Number((m[2] as string).replace(/,/g, ""));
      if (counted !== null && counted !== written) {
        out.push(
          violation(
            "DOC095",
            file,
            line,
            `fact ${name}: the doc says ${written}, the code has ${counted}`,
            `Write ${counted} between the fact markers (reverify does not fix a wrong number), and re-read the sentence around it.`,
          ),
        );
      }
    }
  }
  return out;
}
