/** A scripted stand-in for fetch: routes by method and path, records every request. */
import type { FetchLike } from "../harness/openai";

export interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

type Handler = (req: Recorded) => Response | Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export class FakeFetch {
  readonly requests: Recorded[] = [];
  private readonly routes: Array<[string, RegExp, Handler]> = [];

  on(method: string, path: RegExp, handler: Handler): this {
    this.routes.push([method, path, handler]);
    return this;
  }

  readonly fetch: FetchLike = async (url, init) => {
    const text = typeof init.body === "string" ? init.body : undefined;
    let body: unknown = text;
    try {
      body = text === undefined ? undefined : JSON.parse(text);
    } catch {
      body = text;
    }
    const req: Recorded = {
      method: init.method ?? "GET",
      url,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body,
    };
    this.requests.push(req);
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const route = this.routes.find(([m, p]) => m === req.method && p.test(new URL(url).pathname));
    if (!route) return new Response("not found", { status: 404 });
    return route[2](req);
  };
}
