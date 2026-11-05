/**
 * An agent that a server offers as an MCP tool (REQ-051, ADR-0042): the way an agent gateway lets any
 * framework's agent be called like a tool. Terrarium connects as an MCP client, calls the tool with the task
 * (and, if the tool wants it, the address of this run's own MCP endpoint) and waits for the answer.
 * Without a `tool` setting, every tool the server lists is an agent.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  AgentInfo,
  AgentRunOutcome,
  AgentRunRequest,
  HarnessInfo,
  HarnessPort,
} from "@terrarium/core/experiments";
import { z } from "zod";
import type { FetchLike } from "../fetch";
import { credential, credentialFields } from "./credential";
import { base, EnvName, Url } from "./fields";
import { defineConnector } from "./types";
import { snippet } from "./util";

const schema = z
  .object({
    ...base("mcp-agent"),
    url: Url,
    tokenEnv: EnvName.optional(),
    /** The tool that is the agent. Left out, every tool of the server is an agent. */
    tool: z.string().min(1).max(100).optional(),
    promptArg: z.string().min(1).max(60).default("prompt"),
    /** The argument that gets the address of this run's tools; left out, the tool is not told. */
    mcpUrlArg: z.string().min(1).max(60).optional(),
    extraArgs: z.record(z.unknown()).default({}),
  })
  .strict();

export type McpAgentConfig = z.output<typeof schema>;

export class McpAgent implements HarnessPort {
  readonly info: HarnessInfo;

  constructor(
    private readonly config: McpAgentConfig,
    private readonly token: string | undefined,
    private readonly fetchImpl: FetchLike,
  ) {
    this.info = {
      id: config.id,
      name: config.name,
      kind: "mcp-agent",
      description: config.description || "MCP 서버가 툴 하나로 내놓는 에이전트.",
      toolTransport: "mcp",
      telemetry: "none",
    };
  }

  private async open(): Promise<Client> {
    const client = new Client({ name: "terrarium", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(this.config.url), {
        fetch: (url, init) => this.fetchImpl(String(url), init ?? {}),
        ...(this.token
          ? { requestInit: { headers: { authorization: `Bearer ${this.token}` } } }
          : {}),
      }),
    );
    return client;
  }

  async agents(): Promise<readonly AgentInfo[]> {
    const client = await this.open();
    try {
      const { tools } = await client.listTools();
      const wanted = this.config.tool;
      if (wanted && !tools.some((t) => t.name === wanted))
        throw new Error(
          `서버에 '${wanted}' 툴이 없어요 (있는 것: ${tools.map((t) => t.name).join(", ") || "없음"})`,
        );
      return tools
        .filter((t) => !wanted || t.name === wanted)
        .map((t) => ({
          id: t.name,
          name: t.title ?? t.name,
          ...(t.description ? { description: t.description } : {}),
        }));
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  async run(req: AgentRunRequest): Promise<AgentRunOutcome> {
    const c = this.config;
    const t0 = performance.now();
    const args: Record<string, unknown> = {
      ...c.extraArgs,
      [c.promptArg]: req.prompt,
      ...(c.mcpUrlArg && req.tools.mcpUrl ? { [c.mcpUrlArg]: req.tools.mcpUrl } : {}),
    };
    let client: Client | undefined;
    try {
      client = await this.open();
      const result = (await client.callTool({ name: req.agentId, arguments: args }, undefined, {
        signal: req.signal,
        timeout: req.limits.timeLimitSeconds * 1000 + 60_000,
        resetTimeoutOnProgress: true,
      })) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
      const text = snippet(
        (result.content ?? []).map((p) => (p.type === "text" ? (p.text ?? "") : "")).join(" "),
      );
      const harness = { wallSeconds: (performance.now() - t0) / 1000, message: text };
      return result.isError
        ? { status: "error", message: `에이전트 툴이 오류를 냈어요: ${text}`, harness }
        : { status: "finished", harness };
    } catch (err) {
      if (req.signal.aborted) return { status: "cancelled" };
      return {
        status: "error",
        message: `MCP 에이전트에 연결하지 못했어요: ${(err as Error).message}`,
      };
    } finally {
      await client?.close().catch(() => undefined);
    }
  }
}

export const mcpAgentConnector = defineConnector({
  spec: {
    kind: "mcp-agent",
    label: "MCP 서버의 에이전트 툴",
    description:
      "MCP 서버가 에이전트를 툴 하나로 내놓고 있을 때 써요(에이전트 게이트웨이 방식). 툴을 부르면 에이전트가 일하고 답이 돌아와요. 툴 이름을 정하지 않으면 서버의 툴이 모두 에이전트로 나와요.",
    scope: "agent",
    toolTransport: "mcp",
    toolGuide: [
      "'툴 주소를 넣을 인자 이름'을 적으면, 그 인자에 이 실행 전용 MCP 주소를 넣어 툴을 불러요. 적지 않으면 에이전트는 테라리움의 툴을 받지 못해요.",
      "에이전트가 테라리움 서버 주소에 연결할 수 있어야 해요. 테라리움 주소가 localhost이면 서버 설정의 publicUrl 을 바꿔 주세요.",
    ],
    fromScreen: true,
    fields: [
      {
        key: "url",
        label: "MCP 서버 주소",
        type: "url",
        required: true,
        placeholder: "https://gateway.internal/mcp",
        help: "Streamable HTTP MCP 엔드포인트.",
      },
      ...credentialFields("token", "토큰", "GATEWAY_TOKEN"),
      {
        key: "tool",
        label: "에이전트 툴 이름",
        type: "text",
        help: "비워 두면 서버의 툴이 모두 에이전트로 나와요.",
      },
      {
        key: "promptArg",
        label: "과제를 넣을 인자 이름",
        type: "text",
        default: "prompt",
      },
      {
        key: "mcpUrlArg",
        label: "툴 주소를 넣을 인자 이름",
        type: "text",
        help: "에이전트 툴이 테라리움의 툴(이 실행 전용 MCP 주소)를 받아야 하면 그 인자 이름. 비워 두면 알려 주지 않아요.",
      },
      {
        key: "extraArgs",
        label: "그 밖의 고정 인자(JSON)",
        type: "json",
        help: '예: {"max_steps": 30}',
      },
    ],
  },
  schema,
  connect: (config, ctx) =>
    new McpAgent(config, credential(ctx, "token", config.tokenEnv), ctx.fetch),
});
