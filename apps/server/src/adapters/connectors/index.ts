/** Every connector the server knows, in the order the screen offers them. A new protocol is one more line. */
import { a2aConnector } from "./a2a";
import { commandConnector } from "./command";
import { goClawConnector } from "./goclaw";
import { harnessHttpConnector } from "./harness-http";
import { hermesConnector } from "./hermes";
import { httpTemplateConnector } from "./http-template";
import { langGraphConnector } from "./langgraph";
import { mcpAgentConnector } from "./mcp-agent";
import { openClawConnector } from "./openclaw";
import { openCodeConnector } from "./opencode";
import { scriptedConnector } from "./scripted";
import type { Connector } from "./types";

export const CONNECTORS: readonly Connector[] = [
  // A harness product, through its own interface.
  langGraphConnector,
  openCodeConnector,
  openClawConnector,
  goClawConnector,
  hermesConnector,
  // Any agent that has an HTTP API or speaks a protocol; nothing to program.
  httpTemplateConnector,
  a2aConnector,
  mcpAgentConnector,
  commandConnector,
  // A harness someone built to Terrarium's own protocol.
  harnessHttpConnector,
  scriptedConnector,
];

export function connectorOf(kind: string): Connector | undefined {
  return CONNECTORS.find((c) => c.spec.kind === kind);
}

export type { HttpHarnessConfig } from "./harness-http";
export type { ConnectContext, Connector } from "./types";
