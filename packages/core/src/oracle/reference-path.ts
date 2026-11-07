/**
 * The canonical solution of every fault, mistake and task, as data (REQ-110, ADR-0133). A reference solver (a test
 * support, never a selectable agent) knows the injected fault and walks this path through the same tools an agent has:
 * read what the fault shows, make the change that mends it, check that it took, and answer with the true cause. The
 * grader is held to it: the path must score exactly 100 on every scenario, and every wrong variant of it must score
 * less (tests/spec/reference-solutions.test.ts, reference-mutations.test.ts). A fault without a path fails
 * tests/spec/reference-coverage.test.ts, so a new fault kind cannot be added without its canonical solution.
 *
 * Arguments hold `{…}` that the solver fills from the scenario it plays: `{target}` the entity the fault is injected on
 * (or the mistake's device), `{peer}` the other end of a mistake, `{service}` the service the sheet is about, `{required}`
 * the entity of the sheet's first required action, `{answer}` the cause the sheet accepts first, and the names in
 * `BINDERS` below, which the solver reads from a status tool at the time of the step.
 */
import type { FaultType, MistakeType } from "@terrarium/core/world";

export type ReferenceKey = FaultType | MistakeType | "firmware_update";

export type StepArgs = Readonly<
  Record<string, string | number | boolean | readonly string[] | Readonly<Record<string, string>>>
>;

export interface ReferenceStep {
  readonly tool: string;
  readonly args?: StepArgs;
  /** Run once for every block of the sheet that breaks something (two switches), with `{target}` and `{p.name}` set to each. */
  readonly forEach?: "targets" | "critical" | "servers" | `alarm:${string}`;
  /** The read is expected to be refused (a control plane that is down): the refusal is the finding. */
  readonly refused?: boolean;
  /** Steps that run together for each of the `forEach` entities, one entity after another. */
  readonly group?: readonly ReferenceStep[];
}

export interface ReferencePath {
  /** Reads before the change: what an operator looks at first. At most two come before the first change. */
  readonly diagnose: readonly ReferenceStep[];
  /** Changes, in the order that mends it; empty where nothing remote mends it, or where the cluster does it itself. */
  readonly fix: readonly ReferenceStep[];
  /** Reads after the change, that show it took. */
  readonly verify: readonly ReferenceStep[];
  /** Seconds to let the change take hold before the answer. */
  readonly settleS?: number;
  /** The cluster mends it by itself on some worlds: look, change nothing, wait it out, answer. */
  readonly handsOff?: boolean;
  /** Where the world decides the path (a hot site mends itself, a cold one is moved by hand): read, then pick by what it says. */
  readonly choose?: {
    readonly read: ReferenceStep;
    /** A `{@tool/…}` spec of the data the read returned. */
    readonly at: string;
    readonly cases: Readonly<Record<string, ReferencePath>>;
  };
}

export const read = (tool: string, args?: StepArgs): ReferenceStep => ({
  tool,
  ...(args ? { args } : {}),
});
/** A read that the world refuses, and that says why. */
export const refusedRead = (tool: string, args?: StepArgs): ReferenceStep => ({
  ...read(tool, args),
  refused: true,
});
/** Wait the time a move between sites said it takes (`etaSeconds` of the last `dr_failover`), or a part of it. */
export const waitEta = (part: "half" | "rest" | "all"): ReferenceStep => ({
  tool: "wait_eta",
  args: { part },
});
/** Wait, an hour at a time, until the team the work was handed to says it is done (`events_since`). */
export const untilTeamDone: ReferenceStep = { tool: "until_team_done" };
export const change = (
  tool: string,
  args?: StepArgs,
  forEach?: ReferenceStep["forEach"],
): ReferenceStep => ({
  tool,
  ...(args ? { args } : {}),
  ...(forEach ? { forEach } : {}),
});
/** A shell command on a host. */
export const sh = (host: string, cmd: string): ReferenceStep =>
  change("run_command", { host, cmd });
export const path = (
  diagnose: readonly ReferenceStep[],
  fix: readonly ReferenceStep[],
  verify: readonly ReferenceStep[] = [],
  more: Pick<ReferencePath, "settleS" | "handsOff" | "choose"> = {},
): ReferencePath => ({ diagnose, fix, verify, ...more });

/** Steps done for one server after another: the next starts when the one before is done. */
export const eachServer = (...group: readonly ReferenceStep[]): ReferenceStep => ({
  tool: "group",
  forEach: "servers",
  group,
});

/** Scenario-specific paths where one fault kind is solved differently on a sheet (keyed by the template id). */
