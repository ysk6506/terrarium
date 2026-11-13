/**
 * Server configuration: one JSON file (TERRARIUM_CONFIG) plus secrets from the environment. Every
 * connection to the company's systems — harnesses, the knowledge graph, ClickStack — is named here,
 * so swapping a fake for the real thing is a config change, not a code change. Without a file the
 * server starts with the built-in scripted harness and the fictional sample graph only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { MetadataBody, parseWith } from "@terrarium/core/contract";
import { InvalidValueError, josa } from "@terrarium/core/kernel";
import { z } from "zod";
import { CONNECTORS, connectorOf } from "./connectors";
import { EnvName, Id, Url } from "./connectors/fields";
import { type IdentityConfig, IdentitySchema } from "./identity-config";
import { TELEMETRY_KINDS, telemetryKindOf } from "./telemetry";

/**
 * Where one harness's traces pile up (ADR-0085): `none`, `default` (the server's `telemetry`), or a telemetry
 * kind's own settings (`{"kind": "langfuse", "host": …}`). The kind checks the rest, so a new tool needs no change here.
 */
const TracesEntry = z
  .object({ kind: z.string() })
  .passthrough()
  .transform(({ kind, ...settings }, ctx) => {
    if (kind === "none" || kind === "default")
      return { kind, config: {} as Record<string, unknown> };
    const found = telemetryKindOf(kind);
    if (!found) {
      ctx.addIssue({
        code: "custom",
        path: ["kind"],
        message: `종류는 'none', 'default', ${TELEMETRY_KINDS.map((k) => `'${k.spec.kind}'`).join(", ")} 중 하나여야 해요`,
      });
      return z.NEVER;
    }
    const parsed = parseWith(found.schema, { ...settings, kind });
    if (parsed.ok) {
      const { kind: _, ...config } = parsed.value as Record<string, unknown>;
      return { kind, config };
    }
    for (const i of parsed.issues)
      ctx.addIssue({ code: "custom", path: i.path ? i.path.split(".") : [], message: i.message });
    return z.NEVER;
  });

/**
 * One harness or agent in the config file: its kind, an id and a name, then what that connector asks for.
 * The connector of that kind checks the rest (ADR-0042), so a new protocol needs no change here.
 */
const HarnessEntry = z
  .object({
    kind: z.string(),
    id: Id,
    name: z.string().optional(),
    metadata: MetadataBody.optional(),
    /** Where this harness's traces pile up; left out, the old rule (the server's default for a harness that says it emits traces). */
    traces: TracesEntry.optional(),
  })
  .passthrough()
  .transform(({ metadata, traces, ...entry }, ctx) => {
    const connector = connectorOf(entry.kind);
    if (!connector) {
      ctx.addIssue({
        code: "custom",
        path: ["kind"],
        message: `종류는 ${CONNECTORS.map((c) => `'${c.spec.kind}'`).join(", ")} 중 하나여야 해요`,
      });
      return z.NEVER;
    }
    const parsed = parseWith(connector.schema, entry);
    if (parsed.ok)
      return {
        ...(parsed.value as HarnessConfig),
        ...(metadata ? { metadata } : {}),
        ...(traces ? { traces } : {}),
      };
    for (const i of parsed.issues)
      ctx.addIssue({ code: "custom", path: i.path ? i.path.split(".") : [], message: i.message });
    return z.NEVER;
  });

