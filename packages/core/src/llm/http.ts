/** What both adapters share: building addresses, one request with a time limit, and turning failures into `LlmError`. */
import {
  DEFAULT_TIMEOUT_MS,
  type FetchLike,
  type LlmClientOptions,
  LlmError,
  type LlmFailReason,
} from "./types";

/** `base` + `path`, where a base that already ends in `/v1` is not doubled and `/v1` is dropped for paths outside it. */
export function joinUrl(base: string, path: string): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  const versioned = /\/v1$/.test(trimmed);
  if (path.startsWith("/v1/")) return versioned ? trimmed + path.slice(3) : trimmed + path;
  return (versioned ? trimmed.slice(0, -3) : trimmed) + path;
}

const REASONS: Readonly<Record<number, LlmFailReason>> = { 401: "auth", 403: "auth", 429: "rate" };

export function reasonOfStatus(status: number): LlmFailReason {
  if (REASONS[status]) return REASONS[status];
  if (status === 404) return "address";
  return status >= 500 ? "server" : "other";
}

const NAME_ERRORS = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|Invalid URL|ERR_INVALID_URL/;

/** What `fetch` threw, as a reason. Node puts the cause (ENOTFOUND, ...) one level down. */
function reasonOfThrown(err: unknown, timedOut: boolean): LlmFailReason {
  if (timedOut) return "timeout";
  const text = [err, (err as { cause?: unknown } | null)?.cause]
    .map(
      (e) => `${(e as { code?: string } | null)?.code ?? ""} ${(e as Error | null)?.message ?? ""}`,
    )
    .join(" ");
  return NAME_ERRORS.test(text) ? "address" : "network";
}

/** The words for a failure. Never carries the upstream's own text: it could echo a key. */
export function failureText(reason: LlmFailReason, status?: number, timeoutMs?: number): string {
  const code = status ? ` (${status})` : "";
  switch (reason) {
    case "address":
      return status
        ? `그 주소에 해당 경로가 없어요${code}. 주소 끝이 /v1 인지 확인해 보세요`
        : "주소를 찾지 못했어요. 주소를 다시 확인해 주세요";
    case "network":
      return "서버가 이 주소로 나가지 못했어요. 서버의 네트워크(방화벽·프록시)를 확인해 주세요";
    case "auth":
      return `키를 받아 주지 않았어요${code}. 키와 헤더를 다시 확인해 주세요`;
    case "timeout":
      return `${Math.round((timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}초 안에 답이 오지 않았어요`;
    case "no-models":
      return "모델 목록을 받지 못했어요. 기본 모델 이름을 적으면 짧은 호출로 확인해요";
    case "rate":
      return `요청이 너무 많다고 답했어요${code}. 잠시 뒤에 다시 확인해 주세요`;
    case "server":
      return `상대 서버가 오류로 답했어요${code}`;
    default:
      return `예상하지 못한 답이 왔어요${code}`;
  }
}

export interface Requester {
  /** One request; resolves to the parsed JSON body of a 2xx answer. */
  json(method: "GET" | "POST", url: string, body?: unknown): Promise<unknown>;
}

/** Sends requests with the options' headers and time limit. `defaults` are the protocol's own headers. */
export function requester(
  options: LlmClientOptions,
  defaults: Readonly<Record<string, string>>,
): Requester {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = { accept: "application/json", ...defaults, ...options.headers };
  return {
    async json(method, url, body) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const res = await doFetch(url, {
          method,
          headers:
            body === undefined ? headers : { ...headers, "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const reason = reasonOfStatus(res.status);
          throw new LlmError(reason, failureText(reason, res.status, timeoutMs), res.status);
        }
        return await res.json();
      } catch (err) {
        if (err instanceof LlmError) throw err;
        if ((err as Error)?.name === "SyntaxError")
          throw new LlmError("other", failureText("other"));
        const why = reasonOfThrown(err, timedOut);
        throw new LlmError(why, failureText(why, undefined, timeoutMs));
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
