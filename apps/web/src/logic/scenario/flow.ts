/**
 * The scenario editor's canvas (REQ-034): the document as nodes and wires for the flow view, and every
 * change a person makes on the canvas as a pure function on the document. Problems the validator finds
 * are attached to the node they are about, so the canvas can show them where they are.
 */
import { withJosa } from "@terrarium/core/kernel";
import {
  type BlockCategory,
  blockSpec,
  describeCondition,
  outputsOf,
  type PaletteItem,
  type ParamValue,
  PORT_LABELS,
  type ScenarioDoc,
  type ScenarioIssue,
  type ScenarioNode,
} from "@terrarium/core/scenario";
import { type BlueprintIndex, faultSpec, isFaultType } from "@terrarium/core/world";

export interface FlowPort {
  readonly id: string;
  readonly label: string;
}

export interface FlowNode {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly category: BlockCategory | "unknown";
  readonly summary: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly hasInput: boolean;
  readonly outputs: readonly FlowPort[];
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface FlowEdge {
  readonly id: string;
  readonly source: string;
  readonly sourceHandle: string;
  readonly target: string;
  readonly label: string;
}

export class FlowError extends Error {}

const nameOf = (index: BlueprintIndex | undefined, id: unknown) =>
  typeof id === "string" ? (index?.find(id)?.name ?? id) : "?";

const SUMMARIES: Readonly<Record<string, (n: ScenarioNode, index?: BlueprintIndex) => string>> = {
  wait: (n) => `${Number(n.params.seconds ?? 0)}초 기다린다`,
  wait_until: (n, index) =>
    typeof n.params.condition === "object"
      ? `${describeCondition(n.params.condition as never, index)}까지`
      : "조건을 정한다",
  branch: (n, index) =>
    typeof n.params.condition === "object"
      ? `${describeCondition(n.params.condition as never, index)}?`
      : "조건을 정한다",
  random: (n) => `${outputsOf(n).length}갈래 중 하나`,
  note: (n) => String(n.params.text ?? ""),
  inject_fault: (n, index) => {
    const type = String(n.params.faultType ?? "");
    const label = isFaultType(type) ? faultSpec(type).label : "장애";
    return `${nameOf(index, n.params.target)}: ${label}`;
  },
  clear_fault: (n) =>
    n.params.ref ? `${String(n.params.ref)} 블록의 장애를 없앤다` : "해제할 장애를 고른다",
  set_load: (n, index) =>
    `${nameOf(index, n.params.target)} 부하 ${Math.round(Number(n.params.value ?? 0) * 100)}%`,
  set_setpoint: (n, index) =>
    `${nameOf(index, n.params.target)} ${String(n.params.celsius ?? "?")}°C`,
  power: (n, index) =>
    `${withJosa(nameOf(index, n.params.target), "을")} ${n.params.on ? "켠다" : "끈다"}`,
  agent_task: (n) =>
    `툴 ${String(n.params.maxToolCalls ?? "?")}회, ${Math.round(Number(n.params.timeLimitSeconds ?? 0) / 60)}분 안에`,
};

export function summaryOf(node: ScenarioNode, index?: BlueprintIndex): string {
  return SUMMARIES[node.type]?.(node, index) ?? "";
}

const portLabel = (port: string) => PORT_LABELS[port] ?? `갈래 ${port}`;

export function toFlow(
  doc: ScenarioDoc,
  issues: readonly ScenarioIssue[] = [],
  index?: BlueprintIndex,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes = doc.nodes.map((n): FlowNode => {
    const spec = blockSpec(n.type);
    const mine = issues.filter((i) => i.nodeId === n.id);
    return {
      id: n.id,
      type: n.type,
      title: n.label || spec?.label || n.type,
      category: spec?.category ?? "unknown",
      summary: summaryOf(n, index),
      position: n.position,
      hasInput: spec?.hasInput ?? true,
      outputs: outputsOf(n).map((p) => ({ id: p, label: portLabel(p) })),
      errors: mine.filter((i) => i.severity === "error").map((i) => i.message),
      warnings: mine.filter((i) => i.severity === "warning").map((i) => i.message),
    };
  });
  const edges = doc.edges.map((e) => ({
    id: e.id,
    source: e.from,
    sourceHandle: e.port,
    target: e.to,
    label: portLabel(e.port),
  }));
  return { nodes, edges };
}

/** The next free id with a prefix: n7 after n6. */
function nextOf(ids: readonly string[], prefix: string): string {
  let top = 0;
  for (const id of ids) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) top = Math.max(top, Number(m[1]));
  }
  return `${prefix}${top + 1}`;
}

