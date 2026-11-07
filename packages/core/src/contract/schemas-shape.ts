/** "서비스부터" (REQ-094) shapes: workload, service draft, the whole shape spec. Split from schemas.ts for length. */
import { SERVICE_LAYERS, type ShapeSpec, shapeProblem } from "@terrarium/core/sources/worldgen";
import {
  DAY_PATTERNS,
  LAYER_IDS,
  layersProblem,
  RESOURCES,
  WORKLOAD_KINDS,
  workloadProblem,
} from "@terrarium/core/world";
import { z } from "zod";
import { IdSchema, NameSchema, SITE_IDS } from "./schemas";

const Share = z.number().min(0).max(1);

const WorkloadSchema = z
  .object({
    kind: z.enum(WORKLOAD_KINDS as unknown as [string, ...string[]]),
    perMinute: z.number().min(1).max(1_000_000),
    pattern: z.enum(DAY_PATTERNS as unknown as [string, ...string[]]),
    shares: z.object(Object.fromEntries(RESOURCES.map((r) => [r, Share]))).strict(),
  })
  .strict();

const ServiceDraftSchema = z
  .object({
    key: IdSchema,
    name: NameSchema,
    gives: z.string().trim().max(400),
    stopsText: z.string().trim().max(400),
    kind: z.enum(["request", "batch", "stateful"]),
    nodes: z.number().int().min(1).max(60),
    hosts: z.number().int().min(0).max(60),
    switches: z.number().int().min(0).max(20),
    parts: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(80),
            count: z.number().int().min(0).max(999).optional(),
            tier: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
            role: z.enum(["node", "host", "switch"]).optional(),
            /** On Kubernetes (REQ-096): the workload this part is, by name. */
            workload: z
              .string()
              .trim()
              .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
              .optional(),
            /** The workloads this one calls, by name (REQ-100). */
            calls: z
              .array(
                z
                  .string()
                  .trim()
                  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
              )
              .max(8)
              .optional(),
          })
          .strict(),
      )
      .max(20),
    stops: z
      .array(
        z
          .object({
            what: z.string().trim().min(1).max(80),
            result: z.string().trim().max(200),
            bad: z.boolean().optional(),
          })
          .strict(),
      )
      .max(8),
    harm: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            perHourKrw: z.number().min(0).max(1e12),
          })
          .strict(),
      )
      .max(6),
    workload: WorkloadSchema,
    /** The services this one calls, by key (REQ-100): an optional line of the "+ 서비스 더하기" form. */
    calls: z.array(IdSchema).max(11).optional(),
    /** Its own choices for the four layers a service chooses (ADR-0108 item 5); absent: the world's shape. */
    layers: z
      .object(Object.fromEntries(SERVICE_LAYERS.map((l) => [l, z.string().max(40)])))
      .strict()
      .optional(),
  })
  .strict();

/** "서비스부터" (REQ-094): shape here; the meaning (limits, ids of the ladders) is checked after, in Korean. */
export const ShapeSpecSchema = z
  .object({
    name: NameSchema,
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 31 - 1),
    site: z.enum(SITE_IDS),
    servers: z.number().int().min(1).max(250_000),
    real: z.boolean().optional(),
    layers: z.object(Object.fromEntries(LAYER_IDS.map((l) => [l, z.string().max(40)]))).strict(),
    services: z.array(ServiceDraftSchema).max(12),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const problem =
      layersProblem(spec.layers as never) ??
      shapeProblem(spec as unknown as ShapeSpec) ??
      spec.services.map((s) => workloadProblem(s.workload as never)).find(Boolean);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  }) as unknown as z.ZodType<ShapeSpec>;
