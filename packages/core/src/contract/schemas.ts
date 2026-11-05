/**
 * Shapes of what crosses the wire. These check structure (types, enums, sizes); meaning — does this
 * parent exist, can this scenario reach its agent task — is checked by the owning unit's validator,
 * which the server runs right after (world/validate, scenario/validate, worldgen specProblems).
 */
import { MAX_SEEDS } from "@terrarium/core/experiments";
import {
  ACTION_KINDS,
  COMPARE_OPS,
  type Condition,
  type Expectation,
  SCENARIO_SCHEMA_VERSION,
  type ScenarioDoc,
} from "@terrarium/core/scenario";
import type { TimePolicy } from "@terrarium/core/session";
import {
  CHOICE_LABELS,
  SITE_PRESETS,
  specProblems,
  type WorldgenSpec,
} from "@terrarium/core/sources/worldgen";
import {
  BLUEPRINT_SCHEMA_VERSION,
  type Blueprint,
  ENTITY_KINDS,
  LINK_RULES,
  type LinkKind,
} from "@terrarium/core/world";
import { z } from "zod";

/** Server-made ids: letters, digits and . _ : - (no spaces, no slashes). */
export const IdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
/** Names people type; trimmed, never empty. */
export const NameSchema = z.string().trim().min(1).max(80);
export const NoteSchema = z.string().trim().max(2000);

export const MAX_ENTITIES = 100_000;
export const MAX_LINKS = 200_000;

const PropValue = z.union([z.string().max(2000), z.number().finite(), z.boolean()]);
const Props = z.record(z.string().max(100), PropValue);
const Rotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
const Metres = z.number().finite().min(-100_000).max(100_000);

const PlacementSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("land"), w: Metres.positive(), d: Metres.positive() }).strict(),
  z
    .object({
      type: z.literal("area"),
      x: Metres,
      y: Metres,
      w: Metres.positive(),
      d: Metres.positive(),
      pieces: z
        .array(
          z.object({ x: Metres, y: Metres, w: Metres.positive(), d: Metres.positive() }).strict(),
        )
        .max(32)
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("level"),
      level: z.number().int().min(-10).max(200),
      height: Metres.positive(),
    })
    .strict(),
  z.object({ type: z.literal("spot"), x: Metres, y: Metres, rotation: Rotation }).strict(),
  z.object({ type: z.literal("unit"), u: z.number().int().min(1).max(60) }).strict(),
]);

const EntitySchema = z
  .object({
    id: IdSchema,
    kind: z.enum(ENTITY_KINDS as [string, ...string[]]),
    name: z.string().max(200),
    parentId: IdSchema.optional(),
    modelId: z.string().max(128).optional(),
    placement: PlacementSchema.optional(),
    props: Props,
  })
  .strict();

const LINK_KINDS = Object.keys(LINK_RULES) as [LinkKind, ...LinkKind[]];

const LinkSchema = z
  .object({ id: IdSchema, kind: z.enum(LINK_KINDS), from: IdSchema, to: IdSchema, props: Props })
  .strict();

export const BlueprintSchema = z
  .object({
    schemaVersion: z.literal(BLUEPRINT_SCHEMA_VERSION),
    id: IdSchema,
    name: z.string().max(200),
    entities: z.array(EntitySchema).max(MAX_ENTITIES),
    links: z.array(LinkSchema).max(MAX_LINKS),
    meta: Props,
  })
  .strict() as unknown as z.ZodType<Blueprint>;

const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("state"),
        entity: z.string().max(128),
        field: z.string().max(64),
        op: z.enum(COMPARE_OPS as [string, ...string[]]),
        value: z.union([z.number().finite(), z.boolean(), z.string().max(200)]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("alarm"),
        active: z.boolean(),
        entity: z.string().max(128).optional(),
        code: z.string().max(64).optional(),
        severity: z.enum(["warning", "critical"]).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("tool_called"),
        tool: z.string().max(64),
        target: z.string().max(128).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("action_taken"),
        action: z.enum(ACTION_KINDS as [string, ...string[]]),
        target: z.string().max(128).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("event"),
        type: z.string().max(64),
        target: z.string().max(128).optional(),
        occurred: z.boolean().optional(),
      })
      .strict(),
    z.object({ kind: z.literal("diagnosis_submitted") }).strict(),
    z.object({ kind: z.literal("all"), of: z.array(ConditionSchema).max(20) }).strict(),
    z.object({ kind: z.literal("any"), of: z.array(ConditionSchema).max(20) }).strict(),
  ]),
) as z.ZodType<Condition>;

