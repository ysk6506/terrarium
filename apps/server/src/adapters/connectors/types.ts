/**
 * A connector knows one protocol for reaching a harness or an agent (REQ-051, ADR-0042). It describes
 * itself (`spec`, which the screen draws its form from), checks what was typed (`schema`) and builds the
 * port the platform runs experiments through (`connect`). A new protocol is one more connector.
 */
import type { ConnectorSpec } from "@terrarium/core/contract";
import type { HarnessPort } from "@terrarium/core/experiments";
import type { z } from "zod";
import type { FetchLike } from "../fetch";

export interface ConnectContext {
  readonly env: NodeJS.ProcessEnv;
  /** Already adds the connection's custom headers to every request. */
  readonly fetch: FetchLike;
  /** Tokens and passwords typed on the screen, by field name (`token`, `apiKey`, `password`). */
  readonly secrets?: Readonly<Record<string, string>>;
}

export interface Connector<S extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly spec: ConnectorSpec;
  /**
   * The settings in one flat object, the way the server's config file writes them: `kind`, `id`, `name`,
   * `description`, then the connector's own. From the screen the same object is made from the form.
   */
  readonly schema: S;
  connect(config: z.output<S>, ctx: ConnectContext): HarnessPort;
}

/** Erases the settings type so connectors of different kinds fit in one list. */
export function defineConnector<S extends z.ZodTypeAny>(connector: Connector<S>): Connector {
  return connector as unknown as Connector;
}
