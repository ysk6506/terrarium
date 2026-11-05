/**
 * Where a connection's traces pile up (REQ-079, ADR-0085): the choice made on the form turned into what is
 * stored (secrets sealed, settings checked) and into the adapter that attaches a run and reads it back.
 */
import type { TelemetryAdapter } from "@terrarium/core/analysis";
import {
  type ApiIssue,
  type ConnectionTraces,
  InvalidInputError,
  parseWith,
  type TelemetryAdapterList,
  type TracesRequest,
} from "@terrarium/core/contract";
import type { ConnectionRecord } from "@terrarium/core/experiments";
import {
  type ConnectContext,
  type SecretBox,
  TELEMETRY_KINDS,
  type TelemetryKind,
  telemetryKindOf,
} from "../adapters";
import {
  checkFields,
  fail,
  given,
  problem,
  reveal,
  sealSecrets,
  splitSecrets,
} from "./connection-form";

export type Traces = NonNullable<ConnectionRecord["traces"]>;

/** Choices that are not a tool: no traces, or the server's own default. */
const isTool = (kind: string): boolean => kind !== "none" && kind !== "default";

export function adapterList(serverDefault: TelemetryAdapter | undefined): TelemetryAdapterList {
  return {
    adapters: TELEMETRY_KINDS.map((k) => k.spec),
    ...(serverDefault
      ? { serverDefault: { kind: serverDefault.kind, name: serverDefault.name } }
      : {}),
  };
}

function kindOf(kind: string): TelemetryKind {
  const found = telemetryKindOf(kind);
  return found ?? fail([problem("traces.kind", `트레이스를 쌓는 곳 '${kind}'을 몰라요`)]);
}

const under = (issues: readonly ApiIssue[]): ApiIssue[] =>
  issues.map((i) => problem(i.path ? `traces.${i.path}` : "traces", i.message));

/**
 * The choice as it is stored. Left out of a change, it stays as it was. Against the one already kept, a
 * secret left blank stays, naming a server variable replaces it, `null` removes it.
 */
export function composeTraces(
  input: TracesRequest | undefined,
  base: Traces | undefined,
  box: Pick<SecretBox, "seal">,
  env: Readonly<Record<string, string | undefined>>,
  allowedHosts: readonly string[] | undefined,
): Traces | undefined {
  if (input === undefined) return base;
  if (!isTool(input.kind)) return { kind: input.kind, config: {} };
  const kind = kindOf(input.kind);
  const keys = kind.spec.fields.filter((f) => f.type === "secret").map((f) => f.key);
  const issues: ApiIssue[] = [];
  const split = splitSecrets(keys, input.config, issues);
  const config = given(split.rest);
  const kept = base?.kind === input.kind ? base : undefined;
  const secrets = sealSecrets(keys, split, config, kept, box, issues);
  if (issues.length > 0) fail(under(issues));
  const parsed = parseWith(kind.schema, { ...config, kind: input.kind });
  if (!parsed.ok) fail(under(parsed.issues.map((i) => problem(i.path ?? "", i.message))));
  try {
    checkFields(kind, parsed.value as Record<string, unknown>, env, allowedHosts);
  } catch (err) {
    if (err instanceof InvalidInputError) fail(under(err.issues));
    throw err;
  }
  return { kind: input.kind, config, ...(Object.keys(secrets).length > 0 ? { secrets } : {}) };
}

/** The adapter a stored choice stands for. `none` and `default` stand for none here; the caller knows its default. */
export function adapterOf(
  traces: Traces | undefined,
  ctx: ConnectContext,
  box: Pick<SecretBox, "open">,
): TelemetryAdapter | undefined {
  if (!traces || !isTool(traces.kind)) return undefined;
  const kind = kindOf(traces.kind);
  const parsed = parseWith(kind.schema, { ...given(traces.config), kind: traces.kind });
  if (!parsed.ok) fail(under(parsed.issues.map((i) => problem(i.path ?? "", i.message))));
  const { secrets } = reveal({ secrets: traces.secrets }, box);
  return kind.create(parsed.value, {
    ...ctx,
    ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
  });
}

/** What the screen shows of the choice, with no secret in it. */
export function tracesView(
  traces: Traces | undefined,
  adapter: TelemetryAdapter | undefined,
): ConnectionTraces {
  return {
    kind: traces?.kind ?? (adapter ? "default" : "none"),
    ...(adapter ? { name: adapter.name } : {}),
    config: traces?.config ?? {},
    secrets: Object.keys(traces?.secrets ?? {}),
  };
}

/** Whether the tool answers: asks for a run that does not exist. A note when it does not. */
export async function reachNote(adapter: TelemetryAdapter): Promise<string | undefined> {
  try {
    await adapter.fetch("terrarium-check");
    return undefined;
  } catch (err) {
    return `${adapter.name}에 연결하지 못했어요: ${(err as Error).message}`;
  }
}
