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
import { DEFAULT_TOOLSET, TOOL_SPECS } from "@terrarium/core/tools";
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

const NO_RUN = "지금 이 연결에서 돌고 있는 실험이 없어요. 툴은 실험이 돌 때만 세계와 이어져요";

/** What a fixed address shows while nothing runs on it: the usual tools, and calls that say why they do nothing. */
const IDLE: Entry = {
  runId: "",
  endpoint: {
    specs: TOOL_SPECS.filter((t) => [...DEFAULT_TOOLSET, "submit_diagnosis"].includes(t.name)),
    call: async () => ({ ok: false, error: NO_RUN }),
  },
};

export class McpGateway implements ToolGateway {
  private readonly entries = new Map<string, Entry>();
  private readonly slots = new Map<string, Entry>();

  /**
   * `baseUrl` is how harnesses reach this server, e.g. https://terrarium.internal. `slotToken` makes the
   * unguessable part of a fixed address; it should be the same after a restart, or every harness that
   * wrote the address into its settings would have to be told again.
   */
  constructor(
    private readonly baseUrl: string,
    private readonly version = "dev",
    private readonly slotToken: (slot: string) => string = (() => {
      const made = new Map<string, string>();
      return (slot: string) => {
        const known = made.get(slot);
        if (known) return known;
        const token = randomToken(18);
        made.set(slot, token);
        return token;
      };
    })(),
  ) {}

  /** The fixed address of a slot (a connection that reads its MCP servers from its own settings). */
  slotUrl(slot: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}/mcp/slots/${encodeURIComponent(slot)}/${this.slotToken(slot)}`;
  }

  /** Whether this slot and token name a fixed address (idle or not). */
  hasSlot(slot: string, token: string): boolean {
    return token === this.slotToken(slot);
  }

  get openEndpoints(): number {
    return this.entries.size;
  }

  open(runId: string, endpoint: Endpoint, slot?: string): { url: string; close(): void } {
    const token = randomToken(18);
    const entry: Entry = { runId, endpoint };
    this.entries.set(token, entry);
    if (slot) this.slots.set(slot, entry);
    return {
      url: `${this.baseUrl.replace(/\/$/, "")}/mcp/runs/${encodeURIComponent(runId)}/${token}`,
      close: () => {
        this.entries.delete(token);
        if (slot && this.slots.get(slot) === entry) this.slots.delete(slot);
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
    await this.serve(entry, req, res, body);
    return true;
  }

  /** Serve one MCP HTTP request at a fixed address: the run going on it, or the idle tool list. */
  async handleSlot(
    slot: string,
    token: string,
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<boolean> {
    if (!this.hasSlot(slot, token)) return false;
    await this.serve(this.slots.get(slot) ?? IDLE, req, res, body);
    return true;
  }

  private async serve(
    entry: Entry,
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<void> {
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
  }
}
