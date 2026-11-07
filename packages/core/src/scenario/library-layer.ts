/**
 * The shared shape of the sheets of the accelerator, power and cooling layers (REQ-107): a case found in the world (the thing the
 * fault is put on, what feels it, what an answer may name), a plan that says what goes wrong and what the sheet asks for,
 * and the template made of them. The same as the application layer's, with a few more things a plan may say.
 */
import type { BlueprintIndex, Domain, Entity, FaultType } from "@terrarium/core/world";
import { agent, allOf, doc, Flow, type ScenarioTemplate, SUBMIT } from "./library-kit";
import type { ActionKind, Condition, Expectation } from "./model";

export interface Case {
  readonly target: Entity;
  readonly roots: readonly string[];
  readonly services: readonly Entity[];
  readonly where: string;
  /** Things the case needs the flow to set first (a load on the servers of a rack). */
  readonly loads?: readonly string[];
  /** What the sheet asks of the world at the end, besides the services. */
  readonly finals?: readonly Condition[];
  /** Further faults put in together with the main one, at these targets. */
  readonly more?: readonly { readonly fault: FaultType; readonly target: string }[];
}

export interface Plan {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly difficulty: "쉬움" | "보통" | "어려움";
  readonly fault: FaultType;
  readonly faultParams?: Readonly<Record<string, number>>;
  readonly find: (index: BlueprintIndex) => Case | string;
  readonly report: (c: Case) => string;
  readonly waitS: number;
  readonly forbid: readonly { action: ActionKind; penalty: number }[];
  /** Actions the sheet wants done (and what they are worth). */
  readonly wanted?: readonly { action: ActionKind; weight: number }[];
  readonly timeLimitS: number;
  readonly budget: number;
  readonly own: readonly Domain[];
  readonly cause: Domain;
  /** True: scored by the services' recovery (the sheet supplies diagnosis, prohibitions and lasting conditions). */
  readonly recovery: boolean;
}

export const is = (entity: string, field: string, value: string | number | boolean): Condition => ({
  kind: "state",
  entity,
  field,
  op: "==",
  value,
});

export const atMost = (entity: string, field: string, value: number): Condition => ({
  kind: "state",
  entity,
  field,
  op: "<=",
  value,
});

export const atLeast = (entity: string, field: string, value: number): Condition => ({
  kind: "state",
  entity,
  field,
  op: ">=",
  value,
});

export const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
const KIND_ORDER = ["request", "stateful", "batch"];
const rank = (e: Entity) => KIND_ORDER.indexOf(String(e.props.serviceKind));
export const servicesOf = (index: BlueprintIndex, ids: readonly string[]) =>
  ids
    .map((id) => index.find(id))
    .filter((e): e is Entity => e?.kind === "service")
    .sort((a, b) => rank(a) - rank(b) || byId(a, b));

/** The services that depend on this entity. */
export const dependents = (index: BlueprintIndex, id: string): Entity[] =>
  servicesOf(
    index,
    index.incoming(id, "depends_on").map((l) => l.from),
  );

function sheet(plan: Plan, c: Case): Expectation[] {
  const healthy = c.services.map((s) => is(s.id, "status", "healthy"));
  const finals = [...(plan.recovery ? healthy : []), ...(c.finals ?? [])];
  return [
    {
      id: "diagnosis",
      kind: "diagnosis",
      label: "고장 난 장비와 고장 종류를 말해요",
      rootCause: [...c.roots],
      faultType: [plan.fault],
      weight: 30,
    },
    {
      id: "recovered",
      kind: "final_state",
      label: plan.recovery
        ? "끝났을 때 서비스가 모두 정상이에요"
        : "끝났을 때 설비가 제자리로 돌아왔어요",
      condition: allOf(finals),
      weight: 25,
    },
    ...(plan.wanted ?? []).map(
      (w, i): Expectation => ({
        id: `want-${i}`,
        kind: "required_action",
        label: w.action,
        action: w.action,
        weight: w.weight,
      }),
    ),
    ...plan.forbid.map(
      (f, i): Expectation => ({
        id: `forbid-${i}`,
        kind: "forbidden_action",
        label: f.action,
        action: f.action,
        penalty: f.penalty,
      }),
    ),
  ];
}

export function layerTemplate(plan: Plan): ScenarioTemplate {
  return {
    id: plan.id,
    name: plan.name,
    summary: plan.summary,
    difficulty: plan.difficulty,
    faultTypes: [plan.fault],
    ownDomains: plan.own,
    causeDomain: plan.cause,
    ...(plan.recovery ? { scoring: "recovery" as const } : {}),
    unavailable: (index) => {
      const c = plan.find(index);
      return typeof c === "string" ? c : undefined;
    },
    build(index, worldId) {
      const c = plan.find(index) as Case;
      const flow = new Flow();
      let last = flow.add("start", "start", {});
      c.loads?.forEach((target, i) => {
        last = flow.add(`load-${i + 1}`, "set_load", { target, value: 0.95 }, last);
      });
      (c.more ?? []).forEach((m, i) => {
        last = flow.add(
          `more-${i + 1}`,
          "inject_fault",
          { faultType: m.fault, target: m.target, faultParams: {}, durationSeconds: 0 },
          last,
        );
      });
      last = flow.add(
        "fault",
        "inject_fault",
        {
          faultType: plan.fault,
          target: c.target.id,
          faultParams: { ...(plan.faultParams ?? {}) },
          durationSeconds: 0,
        },
        last,
      );
      last = flow.add("wait", "wait", { seconds: plan.waitS }, last);
      flow.add(
        "agent",
        "agent_task",
        agent(`${plan.report(c)} ${SUBMIT}`, plan.budget, plan.timeLimitS),
        last,
      );
      return doc(this, worldId, `${c.where}에서 일어나요.`, flow, sheet(plan, c));
    },
  };
}
