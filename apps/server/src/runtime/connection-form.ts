/**
 * What the connection screen and API send, turned into what is stored (REQ-051, ADR-0043): tokens, passwords
 * and secret headers sealed, the rest in the open; addresses checked; headers put on every request. These
 * are plain functions with no registry in them, so `Connections` is left with keeping and rebuilding.
 */
import type { ApiIssue, CheckConnectionRequest, ConnectorField } from "@terrarium/core/contract";
import {
  type ConnectionCheck,
  type ConnectionHeader,
  InvalidInputError,
} from "@terrarium/core/contract";
import type { ConnectionRecord, HarnessPort } from "@terrarium/core/experiments";
import type { Connector, FetchLike, SecretBox } from "../adapters";
import { NO_AGENTS, survey } from "./connection-agents";

export { within } from "./connection-agents";

/** Anything that describes a form: a connector, or a telemetry kind. */
export interface FormSource {
  readonly spec: { readonly fields: readonly ConnectorField[] };
}

export const problem = (path: string, message: string): ApiIssue => ({ path, message });

export function fail(issues: readonly ApiIssue[]): never {
  throw new InvalidInputError("연결 설정을 확인해 주세요", issues);
}

export const messageOf = (err: unknown): string =>
  err instanceof InvalidInputError
    ? err.issues.map((i) => i.message).join("; ")
    : err instanceof Error
      ? err.message
      : String(err);

/** Addresses a cloud answers with its credentials; no harness lives there. */
const METADATA_HOST = /^(169\.254\.\d{1,3}\.\d{1,3}|metadata\.google\.internal|fd00:ec2::254)$/;

/** Why a screen entry may not point at this address, if it may not. */
export function addressProblem(
  raw: string,
  allowed: readonly string[] | undefined,
): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "주소 형식이 맞지 않아요";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "http나 https 주소여야 해요";
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!allowed)
    return METADATA_HOST.test(host) ? "클라우드의 메타데이터 주소에는 연결할 수 없어요" : undefined;
  const ok = allowed.some((rule) => {
    const r = rule.toLowerCase();
    return r.startsWith("*.") ? host.endsWith(r.slice(1)) : host === r;
  });
  return ok ? undefined : `서버 설정(connections.allowedHosts)이 허용하지 않은 주소예요: ${host}`;
}

const IDENTITY = ["kind", "id", "name", "description"] as const;

/** Empty fields on a form mean "not given". */
export function given(settings: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(settings).filter(
      ([key, v]) => v !== "" && v !== undefined && v !== null && !IDENTITY.some((k) => k === key),
    ),
  );
}

export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** The metadata a config file entry carries: only text values count. */
export function metadataOf(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
}

/** Every request of a connection carries its custom headers; what the person typed beats the connector's own default. */
export function withHeaders(
  base: FetchLike,
  headers: ReadonlyArray<{ readonly name: string; readonly value: string }>,
): FetchLike {
  if (headers.length === 0) return base;
  return (url, init) => {
    const merged = new Headers(init.headers);
    for (const h of headers) merged.set(h.name, h.value);
    return base(url, { ...init, headers: merged });
  };
}

/** The headers of a record as the screen shows them: the values of secret ones are never returned. */
export const headerViews = (record: ConnectionRecord | undefined): ConnectionHeader[] =>
  (record?.headers ?? []).map((h) =>
    h.sealed === undefined
      ? { name: h.name, secret: false, ...(h.value === undefined ? {} : { value: h.value }) }
      : { name: h.name, secret: true },
  );

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|::1)$/;
const isLoopback = (host: string): boolean => LOOPBACK.test(host.replace(/^\[|\]$/g, ""));

