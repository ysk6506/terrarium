/**
 * Every fault has a canonical solution (REQ-110, ADR-0133). The reference paths are data in core; a fault kind, a
 * mistake or a task that is added without one fails here, and so does a path that names a tool nobody has or a
 * variant that belongs to no template.
 */
import { REFERENCE_PATHS, REFERENCE_VARIANTS } from "@terrarium/core/oracle";
import { ALL_SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { FAULT_SPECS, MISTAKE_SPECS } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";

const KEYS = [
  ...FAULT_SPECS.map((f) => f.type as string),
  ...MISTAKE_SPECS.map((m) => m.type as string),
  "firmware_update",
];
const PSEUDO = new Set(["group", "wait_eta", "until_team_done", "shed"]);

describe("every fault kind has a reference solution [REQ-110]", () => {
  test("a fault, a mistake and the firmware task each have a path", () => {
    const missing = KEYS.filter((k) => !(k in REFERENCE_PATHS));
    expect(missing).toEqual([]);
  });

  test("no path is left over for a kind that no longer exists", () => {
    const extra = Object.keys(REFERENCE_PATHS).filter((k) => !KEYS.includes(k));
    expect(extra).toEqual([]);
  });

  test("every path acts through tools that exist", () => {
    const paths = [...Object.entries(REFERENCE_PATHS), ...Object.entries(REFERENCE_VARIANTS)];
    for (const [key, p] of paths) {
      expect(p.diagnose.length + p.fix.length, `${key} does something`).toBeGreaterThan(0);
      const walk = (
        steps: ReadonlyArray<{ tool: string; group?: ReadonlyArray<{ tool: string }> }>,
      ) => {
        for (const s of steps) {
          if (s.group) walk(s.group);
          expect(
            PSEUDO.has(s.tool) || TOOL_NAMES.includes(s.tool as never),
            `${key}: ${s.tool}`,
          ).toBe(true);
        }
      };
      walk([...p.diagnose, ...p.fix, ...p.verify]);
    }
  });

  test("a variant belongs to a template of the library", () => {
    const ids = new Set(ALL_SCENARIO_TEMPLATES.map((t) => t.id));
    for (const id of Object.keys(REFERENCE_VARIANTS)) expect(ids.has(id), id).toBe(true);
  });

  test("every template's fault kinds are covered", () => {
    for (const t of ALL_SCENARIO_TEMPLATES)
      for (const k of t.faultTypes) expect(k in REFERENCE_PATHS, `${t.id}: ${k}`).toBe(true);
  });
});