const FalkorSource = z
  .object({
    kind: z.literal("falkordb"),
    id: Id,
    name: z.string(),
    /** falkor://host:port */
    url: z.string().regex(/^(falkors?|rediss?):\/\//),
    graph: z.string().default("cloud_topology"),
    usernameEnv: EnvName.optional(),
    passwordEnv: EnvName.optional(),
  })
  .strict();

const ClickStack = z
  .object({
    kind: z.literal("clickstack"),
    name: z.string().default("ClickStack"),
    /** ClickHouse HTTP interface, e.g. http://clickhouse:8123 */
    url: Url,
    database: z.string().default("default"),
    user: z.string().default("default"),
    passwordEnv: EnvName.optional(),
    tables: z
      .object({ traces: z.string().default("otel_traces"), logs: z.string().default("otel_logs") })
      .strict()
      .default({}),
  })
  .strict();

/** Scale-out (ADR-0032). Without `tokenEnv` the server is a single process, as before. */
const Cluster = z
  .object({
    /** all: this process does everything (and takes workers if a token is set); control: no sessions of its own; worker: runs sessions for a control plane. */
    role: z.enum(["all", "control", "worker"]).default("all"),
    /** Environment variable holding the shared secret between control plane and workers. */
    tokenEnv: EnvName.optional(),
    /** worker: where the control plane is. */
    controlUrl: Url.optional(),
    /** worker: where the control plane reaches this node (default: this host's name and port). */
    advertiseUrl: Url.optional(),
    nodeId: Id.optional(),
    /** Sessions one worker thread holds at once. Most of a run is waiting for the model. */
    sessionsPerThread: z.number().int().min(1).max(1024).default(32),
    /** control: slots a new worker brings, only for the nodes_wanted metric when no worker is known yet. */
    nodeSlots: z.number().int().min(1).max(100_000).optional(),
    heartbeatSeconds: z.number().min(1).max(60).default(5),
    /** control: a worker silent for this long is gone. */
    nodeTtlSeconds: z.number().min(3).max(600).default(20),
    /** worker: after SIGTERM, how long running sessions get to finish. */
    drainSeconds: z.number().int().min(0).max(86_400).default(600),
    /** worker: a session nobody has touched for this long is abandoned. */
    idleSeconds: z.number().int().min(30).max(86_400).default(3600),
  })
  .strict()
  .default({});

export const ConfigSchema = z
  .object({
    port: z.number().int().min(1).max(65535).default(8787),
    host: z.string().default("0.0.0.0"),
    /** How people reach the server; share links and harness MCP URLs are built from it. */
    publicUrl: Url.optional(),
    dataDir: z.string().default("data"),
    /** Who is asking and who administers: the company's SSO proxy, or typed names for local use (REQ-033, ADR-0174). */
    identity: IdentitySchema,
    workers: z.number().int().min(0).max(64).optional(),
    /** The shell of `run_command` (ADR-0200): `legacy` is the hand-written one (the default); `wasm` is the real shell and awk. */
    shell: z
      .object({ engine: z.enum(["legacy", "wasm"]).default("legacy") })
      .strict()
      .default({}),
    limits: z
      .object({
        maxRunning: z.number().int().min(1).max(512).optional(),
        perUser: z.number().int().min(1).max(512).optional(),
        perHarness: z.number().int().min(1).max(512).optional(),
        harness: z.record(z.number().int().min(1).max(512)).optional(),
      })
      .strict()
      .default({}),
    harnesses: z.array(HarnessEntry).default([]),
    /** Which hosts people may connect harnesses and agents to from the screen; without it every host but a cloud's metadata address. */
    connections: z
      .object({
        allowedHosts: z.array(z.string().min(1).max(200)).max(200).optional(),
        /** Days without an experiment after which a connection made on the screen is removed; 0 keeps them all. */
        retentionDays: z.number().int().min(0).max(3650).default(30),
        /** Days before removal that its owner is told (a banner on every page). */
        warnDays: z.number().int().min(1).max(365).default(7),
      })
      .strict()
      .default({}),
    /** The audit log (ADR-0193): entries older than this many days are removed by one background sweep, which writes an entry itself; 0 keeps them all. */
    audit: z
      .object({
        retentionDays: z.number().int().min(0).max(36500).default(365),
        /** Lines per minute, all together, that failures before sign-in may write; the rest are only counted (ADR-0193). */
        preAuthLinesPerMinute: z.number().int().min(1).max(10000).default(60),
      })
      .strict()
      .default({}),
    sources: z.array(FalkorSource).default([]),
    telemetry: ClickStack.optional(),
    cluster: Cluster,
  })
  .strict();

/** A harness entry after its connector has checked it: flat, with the connector's own settings. */
export interface HarnessConfig {
  readonly kind: string;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly [setting: string]: unknown;
}

export type { IdentityConfig };
export type Config = z.output<typeof ConfigSchema>;
export type { HttpHarnessConfig } from "./connectors/harness-http";
export type FalkorSourceConfig = z.output<typeof FalkorSource>;
export type ClickStackConfig = z.output<typeof ClickStack>;

/** The built-in harness is always there, so a fresh server can run an experiment at once. */
export const BUILTIN_HARNESS_ID = "builtin";

/** Why a cluster block cannot work, in words that say what to add. */
export function clusterProblem(c: Config["cluster"]): string | undefined {
  if (c.role !== "all" && !c.tokenEnv)
    return `역할 ${c.role}에는 tokenEnv(토큰이 든 환경 변수 이름)가 필요해요`;
  if (c.role === "worker" && !c.controlUrl) return "역할 worker에는 controlUrl이 필요해요";
  if (c.role !== "worker" && c.controlUrl) return "controlUrl은 역할 worker에만 써요";
  if (c.nodeTtlSeconds <= c.heartbeatSeconds * 2)
    return "nodeTtlSeconds는 heartbeatSeconds의 두 배보다 커야 해요 (한 번 놓쳐도 노드가 사라지면 안 돼요)";
  return undefined;
}

/** Deployment systems set the role and addresses with environment variables; they win over the file. */
function withClusterEnv(
  raw: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const wanted = {
    role: env.TERRARIUM_ROLE,
    controlUrl: env.TERRARIUM_CONTROL_URL,
    advertiseUrl: env.TERRARIUM_ADVERTISE_URL,
    nodeId: env.TERRARIUM_NODE_ID,
    tokenEnv: env.TERRARIUM_CLUSTER_TOKEN_ENV,
  };
  const set = Object.fromEntries(Object.entries(wanted).filter(([, v]) => v));
  if (Object.keys(set).length === 0) return raw;
  return { ...raw, cluster: { ...(raw.cluster as object | undefined), ...set } };
}

export function parseConfig(raw: unknown, origin = "설정"): Config {
  const parsed = parseWith(ConfigSchema, raw);
  if (!parsed.ok)
    throw new InvalidValueError(
      `${origin}${josa(origin, "이")} 올바르지 않아요: ${parsed.issues.map((i) => `${i.path || "(전체)"} ${i.message}`).join("; ")}`,
    );
  const config = parsed.value;
  const wrong = clusterProblem(config.cluster);
  if (wrong) throw new InvalidValueError(`${origin}: cluster ${wrong}`);
  const ids = config.harnesses.map((h) => h.id);
  if (new Set(ids).size !== ids.length)
    throw new InvalidValueError(`${origin}: 하네스 id가 겹쳐요`);
  const withBuiltin = ids.includes(BUILTIN_HARNESS_ID)
    ? config.harnesses
    : [
        { kind: "scripted", id: BUILTIN_HARNESS_ID, name: "내장 기준 에이전트", description: "" },
        ...config.harnesses,
      ];
  return { ...config, harnesses: withBuiltin };
}

/** Read the config file named by TERRARIUM_CONFIG (none: defaults). Relative paths are relative to the file. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const file = env.TERRARIUM_CONFIG;
  if (!file) return parseConfig(withClusterEnv({}, env), "기본 설정");
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const config = parseConfig(withClusterEnv(raw, env), file);
  return { ...config, dataDir: path.resolve(path.dirname(file), config.dataDir) };
}

export { secret } from "./secret";
