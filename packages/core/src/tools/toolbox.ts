/** Tool dispatch with argument validation; an experiment exposes only the tools it selected. */
import { asTerrariumError, InvalidValueError } from "@terrarium/core/kernel";
import { type JsonSchema, TOOL_SPECS, type ToolSpec, toolSpec } from "./catalog";
import { type Args, HANDLERS, type ToolContext } from "./handlers";

export interface ToolResult {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

const TYPE_CHECKS: Readonly<Record<string, (v: unknown) => boolean>> = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  boolean: (v) => typeof v === "boolean",
};

/** Problems with `args` for `schema`, as sentences an agent can act on. Empty when valid. */
export function validateArgs(schema: JsonSchema, args: Args): string[] {
  const problems: string[] = [];
  for (const key of schema.required)
    if (args[key] === undefined) problems.push(`missing required argument '${key}'`);
  for (const [key, value] of Object.entries(args)) {
    const prop = schema.properties[key];
    if (!prop) {
      problems.push(
        `unknown argument '${key}' (allowed: ${Object.keys(schema.properties).join(", ")})`,
      );
      continue;
    }
    if (value === undefined) continue;
    if (!TYPE_CHECKS[prop.type]?.(value)) problems.push(`argument '${key}' must be a ${prop.type}`);
    else if (prop.enum && !prop.enum.includes(String(value)))
      problems.push(`argument '${key}' must be one of ${prop.enum.join(", ")}`);
  }
  return problems;
}

export class Toolbox {
  private readonly enabled: Set<string>;

  constructor(names: readonly string[]) {
    const unknown = names.filter((n) => !toolSpec(n));
    if (unknown.length > 0) throw new InvalidValueError(`unknown tools: ${unknown.join(", ")}`);
    this.enabled = new Set(names);
  }

  /** Hand the agent more tools in the middle of a run (a person gave them when it asked for help). Returns the new ones. */
  grant(names: readonly string[]): string[] {
    const unknown = names.filter((n) => !toolSpec(n));
    if (unknown.length > 0) throw new InvalidValueError(`unknown tools: ${unknown.join(", ")}`);
    const added = names.filter((n) => !this.enabled.has(n));
    for (const n of added) this.enabled.add(n);
    return added;
  }

  list(): ToolSpec[] {
    return TOOL_SPECS.filter((t) => this.enabled.has(t.name));
  }

  has(name: string): boolean {
    return this.enabled.has(name);
  }

  call(name: string, args: Args, ctx: ToolContext): ToolResult {
    const spec = toolSpec(name);
    if (!spec || !this.enabled.has(name)) {
      return {
        ok: false,
        error: `tool '${name}' is not available in this experiment (available: ${[...this.enabled].join(", ")})`,
      };
    }
    const problems = validateArgs(spec.inputSchema, args ?? {});
    if (problems.length > 0) return { ok: false, error: problems.join("; ") };
    try {
      return {
        ok: true,
        data: (HANDLERS[name] as (c: ToolContext, a: Args) => unknown)(ctx, args),
      };
    } catch (error) {
      return { ok: false, error: asTerrariumError(error).message };
    }
  }
}
