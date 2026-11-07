/**
 * The built-in reference agents played against a session (REQ-108, ADR-0131): the same code a run on the server uses
 * (`ScriptedHarness`), driven in process on a world and a sheet, so a test can say what `operator`, `triage`, `guess`
 * and `idle` score where.
 */
import type { AgentRunRequest, ToolEndpoint } from "@terrarium/core/experiments";
import { ALL_SCENARIO_TEMPLATES, type ScenarioDoc } from "@terrarium/core/scenario";
import { type RunResult, Session } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { ScriptedHarness } from "../../../apps/server/src/adapters";

export const BUILTINS = ["operator", "triage", "guess", "idle"] as const;
export type Builtin = (typeof BUILTINS)[number];

export function sheetOf(templateId: string, blueprint: Blueprint): ScenarioDoc {
  const t = ALL_SCENARIO_TEMPLATES.find((x) => x.id === templateId);
  if (!t) throw new Error(`no template ${templateId}`);
  return t.build(new BlueprintIndex(blueprint), "lab");
}

export interface Played {
  readonly result: RunResult;
  readonly calls: ReadonlyArray<{ name: string; args: Record<string, unknown>; ok: boolean }>;
}

/** Play one built-in agent on a world and a sheet, with every tool unless told otherwise. */
export async function playBuiltin(
  agentId: Builtin,
  blueprint: Blueprint,
  scenario: ScenarioDoc,
  options: { tools?: readonly string[]; seed?: number } = {},
): Promise<Played> {
  const seed = options.seed ?? 1;
  const session = Session.create({
    blueprint,
    scenario,
    tools: options.tools ?? TOOL_NAMES,
    seed,
  });
  session.start();
  const calls: Played["calls"][number][] = [];
  const tools: ToolEndpoint = {
    specs: session.toolSpecs(),
    call: async (name, args) => {
      const r = session.call(name, args);
      calls.push({ name, args, ok: r.ok });
      return r;
    },
  };
  const req: AgentRunRequest = {
    runId: "r1",
    seed,
    agentId,
    prompt: "조사하라",
    limits: { maxToolCalls: 200, timeLimitSeconds: 8 * 3600 },
    tools,
    signal: new AbortController().signal,
  };
  await new ScriptedHarness("builtin", "내장").run(req);
  return { result: session.finish(), calls };
}
