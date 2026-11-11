/**
 * What a world needs to be run end to end (REQ-112, ADR-0135): the Object / Link / Action vocabulary of a Palantir-style
 * operational ontology, read off the scenarios of the world instead of written by hand.
 *
 *   Object  the kinds of equipment a fault sits on or an action touches, with how many the world has
 *   Link    the kinds of relation between those objects in the world's blueprint
 *   Action  what has to be done to clear the faults: the control rows of the controllability table (`controls.ts`)
 *           that fix or limit each fault, plus "물리 처리" for the faults no remote tool clears
 *
 * Every fault, mistake and kind of work maps to at least one action (a test walks them all), so a new fault type
 * cannot appear without a way out being named for it.
 */
import {
  CONTROL_ROWS,
  type ControlRow,
  FAULT_RESPONSES,
  type ScenarioDoc,
} from "@terrarium/core/scenario";
import {
  type Blueprint,
  type EntityKind,
  type FaultType,
  faultSpec,
  isFaultType,
  isMistakeType,
  KIND_LABELS,
  LINK_LABELS,
  type LinkKind,
  type MistakeType,
} from "@terrarium/core/world";

/** The action for what no remote tool clears: a part is changed, a person goes to the equipment. */
export const PHYSICAL_ACTION = "physical.repair";
export const PHYSICAL_LABEL = "현장 점검·부품 교체";

/** What clears a configuration mistake (the wrong VLAN, a shut port): the control row that undoes it. */
export const MISTAKE_ACTIONS: Readonly<Record<MistakeType, readonly string[]>> = {
  port_vlan_mismatch: ["network.config"],
  port_shutdown: ["network.port"],
  svi_shutdown: ["network.config"],
  bgp_neighbor_shutdown: ["network.config"],
  route_missing: ["network.config"],
  outlet_off: ["power.outlet"],
  network_policy_deny: ["policy.revert"],
};

/** What a scenario about work (not a fault) asks for. */
export const TASK_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  firmware_update: ["firmware.update"],
};

/** The action ids that clear a fault, a mistake or a kind of work; empty only for a name nobody knows. */
export function actionsFor(type: string): readonly string[] {
  if (isFaultType(type)) {
    const via = FAULT_RESPONSES[type].via;
    return via.length > 0 ? via : [PHYSICAL_ACTION];
  }
  if (isMistakeType(type)) return MISTAKE_ACTIONS[type];
  return TASK_ACTIONS[type] ?? [];
}

export interface OntologyCount {
  readonly kind: string;
  readonly label: string;
  readonly count: number;
}

export interface OntologyAction {
  readonly id: string;
  readonly label: string;
  /** The kinds it acts on, with how many the world has. */
  readonly targets: readonly OntologyCount[];
  /** The faults it clears, in the order the scenarios first meet them. */
  readonly faults: readonly { readonly type: string; readonly label: string }[];
  /** How many scenarios of the world need it. */
  readonly scenarios: number;
}

export interface OntologyNeeds {
  readonly scenarios: number;
  readonly objects: readonly OntologyCount[];
  readonly links: readonly OntologyCount[];
  readonly actions: readonly OntologyAction[];
}

const rowOf = (id: string): ControlRow | undefined => CONTROL_ROWS.find((r) => r.id === id);

export const actionLabel = (id: string): string =>
  id === PHYSICAL_ACTION ? PHYSICAL_LABEL : (rowOf(id)?.label ?? id);

/** The kinds of fault a scenario plays: its fault blocks and what its sheet expects the diagnosis to name. */
export function faultTypesOf(doc: ScenarioDoc): string[] {
  const out = new Set<string>();
  for (const n of doc.nodes) {
    const t = n.params.faultType;
    if (n.type === "inject_fault" && typeof t === "string") out.add(t);
  }
  for (const e of doc.expectations)
    if (e.kind === "diagnosis") for (const t of e.faultType) out.add(t);
  return [...out].filter((t) => actionsFor(t).length > 0);
}

export const faultName = (type: string): string => {
  try {
    return faultSpec(type as FaultType).label;
  } catch {
    return type;
  }
};

function kindCounts(blueprint: Blueprint): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of blueprint.entities) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  counts.set("link", blueprint.links.filter((l) => l.kind === "network").length);
  return counts;
}

const kindLabel = (kind: string): string =>
  kind === "link" ? "네트워크 링크" : (KIND_LABELS[kind as EntityKind] ?? kind);

function targetKinds(actionId: string, faultTypes: readonly string[]): readonly string[] {
  if (actionId !== PHYSICAL_ACTION) return rowOf(actionId)?.targets ?? [];
  return [...new Set(faultTypes.flatMap((t) => (isFaultType(t) ? faultSpec(t).targets : [])))];
}

interface Need {
  readonly faults: string[];
  readonly scenarios: Set<string>;
}

function collectNeeds(docs: readonly ScenarioDoc[]): Map<string, Need> {
  const needs = new Map<string, Need>();
  for (const doc of docs)
    for (const type of faultTypesOf(doc))
      for (const id of actionsFor(type)) {
        const need = needs.get(id) ?? { faults: [], scenarios: new Set<string>() };
        if (!need.faults.includes(type)) need.faults.push(type);
        need.scenarios.add(doc.id);
        needs.set(id, need);
      }
  return needs;
}

function linksAmong(blueprint: Blueprint, kinds: ReadonlySet<string>): OntologyCount[] {
  const kindOf = new Map(blueprint.entities.map((e) => [e.id, e.kind as string]));
  const counts = new Map<LinkKind, number>();
  for (const l of blueprint.links) {
    const a = kindOf.get(l.from);
    const b = kindOf.get(l.to);
    if (a && b && (kinds.has(a) || kinds.has(b))) counts.set(l.kind, (counts.get(l.kind) ?? 0) + 1);
  }
  return [...counts]
    .map(([kind, count]) => ({ kind, label: LINK_LABELS[kind], count }))
    .sort((x, y) => y.count - x.count || x.kind.localeCompare(y.kind));
}

/** Objects, links and actions the scenarios of one world need, worked out from their definitions and the blueprint. */
export function deriveNeeds(docs: readonly ScenarioDoc[], blueprint: Blueprint): OntologyNeeds {
  const counts = kindCounts(blueprint);
  const needs = collectNeeds(docs);
  const objectKinds = new Set<string>();
  const actions = [...needs].map(([id, need]): OntologyAction => {
    const targets = targetKinds(id, need.faults).map((kind) => ({
      kind,
      label: kindLabel(kind),
      count: counts.get(kind) ?? 0,
    }));
    for (const t of targets) if (t.count > 0) objectKinds.add(t.kind);
    return {
      id,
      label: actionLabel(id),
      targets,
      faults: need.faults.map((type) => ({ type, label: faultName(type) })),
      scenarios: need.scenarios.size,
    };
  });
  actions.sort((a, b) => b.faults.length - a.faults.length || a.label.localeCompare(b.label));
  const objects = [...objectKinds]
    .map((kind) => ({ kind, label: kindLabel(kind), count: counts.get(kind) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  return {
    scenarios: docs.length,
    objects,
    links: linksAmong(blueprint, objectKinds),
    actions,
  };
}
