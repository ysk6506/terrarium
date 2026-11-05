/** Request bodies and query strings of the HTTP API (REQ-030~040). */
import { z } from "zod";
import {
  BlueprintSchema,
  IdSchema,
  NameSchema,
  NoteSchema,
  ProfilesSchema,
  ScenarioDocSchema,
  SeedsSchema,
  TimePolicySchema,
  ToolsSchema,
  WorldgenSpecSchema,
} from "./schemas";

/** Query strings arrive as text; numbers are converted, blanks are treated as absent. */
const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);
const QueryId = z.preprocess(blankToUndefined, IdSchema.optional());
const QueryText = z.preprocess(blankToUndefined, z.string().max(200).optional());
const QueryInt = (min: number, max: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).optional());

/** `name=value` pairs people attach to tell results apart (REQ-052): few, short, and plain. */
export const MetadataBody = z
  .record(
    z.string().regex(/^[\p{L}\p{N}._-]{1,40}$/u, "이름은 글자·숫자·._-로 40자까지 써요"),
    z.string().trim().min(1).max(200),
  )
  .refine((m) => Object.keys(m).length <= 20, { message: "메타데이터는 20개까지 붙여요" });

// ── worlds ───────────────────────────────────────────────────────────────────────────────────

export const CreateWorldBody = z.object({ name: NameSchema, blueprint: BlueprintSchema }).strict();

export const GenerateWorldBody = z
  .object({ name: NameSchema.optional(), spec: WorldgenSpecSchema })
  .strict();

export const ImportWorldBody = z
  .object({
    /** A configured reality source, e.g. "cloud_topology" (FalkorDB) or "sample". */
    source: IdSchema,
    name: NameSchema.optional(),
    siteName: NameSchema.optional(),
    rooms: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    maxEntities: z.number().int().min(100).max(100_000).optional(),
    assume: z
      .object({ power: z.boolean().optional(), cooling: z.boolean().optional() })
      .strict()
      .optional(),
  })
  .strict();

/** Saves are optimistic: `baseDigest` is the version the editor started from. */
export const UpdateWorldBody = z
  .object({
    baseDigest: z.string().min(1).max(64),
    name: NameSchema.optional(),
    blueprint: BlueprintSchema.optional(),
  })
  .strict()
  .refine((b) => b.name !== undefined || b.blueprint !== undefined, {
    message: "바꿀 이름이나 세계가 없어요",
  });

// ── scenarios ────────────────────────────────────────────────────────────────────────────────

export const ScenarioQuery = z.object({ worldId: QueryId }).strict();

export const CreateScenarioBody = z.union([
  z.object({ worldId: IdSchema, templateId: IdSchema, name: NameSchema.optional() }).strict(),
  z.object({ worldId: IdSchema, doc: ScenarioDocSchema, name: NameSchema.optional() }).strict(),
  z.object({ worldId: IdSchema, name: NameSchema.optional() }).strict(),
]);

export const UpdateScenarioBody = z
  .object({
    baseDigest: z.string().min(1).max(64),
    name: NameSchema.optional(),
    doc: ScenarioDocSchema.optional(),
  })
  .strict()
  .refine((b) => b.name !== undefined || b.doc !== undefined, {
    message: "바꿀 이름이나 시나리오가 없어요",
  });

/** Run the scenario with no agent, to see what it does to the world (editor preview). */
export const DryRunBody = z
  .object({
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 31 - 1)
      .default(1),
  })
  .strict();

// ── experiments ──────────────────────────────────────────────────────────────────────────────

export const RecipeBody = z
  .object({
    worldId: IdSchema,
    scenarioId: IdSchema,
    harnessId: IdSchema,
    agentId: IdSchema,
    tools: ToolsSchema,
    /** Either explicit seeds or a number of runs (seeds 1..n, comparable across people). */
    seeds: SeedsSchema.optional(),
    runs: z.number().int().min(1).max(20).optional(),
    time: TimePolicySchema.optional(),
    profiles: ProfilesSchema.optional(),
  })
  .strict()
  .refine((r) => !(r.seeds && r.runs), {
    message: "시드 목록과 실행 횟수 중 하나만 정해요",
    path: ["runs"],
  });

export const CreateExperimentBody = z
  .object({
    name: NameSchema,
    recipe: RecipeBody,
    note: NoteSchema.optional(),
    metadata: MetadataBody.optional(),
  })
  .strict();

/** Fork: the parent's recipe with these fields changed (REQ-040). */
export const ForkBody = z
  .object({
    change: z
      .object({
        worldId: IdSchema.optional(),
        scenarioId: IdSchema.optional(),
        harnessId: IdSchema.optional(),
        agentId: IdSchema.optional(),
        tools: ToolsSchema.optional(),
        seeds: SeedsSchema.optional(),
        time: TimePolicySchema.optional(),
        profiles: ProfilesSchema.optional(),
      })
      .strict(),
    name: NameSchema.optional(),
    note: NoteSchema.optional(),
    /** Replaces the parent's; left out, the fork keeps them. */
    metadata: MetadataBody.optional(),
  })
  .strict();

export const AddRunsBody = z
  .object({ count: z.number().int().min(1).max(20).optional(), seeds: SeedsSchema.optional() })
  .strict()
  .refine((b) => (b.count === undefined) !== (b.seeds === undefined), {
    message: "더할 실행 횟수나 시드 중 하나를 정해요",
  });

export const EXPERIMENT_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export const ExperimentQuery = z
  .object({
    owner: QueryText,
    worldId: QueryId,
    scenarioId: QueryId,
    benchmarkKey: QueryText,
    parentId: QueryId,
    status: z.preprocess(blankToUndefined, z.enum(EXPERIMENT_STATUSES).optional()),
    /** Words in the name or note. */
    q: QueryText,
    /** `name=value` (or just `name`): metadata the experiment, or the connection it ran on, carries (REQ-052). */
    meta: QueryText,
    limit: QueryInt(1, 200),
  })
  .strict();

