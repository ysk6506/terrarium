/**
 * One MCP endpoint per run (REQ-008, REQ-031, ADR-0026). A harness gets a URL that serves exactly
 * that run's tools; the URL carries an unguessable token, so one run cannot reach another's world.
 * When the run ends the endpoint is gone. Each request is handled statelessly (Streamable HTTP).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ToolCallOutcome, ToolEndpoint } from "@terrarium/core/experiments";
import { randomToken } from "@terrarium/core/kernel";
import type { ToolGateway } from "../runtime";

type Endpoint = Pick<ToolEndpoint, "specs" | "call">;

interface Entry {
  readonly runId: string;
  readonly endpoint: Endpoint;
}

/** What the model reads back from a tool call over MCP. */
export function mcpResult(result: ToolCallOutcome) {
  const body = result.ok ? result.data : { error: result.error };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(body ?? null) }],
    ...(result.ok ? {} : { isError: true }),
  };
}

export function mcpServerFor(entry: Entry, version: string): Server {
  const server = new Server({ name: "terrarium", version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: entry.endpoint.specs.map((s) => ({
      name: s.name,
      title: s.title,
      description: s.description,
      inputSchema: s.inputSchema as { type: "object"; properties?: Record<string, object> },
      annotations: { readOnlyHint: !s.mutating, title: s.title },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    mcpResult(
      await entry.endpoint.call(
        req.params.name,
        (req.params.arguments ?? {}) as Record<string, unknown>,
      ),
    ),
  );
  return server;
}

export class McpGateway implements ToolGateway {
  private readonly entries = new Map<string, Entry>();

  /** `baseUrl` is how harnesses reach this server, e.g. https://terrarium.internal */
  constructor(
    private readonly baseUrl: string,
    private readonly version = "dev",
  ) {}

  get openEndpoints(): number {
    return this.entries.size;
  }

  open(runId: string, endpoint: Endpoint): { url: string; close(): void } {
    const token = randomToken(18);
    this.entries.set(token, { runId, endpoint });
    return {
      url: `${this.baseUrl.replace(/\/$/, "")}/mcp/runs/${encodeURIComponent(runId)}/${token}`,
      close: () => {
        this.entries.delete(token);
      },
    };
  }

  /** Whether this run id and token name a live endpoint. */
  has(runId: string, token: string): boolean {
    return this.entries.get(token)?.runId === runId;
  }

  /** Serve one MCP HTTP request; false when there is no such live endpoint (the caller answers 404). */
  async handle(
    runId: string,
    token: string,
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<boolean> {
    const entry = this.entries.get(token);
    if (!entry || entry.runId !== runId) return false;
    const server = mcpServerFor(entry, this.version);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    return true;
  }
}
