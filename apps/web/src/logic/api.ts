/**
 * The web's API client, built from the contract's route table (REQ-030): a call names a route, and the
 * path, method, input and result types all come from that one entry. Errors arrive as the server's
 * Korean message with the fields that are wrong, ready to show next to them.
 */
import {
  type ApiIssue,
  type BodyOf,
  isApiError,
  pathFor,
  type QueryOf,
  type Responses,
  ROUTES,
  type RouteName,
} from "@terrarium/core/contract";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: readonly ApiIssue[] = [],
  ) {
    super(message);
  }

  /** The message for one field, when the server pointed at it. */
  issueFor(path: string): string | undefined {
    return this.issues.find((i) => i.path === path || i.path.startsWith(`${path}.`))?.message;
  }
}

export const NETWORK_MESSAGE =
  "서버에 연결할 수 없어요. 네트워크와 서버가 켜져 있는지 확인해 주세요";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface CallInput<N extends RouteName> {
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: QueryOf<N>;
  readonly body?: BodyOf<N>;
  readonly signal?: AbortSignal;
}

export interface ApiOptions {
  readonly baseUrl?: string;
  readonly fetch?: FetchLike;
  /** The name people gave, sent so the server knows whose experiment is whose (ADR-0028). */
  readonly user?: () => string | undefined;
}

export interface Api {
  call<N extends RouteName>(name: N, input?: CallInput<N>): Promise<Responses[N]>;
  /** An absolute or root-relative link to a route (downloads, share links, event streams). */
  url<N extends RouteName>(
    name: N,
    params?: Readonly<Record<string, string>>,
    query?: QueryOf<N>,
  ): string;
}

async function errorOf(response: Response): Promise<ApiError> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as unknown;
    if (isApiError(body))
      return new ApiError(
        response.status,
        body.error.code,
        body.error.message,
        body.error.issues ?? [],
      );
  } catch {
    // not JSON: fall through
  }
  return new ApiError(response.status, "http_error", `서버가 ${response.status}로 답했어요`);
}

export function createApi(options: ApiOptions = {}): Api {
  const base = (options.baseUrl ?? "").replace(/\/$/, "");
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const url: Api["url"] = (name, params = {}, query) =>
    `${base}${pathFor(name, params, query as Record<string, unknown> | undefined)}`;
  return {
    url,
    async call(name, input = {}) {
      const route = ROUTES[name];
      const user = options.user?.();
      const headers: Record<string, string> = { accept: "application/json" };
      if (user) headers["x-terrarium-user"] = encodeURIComponent(user);
      if (input.body !== undefined) headers["content-type"] = "application/json";
      let response: Response;
      try {
        response = await doFetch(url(name, input.params, input.query), {
          method: route.method,
          headers,
          ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        throw new ApiError(0, "network", NETWORK_MESSAGE);
      }
      if (!response.ok) throw await errorOf(response);
      return (
        route.produces === "json" ? await response.json() : await response.text()
      ) as Responses[typeof name];
    },
  };
}
