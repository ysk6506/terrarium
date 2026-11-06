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
  minutesText,
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
  wait: (n) => `${minutesText(Number(n.params.seconds ?? 0))} 기다려요`,
  wait_until: (n, index) =>
    typeof n.params.condition === "object"
      ? `${describeCondition(n.params.condition as never, index)}까지`
      : "조건을 정해 주세요",
  branch: (n, index) =>
    typeof n.params.condition === "object"
      ? `${describeCondition(n.params.condition as never, index)}?`
      : "조건을 정해 주세요",
  random: (n) => `${outputsOf(n).length}갈래 중 하나`,
  note: (n) => String(n.params.text ?? ""),
  inject_fault: (n, index) => {
    const type = String(n.params.faultType ?? "");
    const label = isFaultType(type) ? faultSpec(type).label : "고장";
    return `${nameOf(index, n.params.target)}: ${label}`;
  },
  clear_fault: (n) =>
    n.params.ref ? `${String(n.params.ref)} 블록의 고장을 복구해요` : "복구할 고장을 골라 주세요",
  set_load: (n, index) =>
    `${nameOf(index, n.params.target)} 부하 ${Math.round(Number(n.params.value ?? 0) * 100)}%`,
  set_setpoint: (n, index) =>
    `${nameOf(index, n.params.target)} ${String(n.params.celsius ?? "?")}°C`,
  power: (n, index) =>
    `${withJosa(nameOf(index, n.params.target), "을")} ${n.params.on ? "켜요" : "꺼요"}`,
  port_admin: (n, index) =>
    `${nameOf(index, n.params.target)}의 ${nameOf(index, n.params.peer)} 쪽 포트를 ${n.params.down === false ? "켜요" : "꺼요"}`,
  port_vlan: (n, index) =>
    `${nameOf(index, n.params.target)}의 ${nameOf(index, n.params.peer)} 쪽 포트를 VLAN ${String(n.params.vlan ?? "?")}로`,
  svi_admin: (n, index) =>
    `${nameOf(index, n.params.target)}의 VLAN ${String(n.params.vlan ?? "?")} 인터페이스를 ${n.params.down === false ? "켜요" : "꺼요"}`,
  bgp_admin: (n, index) =>
    `${nameOf(index, n.params.target)}의 BGP 이웃 ${nameOf(index, n.params.peer)}${n.params.down === false ? "을 켜요" : "을 꺼요"}`,
  route_del: (n, index) =>
    `${nameOf(index, n.params.target)}에서 ${String(n.params.route ?? "?").replace(" via ", " → ")} 경로를 지워요`,
  outlet_set: (n, index) =>
    `${nameOf(index, n.params.target)} ${String(n.params.outlet ?? "?")}번 콘센트를 ${n.params.on === true ? "켜요" : "꺼요"}`,
  agent_task: (n) =>
    `툴 ${String(n.params.maxToolCalls ?? "?")}회, ${minutesText(Number(n.params.timeLimitSeconds ?? 0))} 안에`,
};

export function summaryOf(node: ScenarioNode, index?: BlueprintIndex): string {
  return SUMMARIES[node.type]?.(node, index) ?? "";
}

/** What a block is called on the canvas: the author's caption, else the block's name. */
export const titleOf = (n: ScenarioNode): string => n.label || blockSpec(n.type)?.label || n.type;

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
      title: titleOf(n),
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
    throw new FlowError(item.reason ?? `${withJosa(item.label, "은")} 지금 쓸 수 없어요`);
  const spec = blockSpec(item.type);
  const count = doc.nodes.filter((n) => n.type === item.type).length;
  if (spec?.maxCount !== undefined && count >= spec.maxCount)
    throw new FlowError(
      `${withJosa(spec.label, "은")} 시나리오에 ${spec.maxCount}개까지만 둘 수 있어요`,
    );
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

/**
 * The last block of the main line: from the start, follow each block's single "next" wire until a block has nothing
 * after it. A block with several exits (a branch, a wait with a timeout) ends the walk without an answer, because
 * which exit a new block belongs to is the author's choice.
 */
export function lineEnd(doc: ScenarioDoc): ScenarioNode | undefined {
  let at = doc.nodes.find((n) => n.type === "start");
  const seen = new Set<string>();
  while (at && !seen.has(at.id)) {
    seen.add(at.id);
    const exits = outputsOf(at);
    if (exits.length !== 1 || exits[0] === undefined) return undefined;
    const wire = doc.edges.find((e) => e.from === at?.id && e.port === exits[0]);
    if (!wire) return at;
    at = doc.nodes.find((n) => n.id === wire.to);
  }
  return undefined;
}

/**
 * A block pressed in the palette: it goes under the last block and is wired after the end of the main line, so
 * pressing 고장, 대기, 에이전트 투입 in turn builds a scenario that already runs. Dragging a block onto the canvas
 * (addBlock) leaves it unwired, where the author put it.
 */
export function appendBlock(
  doc: ScenarioDoc,
  item: PaletteItem,
): { doc: ScenarioDoc; nodeId: string } {
  const added = addBlock(doc, item, freeSpot(doc));
  const end = lineEnd(doc);
  if (!end || blockSpec(item.type)?.hasInput === false) return added;
  const exit = outputsOf(end)[0];
  return exit === undefined
    ? added
    : { ...added, doc: connect(added.doc, end.id, exit, added.nodeId) };
}

/** Wire an output port to a block. A port leads to one place: wiring it again moves the wire. */
export function connect(doc: ScenarioDoc, from: string, port: string, to: string): ScenarioDoc {
  const source = doc.nodes.find((n) => n.id === from);
  const target = doc.nodes.find((n) => n.id === to);
  if (!source || !target) throw new FlowError("없는 블록이에요");
  if (from === to) throw new FlowError("블록을 자기 자신에 이을 수 없어요");
  if (!outputsOf(source).includes(port))
    throw new FlowError(`'${portLabel(port)}' 출구가 없는 블록이에요`);
  if (blockSpec(target.type)?.hasInput === false)
    throw new FlowError(
      `${withJosa(blockSpec(target.type)?.label ?? target.type, "으로")}는 들어갈 수 없어요`,
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

/** The parameters whose choices depend on `name`, which a change of `name` makes meaningless. */
const dependentsOf = (node: ScenarioNode, name: string): string[] =>
  (blockSpec(node.type)?.params ?? [])
    .filter((p) => p.kind === "net_pick" && p.dependsOn === name)
    .map((p) => p.name);

/**
 * Set (or clear, with undefined) one parameter. Choosing another switch clears the port, VLAN or route that was
 * picked from the old one's list. A random block with fewer branches loses its extra wires.
 */
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
    if (params[name] !== n.params[name]) for (const d of dependentsOf(n, name)) delete params[d];
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
