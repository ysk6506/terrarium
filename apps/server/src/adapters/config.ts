/**
 * Server configuration: one JSON file (TERRARIUM_CONFIG) plus secrets from the environment. Every
 * connection to the company's systems — harnesses, the knowledge graph, ClickStack — is named here,
 * so swapping a fake for the real thing is a config change, not a code change. Without a file the
 * server starts with the built-in scripted harness and the fictional sample graph only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseWith } from "@terrarium/core/contract";
import { InvalidValueError, josa } from "@terrarium/core/kernel";
import { z } from "zod";

const Id = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);
const Url = z.string().url();
/** Name of an environment variable that holds a secret; the secret itself never sits in the file. */
const EnvName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);

const ScriptedHarness = z
  .object({ kind: z.literal("scripted"), id: Id, name: z.string().default("내장 기준 에이전트") })
  .strict();

const OpenAiHarness = z
  .object({
    kind: z.literal("openai"),
    id: Id,
    name: z.string(),
    description: z.string().default(""),
    /** OpenAI-compatible endpoint, e.g. an internal LiteLLM or vLLM gateway (…/v1). */
    baseUrl: Url,
    apiKeyEnv: EnvName.optional(),
    models: z
      .array(
        z
          .object({
            id: Id,
            model: z.string(),
            name: z.string().optional(),
            description: z.string().optional(),
            temperature: z.number().min(0).max(2).optional(),
          })
          .strict(),
      )
      .min(1),
    /** Model turns before the loop gives up (each turn may call several tools). */
    maxTurns: z.number().int().min(1).max(200).default(40),
    requestTimeoutSeconds: z.number().int().min(5).max(600).default(120),
  })
  .strict();

const HttpHarness = z
  .object({
    kind: z.literal("http"),
    id: Id,
    name: z.string(),
    description: z.string().default(""),
    /** Base URL of a harness speaking the Terrarium harness protocol (docs/design-docs/harness-protocol.md). */
    url: Url,
    tokenEnv: EnvName.optional(),
    telemetry: z.enum(["clickstack", "none"]).default("none"),
    pollSeconds: z.number().min(0.05).max(60).default(2),
  })
  .strict();

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
    /** Header a company SSO proxy sets with the signed-in user (REQ-033). */
    identity: z.object({ header: z.string().toLowerCase().optional() }).strict().default({}),
    workers: z.number().int().min(0).max(64).optional(),
    limits: z
      .object({
        maxRunning: z.number().int().min(1).max(512).optional(),
        perUser: z.number().int().min(1).max(512).optional(),
        perHarness: z.number().int().min(1).max(512).optional(),
        harness: z.record(z.number().int().min(1).max(512)).optional(),
      })
      .strict()
      .default({}),
    harnesses: z
      .array(z.discriminatedUnion("kind", [ScriptedHarness, OpenAiHarness, HttpHarness]))
      .default([]),
    sources: z.array(FalkorSource).default([]),
    telemetry: ClickStack.optional(),
    cluster: Cluster,
  })
  .strict();

export type Config = z.output<typeof ConfigSchema>;
export type HarnessConfig = Config["harnesses"][number];
export type OpenAiHarnessConfig = z.output<typeof OpenAiHarness>;
export type HttpHarnessConfig = z.output<typeof HttpHarness>;
export type FalkorSourceConfig = z.output<typeof FalkorSource>;
export type ClickStackConfig = z.output<typeof ClickStack>;

/** The built-in harness is always there, so a fresh server can run an experiment at once. */
export const BUILTIN_HARNESS_ID = "builtin";

/** Why a cluster block cannot work, in words that say what to add. */
export function clusterProblem(c: Config["cluster"]): string | undefined {
  if (c.role !== "all" && !c.tokenEnv)
    return `역할 ${c.role}에는 tokenEnv(토큰이 든 환경 변수 이름)가 필요하다`;
  if (c.role === "worker" && !c.controlUrl) return "역할 worker에는 controlUrl이 필요하다";
  if (c.role !== "worker" && c.controlUrl) return "controlUrl은 역할 worker에만 쓴다";
  if (c.nodeTtlSeconds <= c.heartbeatSeconds * 2)
    return "nodeTtlSeconds는 heartbeatSeconds의 두 배보다 커야 한다 (한 번 놓쳐도 노드가 사라지면 안 된다)";
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
      `${origin}${josa(origin, "이")} 올바르지 않다: ${parsed.issues.map((i) => `${i.path || "(전체)"} ${i.message}`).join("; ")}`,
    );
  const config = parsed.value;
  const wrong = clusterProblem(config.cluster);
  if (wrong) throw new InvalidValueError(`${origin}: cluster ${wrong}`);
  const ids = config.harnesses.map((h) => h.id);
  if (new Set(ids).size !== ids.length)
    throw new InvalidValueError(`${origin}: 하네스 id가 겹친다`);
  const withBuiltin = ids.includes(BUILTIN_HARNESS_ID)
    ? config.harnesses
    : [
        { kind: "scripted" as const, id: BUILTIN_HARNESS_ID, name: "내장 기준 에이전트" },
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

/** A secret from the environment, or an error that says which variable to set. */
export function secret(env: NodeJS.ProcessEnv, name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const value = env[name];
  if (value === undefined || value === "")
    throw new InvalidValueError(
      `환경 변수 ${name}${josa(name, "이")} 비어 있다 (설정 파일이 이 이름을 가리킨다)`,
    );
  return value;
}
