/**
 * What every built-in scenario template is made of: the template shape, the flow builder that lays
 * blocks out, and the small pieces (a "powered" condition, an agent task, a document) they share.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type {
  BlueprintIndex,
  Domain,
  Entity,
  EntityKind,
  FaultType,
  MistakeType,
} from "@terrarium/core/world";
import { kindList } from "@terrarium/core/world";
import type { Condition, Expectation, ScenarioDoc, ScenarioEdge, ScenarioNode } from "./model";
import { SCENARIO_SCHEMA_VERSION } from "./model";

export interface ScenarioTemplate {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly difficulty: "쉬움" | "보통" | "어려움";
  readonly faultTypes: readonly FaultType[];
  /** The mistakes (a wrong VLAN, a shut port) it makes with configuration blocks instead of faults. */
  readonly mistakeTypes?: readonly MistakeType[];
  /** The domains the experiment should be responsible for to play this sheet (REQ-093); the cause is in another. */
  readonly ownDomains?: readonly Domain[];
  /** The domain of the fault: who has to be handed the work. */
  readonly causeDomain?: Domain;
  /** `recovery` for a template about services: its sheet is scored recovery first (ADR-0091 item 3). */
  readonly scoring?: "recovery";
  /**
   * Why this template cannot be built for the world, or undefined when it can. Templates that read the network
   * design need the equipment catalog; without one they use the built-in models.
   */
  unavailable(index: BlueprintIndex, catalog?: Catalog): string | undefined;
  build(index: BlueprintIndex, worldId: string, catalog?: Catalog): ScenarioDoc;
}

/** Lays blocks out top to bottom, as the editor does; `row` > 0 places a side branch to the right. */
export class Flow {
  readonly nodes: ScenarioNode[] = [];
  readonly edges: ScenarioEdge[] = [];
  private column = 0;

  add(
    id: string,
    type: string,
    params: ScenarioNode["params"],
    from?: string,
    port = "next",
    row = 0,
  ): string {
    this.nodes.push({ id, type, params, position: { x: 260 * row, y: 120 * this.column++ } });
    if (from) this.edges.push({ id: `e-${from}-${port}-${id}`, from, port, to: id });
    return id;
  }
}

/** Order by id, so a pick from a world is the same every time. */
export const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
export const byLinks = (index: BlueprintIndex, kind: EntityKind, count: (e: Entity) => number) =>
  [...index.ofKind(kind)].sort((a, b) => count(b) - count(a) || a.id.localeCompare(b.id))[0];

export const busiestServer = (index: BlueprintIndex) =>
  byLinks(index, "server", (s) => index.incoming(s.id, "runs_on").length);

export const powered = (id: string): Condition => ({
  kind: "state",
  entity: id,
  field: "powered",
  op: "==",
  value: true,
});

/** The contract allows 20 conditions in one all/any, so a long list becomes groups of groups. */
const GROUP_SIZE = 20;
export function allOf(conditions: readonly Condition[]): Condition {
  if (conditions.length <= GROUP_SIZE) return { kind: "all", of: conditions };
  const groups: Condition[] = [];
  for (let i = 0; i < conditions.length; i += GROUP_SIZE)
    groups.push(allOf(conditions.slice(i, i + GROUP_SIZE)));
  return allOf(groups);
}

export function doc(
  template: ScenarioTemplate,
  worldId: string,
  description: string,
  flow: Flow,
  expectations: Expectation[],
  expectedRecoveryS?: number,
): ScenarioDoc {
  return {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    id: template.id,
    name: template.name,
    description,
    worldId,
    template: template.id,
    nodes: flow.nodes,
    edges: flow.edges,
    expectations,
    ...(template.scoring ? { scoring: template.scoring } : {}),
    ...(template.scoring &&
    expectedRecoveryS !== undefined &&
    expectedRecoveryS > DEFAULT_EXPECTED_S
      ? { expectedRecoveryS: Math.round(expectedRecoveryS) }
      : {}),
  };
}

/** The five minutes a recovery was given before the window followed the shape of the world (REQ-108); never less. */
export const DEFAULT_EXPECTED_S = 300;

export const needs = (index: BlueprintIndex, kinds: EntityKind[]) =>
  kinds.every((k) => index.ofKind(k).length > 0)
    ? undefined
    : `이 세계에 필요한 장비(${kindList(kinds)})가 없어요`;

export const agent = (prompt: string, maxToolCalls = 40, timeLimitSeconds = 3600) => ({
  prompt,
  maxToolCalls,
  timeLimitSeconds,
});

export const SUBMIT = "근본 원인을 찾아 필요한 조치를 하고, submit_diagnosis로 진단을 제출하라.";