function hostOf(raw: string): string | undefined {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** The harness fetches tools from Terrarium's address; if that is this very computer, a remote harness cannot. */
export function toolsNotes(
  connector: Connector,
  config: Readonly<Record<string, unknown>>,
  baseUrl: string | undefined,
): string[] {
  if (!baseUrl || connector.spec.toolTransport !== "mcp") return [];
  const mine = hostOf(baseUrl);
  if (!mine || !isLoopback(mine)) return [];
  const remote = connector.spec.fields
    .filter((f) => f.type === "url")
    .map((f) => config[f.key])
    .some((v) => typeof v === "string" && ((h) => h !== undefined && !isLoopback(h))(hostOf(v)));
  return remote
    ? [
        `테라리움의 툴 주소가 ${mine}(이 컴퓨터)라서, 다른 컴퓨터에 있는 이 연결은 툴을 못 받아요. 서버 설정의 publicUrl에 다른 곳에서도 연결되는 주소를 적어 주세요`,
      ]
    : [];
}

/** Connect and ask for the agents; the outcome is a report, never a throw. */
export async function probe(port: HarnessPort, timeoutMs: number): Promise<ConnectionCheck> {
  const started = Date.now();
  const canTalk = typeof port.talk === "function";
  try {
    const found = await survey(port, timeoutMs);
    return {
      ok: true,
      agents: found.agents,
      census: found.census,
      hiddenAgents: found.hiddenAgents,
      canTalk,
      ms: Date.now() - started,
      notes: found.census.total === 0 ? ["연결은 되지만 에이전트를 하나도 찾지 못했어요"] : [],
    };
  } catch (err) {
    return {
      ok: false,
      error: messageOf(err),
      agents: [],
      census: NO_AGENTS.census,
      hiddenAgents: [],
      canTalk,
      ms: Date.now() - started,
      notes: [],
    };
  }
}

/** What the form and the request give, split into what is stored in the open and what is sealed. */
export interface Composed {
  readonly config: Record<string, unknown>;
  readonly secrets: Record<string, string>;
  readonly headers: NonNullable<ConnectionRecord["headers"]>;
  /** Where its traces pile up, when the person said (ADR-0085). */
  readonly traces?: ConnectionRecord["traces"];
}

export interface Sealer {
  seal(text: string): string;
}

export interface Typed {
  readonly rest: Record<string, unknown>;
  readonly typed: ReadonlyMap<string, string>;
  readonly cleared: ReadonlySet<string>;
}

/** Pull the secret fields out of a form's values: typed, cleared with `null`, or left blank. */
export function splitSecrets(
  secretKeys: readonly string[],
  values: Readonly<Record<string, unknown>>,
  issues: ApiIssue[],
): Typed {
  const typed = new Map<string, string>();
  const cleared = new Set<string>();
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!secretKeys.includes(key)) rest[key] = value;
    else if (value === null) cleared.add(key);
    else if (typeof value === "string") {
      if (value !== "") typed.set(key, value);
    } else if (value !== undefined) issues.push(problem(key, "글자로 입력해 주세요"));
  }
  return { rest, typed, cleared };
}

/** A typed secret is sealed; a blank one stays as it was unless a server variable was named or it was cleared. */
export function sealSecrets(
  secretKeys: readonly string[],
  split: Typed,
  config: Readonly<Record<string, unknown>>,
  base: { readonly secrets?: Readonly<Record<string, string>> } | undefined,
  box: Sealer,
  issues: ApiIssue[],
): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const key of secretKeys) {
    const typedValue = split.typed.get(key);
    const named = config[`${key}Env`] !== undefined;
    const old = base?.secrets?.[key];
    if (typedValue !== undefined) {
      if (named)
        issues.push(
          problem(
            `${key}Env`,
            "비밀 값을 직접 입력했으면 환경 변수 이름은 비워 둬요. 둘 중 하나만 써요",
          ),
        );
      secrets[key] = box.seal(typedValue);
    } else if (old !== undefined && !named && !split.cleared.has(key)) {
      secrets[key] = old;
    }
  }
  return secrets;
}

type StoredHeaders = NonNullable<ConnectionRecord["headers"]>;

/** One header from the request: a secret without a value keeps the sealed value of the same name. */
function headerOf(
  h: NonNullable<CheckConnectionRequest["headers"]>[number],
  i: number,
  base: ConnectionRecord | undefined,
  box: Sealer,
  issues: ApiIssue[],
): StoredHeaders[number] | undefined {
  const at = `headers.${i}.value`;
  if (!h.secret) {
    if (h.value === undefined) issues.push(problem(at, "값을 입력해 주세요"));
    return h.value === undefined ? undefined : { name: h.name, value: h.value };
  }
  if (h.value !== undefined) return { name: h.name, sealed: box.seal(h.value) };
  const old = base?.headers?.find((o) => o.name.toLowerCase() === h.name.toLowerCase())?.sealed;
  if (old === undefined) issues.push(problem(at, "비밀 헤더는 값을 입력해 주세요"));
  return old === undefined ? undefined : { name: h.name, sealed: old };
}