/** Drop a palette block on the canvas. Unusable blocks say why instead. */
export function addBlock(
  doc: ScenarioDoc,
  item: PaletteItem,
  position: { x: number; y: number },
): { doc: ScenarioDoc; nodeId: string } {
  if (!item.available)
    throw new FlowError(item.reason ?? `${withJosa(item.label, "은")} 지금 쓸 수 없다`);
  const spec = blockSpec(item.type);
  const count = doc.nodes.filter((n) => n.type === item.type).length;
  if (spec?.maxCount !== undefined && count >= spec.maxCount)
    throw new FlowError(`${withJosa(spec.label, "은")} 시나리오에 ${spec.maxCount}개까지만 둔다`);
  const nodeId = nextOf(
    doc.nodes.map((n) => n.id),
    "n",
  );
  const node: ScenarioNode = {
    id: nodeId,
    type: item.type,
    params: { ...item.params },
    position: { x: Math.round(position.x), y: Math.round(position.y) },
  };
  return { doc: { ...doc, nodes: [...doc.nodes, node] }, nodeId };
}

/** Wire an output port to a block. A port leads to one place: wiring it again moves the wire. */
export function connect(doc: ScenarioDoc, from: string, port: string, to: string): ScenarioDoc {
  const source = doc.nodes.find((n) => n.id === from);
  const target = doc.nodes.find((n) => n.id === to);
  if (!source || !target) throw new FlowError("없는 블록이다");
  if (from === to) throw new FlowError("블록을 자기 자신에 이을 수 없다");
  if (!outputsOf(source).includes(port))
    throw new FlowError(`'${portLabel(port)}' 출구가 없는 블록이다`);
  if (blockSpec(target.type)?.hasInput === false)
    throw new FlowError(
      `${withJosa(blockSpec(target.type)?.label ?? target.type, "으로")}는 들어갈 수 없다`,
    );
  const kept = doc.edges.filter((e) => !(e.from === from && e.port === port));
  const id = nextOf(
    doc.edges.map((e) => e.id),
    "e",
  );
  return { ...doc, edges: [...kept, { id, from, port, to }] };
}

export const disconnect = (doc: ScenarioDoc, edgeId: string): ScenarioDoc => ({
  ...doc,
  edges: doc.edges.filter((e) => e.id !== edgeId),
});

/** Remove blocks and the wires to and from them. The start block stays. */
export function removeNodes(doc: ScenarioDoc, ids: readonly string[]): ScenarioDoc {
  const gone = new Set(ids.filter((id) => doc.nodes.find((n) => n.id === id)?.type !== "start"));
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => !gone.has(n.id)),
    edges: doc.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
  };
}

const updateNode = (
  doc: ScenarioDoc,
  id: string,
  change: (n: ScenarioNode) => ScenarioNode,
): ScenarioDoc => ({
  ...doc,
  nodes: doc.nodes.map((n) => (n.id === id ? change(n) : n)),
});

export const moveNode = (doc: ScenarioDoc, id: string, position: { x: number; y: number }) =>
  updateNode(doc, id, (n) => ({
    ...n,
    position: { x: Math.round(position.x), y: Math.round(position.y) },
  }));

/** Set (or clear, with undefined) one parameter. A random block with fewer branches loses its extra wires. */
export function setParam(
  doc: ScenarioDoc,
  id: string,
  name: string,
  value: ParamValue | undefined,
): ScenarioDoc {
  const next = updateNode(doc, id, (n) => {
    const params = { ...n.params };
    if (value === undefined) delete params[name];
    else params[name] = value;
    return { ...n, params };
  });
  const node = next.nodes.find((n) => n.id === id);
  if (!node) return next;
  const ports = outputsOf(node);
  return { ...next, edges: next.edges.filter((e) => e.from !== id || ports.includes(e.port)) };
}

export const setLabel = (doc: ScenarioDoc, id: string, label: string) =>
  updateNode(doc, id, (n) => {
    const trimmed = label.trim();
    const { label: _old, ...rest } = n;
    return trimmed ? { ...rest, label: trimmed.slice(0, 200) } : rest;
  });

/** Where to drop a new block so it does not cover the last one: below the lowest block. */
export function freeSpot(doc: ScenarioDoc): { x: number; y: number } {
  if (doc.nodes.length === 0) return { x: 0, y: 0 };
  const lowest = doc.nodes.reduce((a, b) => (b.position.y > a.position.y ? b : a));
  return { x: lowest.position.x, y: lowest.position.y + 120 };
}
