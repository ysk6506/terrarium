/** Step 1 of an import: what each record is, according to the mapping. Nothing is invented here. */
import type { KgMapping, NodeRole, NodeRule, RelationMeaning, RelationRule } from "./mapping";
import type { SourceNode, SourceRelationship } from "./port";

export interface Classified {
  readonly node: SourceNode;
  readonly role: NodeRole;
  readonly name: string;
}

export interface Relation {
  readonly type: string;
  readonly means: RelationMeaning;
  /** The dependent end (consumer, contained thing, port). */
  readonly from: string;
  /** The supplier end (provider, container, owner). */
  readonly to: string;
  readonly props: Readonly<Record<string, unknown>>;
}

export interface Classification {
  readonly nodes: ReadonlyMap<string, Classified>;
  readonly relations: readonly Relation[];
  /** label → count of nodes no rule took (outside the mapping's filters). */
  readonly filteredOut: Readonly<Record<string, number>>;
  /** type → count of relationships no rule matched. */
  readonly unmatched: Readonly<Record<string, number>>;
}

export function firstString(
  props: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = props[key];
    if ((typeof value === "string" && value.trim() !== "") || typeof value === "number")
      return String(value).trim();
  }
  return undefined;
}

function matchesWhere(rule: NodeRule, props: Readonly<Record<string, unknown>>): boolean {
  if (!rule.where) return true;
  return Object.entries(rule.where).every(([key, allowed]) => {
    const value = props[key];
    return value === undefined || value === null
      ? allowed.includes(null)
      : allowed.includes(value as string);
  });
}

/** The first rule (in mapping order) whose labels and filters fit the node. */
function ruleFor(mapping: KgMapping, node: SourceNode): NodeRule | undefined {
  return mapping.nodes.find(
    (r) => r.labels.some((l) => node.labels.includes(l)) && matchesWhere(r, node.props),
  );
}

function relationRule(
  rules: readonly RelationRule[],
  type: string,
  from: NodeRole,
  to: NodeRole,
): { rule: RelationRule; reversed: boolean } | undefined {
  for (const rule of rules) {
    if (!rule.types.includes(type)) continue;
    if (rule.from.includes(from) && rule.to.includes(to)) return { rule, reversed: false };
    if (rule.either && rule.from.includes(to) && rule.to.includes(from))
      return { rule, reversed: true };
  }
  return undefined;
}

function classifyNodes(mapping: KgMapping, nodes: readonly SourceNode[]) {
  const classified = new Map<string, Classified>();
  const filteredOut: Record<string, number> = {};
  const byId = [...nodes].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  for (const node of byId) {
    if (classified.has(node.id)) continue;
    const rule = ruleFor(mapping, node);
    if (!rule) {
      for (const l of node.labels) filteredOut[l] = (filteredOut[l] ?? 0) + 1;
      continue;
    }
    const name = firstString(node.props, mapping.keys.name) ?? `${node.labels[0]}-${node.id}`;
    classified.set(node.id, { node, role: rule.role, name });
  }
  return { classified, filteredOut };
}

function classifyRelations(
  mapping: KgMapping,
  classified: ReadonlyMap<string, Classified>,
  relationships: readonly SourceRelationship[],
) {
  const relations: Relation[] = [];
  const unmatched: Record<string, number> = {};
  for (const r of relationships) {
    const a = classified.get(r.from);
    const b = classified.get(r.to);
    const hit = a && b ? relationRule(mapping.relations, r.type, a.role, b.role) : undefined;
    if (!hit) {
      unmatched[r.type] = (unmatched[r.type] ?? 0) + 1;
      continue;
    }
    const [from, to] = hit.reversed ? [r.to, r.from] : [r.from, r.to];
    relations.push({ type: r.type, means: hit.rule.means, from, to, props: r.props });
  }
  return { relations, unmatched };
}

export function classify(
  mapping: KgMapping,
  nodes: readonly SourceNode[],
  relationships: readonly SourceRelationship[],
): Classification {
  const { classified, filteredOut } = classifyNodes(mapping, nodes);
  const { relations, unmatched } = classifyRelations(mapping, classified, relationships);
  return { nodes: classified, relations, filteredOut, unmatched };
}