const ParamValueSchema = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  ConditionSchema,
  z.record(z.string().max(64), z.number().finite()),
]);

const Weight = z.number().finite().min(0).max(1000);
const Target = z.string().max(128).optional();
const Label = z.string().max(200).optional();
const Ids = z.array(z.string().max(128)).max(50);
const Action = z.enum(ACTION_KINDS as [string, ...string[]]);

const ExpectationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: IdSchema,
      label: Label,
      kind: z.literal("diagnosis"),
      rootCause: Ids,
      faultType: Ids,
      weight: Weight,
    })
    .strict(),
  z
    .object({
      id: IdSchema,
      label: Label,
      kind: z.literal("final_state"),
      condition: ConditionSchema,
      weight: Weight,
    })
    .strict(),
  z
    .object({
      id: IdSchema,
      label: Label,
      kind: z.literal("required_action"),
      action: Action,
      target: Target,
      weight: Weight,
    })
    .strict(),
  z
    .object({
      id: IdSchema,
      label: Label,
      kind: z.literal("forbidden_action"),
      action: Action,
      target: Target,
      penalty: Weight,
    })
    .strict(),
  z
    .object({
      id: IdSchema,
      label: Label,
      kind: z.literal("time_limit"),
      seconds: z
        .number()
        .int()
        .min(1)
        .max(7 * 86_400),
      weight: Weight,
    })
    .strict(),
  z
    .object({
      id: IdSchema,
      label: Label,
      kind: z.literal("tool_budget"),
      maxCalls: z.number().int().min(1).max(10_000),
      weight: Weight,
    })
    .strict(),
]) as unknown as z.ZodType<Expectation>;

export const ScenarioDocSchema = z
  .object({
    schemaVersion: z.literal(SCENARIO_SCHEMA_VERSION),
    id: IdSchema,
    name: z.string().max(200),
    description: z.string().max(4000),
    worldId: IdSchema,
    nodes: z
      .array(
        z
          .object({
            id: IdSchema,
            type: z.string().max(64),
            params: z.record(z.string().max(64), ParamValueSchema),
            position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
            label: z.string().max(200).optional(),
          })
          .strict(),
      )
      .max(500),
    edges: z
      .array(
        z.object({ id: IdSchema, from: IdSchema, port: z.string().max(32), to: IdSchema }).strict(),
      )
      .max(2000),
    expectations: z.array(ExpectationSchema).max(100),
    template: z.string().max(64).optional(),
  })
  .strict() as unknown as z.ZodType<ScenarioDoc>;

export const TimePolicySchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("lockstep"), secondsPerCall: z.number().int().min(1).max(3600) })
    .strict(),
  z.object({ kind: z.literal("realtime"), speed: z.number().finite().min(0.1).max(600) }).strict(),
]) as z.ZodType<TimePolicy>;

const SITE_IDS = SITE_PRESETS.map((p) => p.id) as [string, ...string[]];
const choices = <K extends keyof typeof CHOICE_LABELS>(k: K) =>
  z.enum(Object.keys(CHOICE_LABELS[k]) as [string, ...string[]]);

/** Shape here; ranges and the rack ceiling come from worldgen's own rules, in Korean. */
export const WorldgenSpecSchema = z
  .object({
    site: z.enum(SITE_IDS),
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 31 - 1),
    name: NameSchema.optional(),
    buildings: z.number(),
    floors: z.number(),
    roomsPerFloor: z.number(),
    rows: z.number(),
    racksPerRow: z.number(),
    fill: z.number(),
    gpuShare: z.number(),
    containment: choices("containment"),
    coolingRedundancy: choices("coolingRedundancy"),
    powerRedundancy: choices("powerRedundancy"),
    vmsPerHost: z.number(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    for (const message of specProblems(spec as WorldgenSpec))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }) as unknown as z.ZodType<WorldgenSpec>;

export const SeedsSchema = z
  .array(
    z
      .number()
      .int()
      .min(0)
      .max(2 ** 31 - 1),
  )
  .min(1)
  .max(MAX_SEEDS)
  .refine((xs) => new Set(xs).size === xs.length, { message: "같은 시드가 두 번 있어요" });

export const ToolsSchema = z.array(z.string().min(1).max(64)).min(1).max(64);

export const ProfilesSchema = z
  .object({ vcenter: z.string().max(64).optional(), vrops: z.string().max(64).optional() })
  .strict();