export const ReportQuery = z
  .object({
    format: z.preprocess(blankToUndefined, z.enum(["html", "md", "text"]).default("html")),
  })
  .strict();

// ── leaderboards, sharing, twin ──────────────────────────────────────────────────────────────

export const LeaderboardQuery = z
  .object({ worldId: QueryId, scenarioId: QueryId, minRuns: QueryInt(1, 50) })
  .strict();

export const CreateShareBody = z
  .object({ expiresInDays: z.number().int().min(1).max(365).optional() })
  .strict();

export const TwinQuery = z
  .object({
    worldId: QueryId,
    scenarioId: QueryId,
    harnessId: QueryId,
    agentId: QueryId,
    owner: QueryText,
  })
  .strict();

export type CreateWorldRequest = z.infer<typeof CreateWorldBody>;
export type GenerateWorldRequest = z.infer<typeof GenerateWorldBody>;
export type ImportWorldRequest = z.infer<typeof ImportWorldBody>;
export type UpdateWorldRequest = z.infer<typeof UpdateWorldBody>;
export type CreateScenarioRequest = z.infer<typeof CreateScenarioBody>;
export type UpdateScenarioRequest = z.infer<typeof UpdateScenarioBody>;
export type DryRunRequest = z.input<typeof DryRunBody>;
export type RecipeRequest = z.infer<typeof RecipeBody>;
export type CreateExperimentRequest = z.infer<typeof CreateExperimentBody>;
export type ForkRequest = z.infer<typeof ForkBody>;
export type AddRunsRequest = z.infer<typeof AddRunsBody>;
export type ExperimentQueryParams = z.infer<typeof ExperimentQuery>;
export type LeaderboardQueryParams = z.infer<typeof LeaderboardQuery>;
export type CreateShareRequest = z.infer<typeof CreateShareBody>;
export type TwinQueryParams = z.infer<typeof TwinQuery>;

// ── connections (REQ-051) ────────────────────────────────────────────────────────────────────

const ConnectionConfig = z.record(z.string().max(80), z.unknown());

/** Not for the sender to choose: the HTTP stack sets these, and a wrong one breaks the request. */
const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "keep-alive",
  "expect",
  "proxy-authorization",
  "proxy-connection",
]);

export const HeaderBody = z
  .object({
    name: z
      .string()
      .regex(
        /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,60}$/,
        "헤더 이름은 영문·숫자·-_ 같은 기호로 60자까지 써요",
      )
      .refine((n) => !FORBIDDEN_HEADERS.has(n.toLowerCase()), {
        message: "이 헤더는 정할 수 없어요",
      }),
    /** Left out for a secret header that is already kept (when changing a connection). */
    value: z
      .string()
      .min(1)
      .max(2000)
      .regex(/^[^\r\n\0]*$/, "줄바꿈은 쓸 수 없어요")
      .optional(),
    secret: z.boolean().default(false),
  })
  .strict();

const HeadersBody = z
  .array(HeaderBody)
  .max(20)
  .refine((h) => new Set(h.map((x) => x.name.toLowerCase())).size === h.length, {
    message: "같은 헤더 이름이 겹쳐요",
  });

export const CheckConnectionBody = z
  .object({
    connector: IdSchema,
    /** Trying a change to this connection (its owner only): secrets left blank are the ones it keeps. */
    id: IdSchema.optional(),
    config: ConnectionConfig,
    headers: HeadersBody.optional(),
  })
  .strict();

export const CreateConnectionBody = z
  .object({
    connector: IdSchema,
    /** Left out, it is made from the name. */
    id: IdSchema.optional(),
    name: NameSchema,
    description: z.string().trim().max(300).optional(),
    config: ConnectionConfig,
    /** Sent with every request to it. */
    headers: HeadersBody.optional(),
    /** Attached to every experiment run on it (REQ-052). */
    metadata: MetadataBody.optional(),
  })
  .strict();

/**
 * Changing a connection: everything but its kind and id. A token or password left blank stays as it was;
 * naming a server variable instead replaces it; `null` removes it. The same goes for a secret header sent
 * without a value.
 */
export const UpdateConnectionBody = z
  .object({
    name: NameSchema.optional(),
    description: z.string().trim().max(300).optional(),
    config: ConnectionConfig,
    headers: HeadersBody.optional(),
    metadata: MetadataBody.optional(),
  })
  .strict();

/** A version a person adds to an agent (REQ-053): a name, a note, and what they know that Terrarium cannot see. */
export const AddAgentVersionBody = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    note: z.string().trim().min(1).max(500).optional(),
    /** Replaces the attributes of the version before; left out, they carry on. */
    attributes: MetadataBody.optional(),
  })
  .strict();

/** Changing a version: name it, annotate it, re-tag it. `null` removes a label or a note. */
export const EditAgentVersionBody = z
  .object({
    label: z.string().trim().min(1).max(60).nullable().optional(),
    note: z.string().trim().min(1).max(500).nullable().optional(),
    attributes: MetadataBody.optional(),
  })
  .strict();

export type AddAgentVersionRequest = z.output<typeof AddAgentVersionBody>;
export type EditAgentVersionRequest = z.output<typeof EditAgentVersionBody>;
export type CreateConnectionRequest = z.output<typeof CreateConnectionBody>;
export type UpdateConnectionRequest = z.output<typeof UpdateConnectionBody>;
export type CheckConnectionRequest = z.output<typeof CheckConnectionBody>;
export type HeaderRequest = z.output<typeof HeaderBody>;
