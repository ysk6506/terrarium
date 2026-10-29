/**
 * A stand-in for a remote harness's agent: it connects to a run's MCP endpoint with the real MCP
 * client, the way an agent framework would, and calls tools by name.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpAgent {
  tools(): Promise<string[]>;
  call(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ readonly isError: boolean; readonly data: unknown }>;
  close(): Promise<void>;
}

export async function connectAgent(url: string): Promise<McpAgent> {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return {
    async tools() {
      return (await client.listTools()).tools.map((t) => t.name);
    },
    async call(name, args = {}) {
      const r = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: { type: string; text?: string }[];
      };
      const text = r.content.find((c) => c.type === "text")?.text ?? "null";
      return { isError: r.isError === true, data: JSON.parse(text) as unknown };
    },
    close: () => client.close(),
  };
}