/**
 * Split what was typed: tokens, passwords and secret headers are sealed, the rest stays readable. Against
 * `base` (changing a connection), a secret left blank stays as it was, naming a server variable instead
 * replaces it, and `null` removes it. Headers left out stay as they were.
 */
export function compose(
  connector: FormSource,
  input: {
    readonly config: Readonly<Record<string, unknown>>;
    readonly headers?: CheckConnectionRequest["headers"];
  },
  base: ConnectionRecord | undefined,
  box: Sealer,
): Composed {
  const issues: ApiIssue[] = [];
  const secretKeys = connector.spec.fields.filter((f) => f.type === "secret").map((f) => f.key);
  const split = splitSecrets(secretKeys, input.config, issues);
  const config = given(split.rest);
  const secrets = sealSecrets(secretKeys, split, config, base, box, issues);
  const headers: StoredHeaders =
    input.headers === undefined
      ? (base?.headers ?? [])
      : input.headers.flatMap((h, i) => headerOf(h, i, base, box, issues) ?? []);
  if (issues.length > 0) fail(issues);
  return { config, secrets, headers };
}

/** The record to store: empty parts are left out. */
export function recordOf(
  base: Pick<ConnectionRecord, "id" | "owner" | "createdAt" | "lastUsedAt">,
  fields: {
    readonly name: string;
    readonly description: string;
    readonly connector: string;
    readonly metadata: Readonly<Record<string, string>> | undefined;
  },
  composed: Composed,
): ConnectionRecord {
  const has = (o: object | undefined) => o !== undefined && Object.keys(o).length > 0;
  return {
    id: base.id,
    name: fields.name,
    ...(fields.description === "" ? {} : { description: fields.description }),
    connector: fields.connector,
    config: composed.config,
    ...(has(fields.metadata) ? { metadata: fields.metadata } : {}),
    ...(composed.headers.length > 0 ? { headers: composed.headers } : {}),
    ...(has(composed.secrets) ? { secrets: composed.secrets } : {}),
    ...(composed.traces ? { traces: composed.traces } : {}),
    owner: base.owner,
    createdAt: base.createdAt,
    ...(base.lastUsedAt ? { lastUsedAt: base.lastUsedAt } : {}),
  };
}

/** Secrets and headers as they are used: opened from the record. */
export function reveal(
  record: Pick<ConnectionRecord, "secrets" | "headers">,
  box: Pick<SecretBox, "open">,
): {
  readonly secrets: Record<string, string>;
  readonly headers: Array<{ readonly name: string; readonly value: string }>;
} {
  try {
    return {
      secrets: Object.fromEntries(
        Object.entries(record.secrets ?? {}).map(([k, v]) => [k, box.open(v)]),
      ),
      headers: (record.headers ?? []).map((h) => ({
        name: h.name,
        value: h.sealed === undefined ? (h.value ?? "") : box.open(h.sealed),
      })),
    };
  } catch {
    throw new Error(
      "저장해 둔 비밀 값을 읽지 못했어요. 서버의 암호 키(TERRARIUM_SECRET_KEY나 secret.key)가 바뀐 것 같아요. 연결을 고쳐서 비밀 값을 다시 넣어 주세요.",
    );
  }
}

/** Addresses must be allowed; secrets must be named variables the server really has. */
export function checkFields(
  connector: FormSource,
  values: Readonly<Record<string, unknown>>,
  env: Readonly<Record<string, string | undefined>>,
  allowedHosts: readonly string[] | undefined,
): void {
  const issues: ApiIssue[] = [];
  for (const field of connector.spec.fields) {
    const value = values[field.key];
    if (typeof value !== "string") continue;
    if (field.type === "url") {
      const why = addressProblem(value, allowedHosts);
      if (why) issues.push(problem(field.key, why));
    } else if (field.type === "env" && env[value] === undefined) {
      issues.push(problem(field.key, `서버에는 '${value}'라는 환경 변수가 없어요`));
    }
  }
  if (issues.length > 0) fail(issues);
}

/** The fixed tool address of a harness that reads its MCP servers from its own settings (empty for others). */
export function slotView(
  info: { readonly mcpSlot?: string | undefined },
  slotUrl: ((slot: string) => string) | undefined,
): { mcpSlotUrl?: string } {
  return info.mcpSlot && slotUrl ? { mcpSlotUrl: slotUrl(info.mcpSlot) } : {};
}
