/** A small JSON-over-HTTP caller the harness adapters share: one base address, fixed headers, errors in words. */
import type { FetchLike } from "../fetch";
import { joinUrl, snippet } from "./util";

export class Rest {
  constructor(
    private readonly base: string,
    private readonly headers: Readonly<Record<string, string>>,
    private readonly fetchImpl: FetchLike,
  ) {}

  send(
    method: string,
    path: string,
    signal: AbortSignal,
    body?: unknown,
    extra: Readonly<Record<string, string>> = {},
  ): Promise<Response> {
    return this.fetchImpl(joinUrl(this.base, path), {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...this.headers,
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
  }

  /** The JSON of an answer that went well. Anything else is an error that says what was asked and what came back. */
  async json<T>(
    what: string,
    method: string,
    path: string,
    signal: AbortSignal,
    body?: unknown,
    extra?: Readonly<Record<string, string>>,
  ): Promise<T> {
    const r = await this.send(method, path, signal, body, extra);
    const text = await r.text();
    if (!r.ok) throw new Error(`${what}에 ${r.status}로 답했어요: ${snippet(text)}`);
    if (text === "") return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`${what}의 답이 JSON이 아니에요: ${snippet(text)}`);
    }
  }
}
