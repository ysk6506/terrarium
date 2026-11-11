/**
 * Counts that only the running core code can tell (ADR-0180, DOC095): printed as JSON so the docs check (harness/src/checks/doc-facts.ts, which may not import core) can
 * run this file in a child process, and only when a document states one of these facts.
 */

import { isMain } from "../harness/src/common";
import { ALL_SCENARIO_TEMPLATES } from "../packages/core/src/scenario/library-all";
import { TOOL_DOCS } from "../packages/core/src/tools/docs";
import { ENTITY_KINDS } from "../packages/core/src/world/blueprint";
import { LINK_RULES } from "../packages/core/src/world/blueprint-links";

export const coreFacts = (): Record<string, number> => ({
  entity_kinds: ENTITY_KINDS.length,
  link_kinds: Object.keys(LINK_RULES).length,
  tools: Object.keys(TOOL_DOCS).length,
  scenario_templates: ALL_SCENARIO_TEMPLATES.length,
});

if (isMain(import.meta.url)) process.stdout.write(`${JSON.stringify(coreFacts())}\n`);
