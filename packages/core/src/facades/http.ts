/**
 * Framework-free request/response shapes and a tiny router (REQ-003: facades know no web framework).
 * apps/server adapts real HTTP requests to these types and back.
 */
import { hashHex, TerrariumError } from "@terrarium/core/kernel";

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface FacadeRequest {
  readonly method: Method;
  /** Path below the facade's mount point, starting with "/". */
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

export interface FacadeResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): FacadeResponse => ({
  status,
  headers: { "content-type": "application/json", ...headers },
  body,
});

export const noContent = (): FacadeResponse => ({ status: 204, headers: {}, body: undefined });

export type Params = Readonly<Record<string, string>>;
export type Handler = (req: FacadeRequest, params: Params) => FacadeResponse;

interface Route {
  readonly method: Method;
  readonly parts: readonly string[];
  readonly handler: Handler;
}

/** Matches `/a/:id/b` style patterns; the first matching route wins. */
export class Router {
  private readonly routes: Route[] = [];

  on(method: Method, pattern: string, handler: Handler): this {
    this.routes.push({ method, parts: split(pattern), handler });
    return this;
  }

  match(
    req: FacadeRequest,
  ): { handler: Handler; params: Params } | "method_not_allowed" | undefined {
    const parts = split(req.path);
    let pathMatched = false;
    for (const route of this.routes) {
      const params = matchParts(route.parts, parts);
      if (!params) continue;
      pathMatched = true;
      if (route.method === req.method) return { handler: route.handler, params };
    }
    return pathMatched ? "method_not_allowed" : undefined;
  }
}

function split(path: string): string[] {
  return path.split("?")[0]?.split("/").filter(Boolean).map(decodeURIComponent) ?? [];
}

function matchParts(
  pattern: readonly string[],
  parts: readonly string[],
): Record<string, string> | undefined {
  if (pattern.length !== parts.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i] as string;
    const v = parts[i] as string;
    if (p.startsWith(":")) params[p.slice(1)] = v;
    else if (p.toLowerCase() !== v.toLowerCase()) return undefined;
  }
  return params;
}

/** Simulated wall clock: the scenario starts at this instant, so timestamps are reproducible. */
export const SIM_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

export function simTimeIso(t: number): string {
  return new Date(SIM_EPOCH_MS + Math.round(t * 1000)).toISOString().replace(".000Z", "Z");
}

export function simTimeMs(t: number): number {
  return SIM_EPOCH_MS + Math.round(t * 1000);
}

/** A stable UUID-shaped identifier for an entity (vROps/vCenter style ids). */
export function stableUuid(id: string): string {
  const hex = (hashHex(`a:${id}`) + hashHex(`b:${id}`)).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Run a handler and turn domain errors into protocol-shaped error responses. */
export function dispatch(
  router: Router,
  req: FacadeRequest,
  error: (status: number, message: string) => FacadeResponse,
): FacadeResponse {
  const found = router.match(req);
  if (found === undefined) return error(404, `no resource at ${req.path}`);
  if (found === "method_not_allowed")
    return error(405, `${req.method} is not allowed on ${req.path}`);
  try {
    return found.handler(req, found.params);
  } catch (caught) {
    if (caught instanceof TerrariumError) return error(caught.status, caught.message);
    throw caught;
  }
}
