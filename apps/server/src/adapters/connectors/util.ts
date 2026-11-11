/** Small pieces the connectors share: waiting, filling templates, reading a value out of JSON. */
import type { AgentRunRequest, TelemetryAttachment } from "@terrarium/core/experiments";

export const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * The headers a run carries for telemetry (ADR-0085): all of the adapter's when it gave any (`traceparent`,
 * `x-terrarium-run-id`, `baggage`), else the `traceparent` alone.
 */
export const traceHeaders = (req: {
  readonly traceparent?: string;
  readonly telemetry?: TelemetryAttachment;
}): Readonly<Record<string, string>> =>
  req.telemetry?.headers ?? (req.traceparent ? { traceparent: req.traceparent } : {});

/** What a template can use, named the way the connector's help tells the person. */
export type Vars = Readonly<Record<string, string | number>>;

export function varsOf(req: AgentRunRequest, extra: Vars = {}): Vars {
  return {
    runId: req.runId,
    agentId: req.agentId,
    seed: req.seed,
    repeat: req.repeat ?? 1,
    prompt: req.prompt,
    mcpUrl: req.tools.mcpUrl ?? "",
    traceparent: req.traceparent ?? "",
    maxToolCalls: req.limits.maxToolCalls,
    timeLimitSeconds: req.limits.timeLimitSeconds,
    ...extra,
  };
}

const HOLE = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

/** Names a template uses that no variable provides. */
export function unknownNames(template: string, known: readonly string[]): string[] {
  return [...template.matchAll(HOLE)]
    .map((m) => m[1] as string)
    .filter((n, i, all) => !known.includes(n) && all.indexOf(n) === i);
}

/** A path or URL part: every value is made safe to sit in a URL. */
export function fillPath(template: string, vars: Vars): string {
  return template.replace(HOLE, (_, name: string) => encodeURIComponent(String(vars[name] ?? "")));
}

/** Text inside a JSON string: every value is escaped, so a prompt with quotes cannot break the document. */
export function fillJson(template: string, vars: Vars): string {
  return template.replace(HOLE, (_, name: string) =>
    JSON.stringify(String(vars[name] ?? "")).slice(1, -1),
  );
}

/** A plain argument or environment value: the text as it is. */
export function fillText(template: string, vars: Vars): string {
  return template.replace(HOLE, (_, name: string) => String(vars[name] ?? ""));
}

/** The value a JSON pointer ("/status", "/data/0/id") names, or undefined. */
export function pointerGet(value: unknown, pointer: string | undefined): unknown {
  if (!pointer) return value;
  let at: unknown = value;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

/** The first text of a response body, shortened for a message a person reads. */
export function snippet(text: string, max = 300): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** `https://host/path` + `/more` without doubled slashes. */
export const joinUrl = (base: string, path: string) =>
  `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

/**
 * Lets one job per key go at a time and queues the rest in the order they came (a job that throws does not
 * hold up the next). For harnesses whose setup belongs to an agent, not to a request.
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const before = this.tails.get(key) ?? Promise.resolve();
    const mine = before.then(job, job);
    const tail = mine.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return mine;
  }
}
