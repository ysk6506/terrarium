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
    message: "바꿀 이름이나 세계가 없다",
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
    message: "바꿀 이름이나 시나리오가 없다",
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
    message: "시드 목록과 실행 횟수 중 하나만 정한다",
    path: ["runs"],
  });

export const CreateExperimentBody = z
  .object({ name: NameSchema, recipe: RecipeBody, note: NoteSchema.optional() })
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
  })
  .strict();

export const AddRunsBody = z
  .object({ count: z.number().int().min(1).max(20).optional(), seeds: SeedsSchema.optional() })
  .strict()
  .refine((b) => (b.count === undefined) !== (b.seeds === undefined), {
    message: "추가할 실행 횟수나 시드 중 하나를 정한다",
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
