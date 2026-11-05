/** A run request and tool endpoint for connector tests, without a world behind them. */
import type { AgentRunRequest, ToolCallOutcome } from "@terrarium/core/experiments";
import { TOOL_SPECS } from "@terrarium/core/tools";

export interface CalledTool {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

export interface FakeTools {
  readonly calls: CalledTool[];
  readonly endpoint: AgentRunRequest["tools"];
}

/** Tools whose calls are recorded and answered by `answer` (default: ok with an empty result). */
export function fakeTools(
  answer: (name: string, args: Record<string, unknown>) => ToolCallOutcome = () => ({
    ok: true,
    data: { seen: true },
  }),
  /** `null` for a run that was given no MCP endpoint. */
  mcpUrl: string | null = "https://terrarium.test/mcp/runs/r1/tok",
): FakeTools {
  const calls: CalledTool[] = [];
  return {
    calls,
    endpoint: {
      specs: TOOL_SPECS.filter((t) => ["get_entity", "submit_diagnosis"].includes(t.name)),
      ...(mcpUrl ? { mcpUrl } : {}),
      call: async (name, args) => {
        calls.push({ name, args });
        return answer(name, args);
      },
    },
  };
}

export function runRequest(extra: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    runId: "r1",
    seed: 3,
    agentId: "agent-1",
    prompt: '서버 "A"를 조사하라',
    limits: { maxToolCalls: 40, timeLimitSeconds: 600 },
    tools: fakeTools().endpoint,
    signal: new AbortController().signal,
    ...extra,
  };
}
