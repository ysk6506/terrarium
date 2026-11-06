/**
 * The editor's everyday edits (REQ-034, REQ-071, beta feedback 19 and 20): a new block goes right after the block that is
 * selected, and blocks can be copied, pasted and duplicated. All of it is pure functions on the document, so the keys on
 * the canvas and the buttons in the palette do the same thing and one test covers both.
 */
import { withJosa } from "@terrarium/core/kernel";
import {
  blockSpec,
  outputsOf,
  type PaletteItem,
  type ScenarioDoc,
  type ScenarioEdge,
  type ScenarioNode,
} from "@terrarium/core/scenario";
import { addBlock, appendBlock, connect, FlowError } from "./flow";

/** How far below the block a new one lands, and how far a pasted copy sits from the original. */
const STEP = 120;
const NUDGE = 40;

/** The output of `node` a new block should hang on: the first one with no wire yet, else "next", else the first. */
function exitFor(doc: ScenarioDoc, node: ScenarioNode): string | undefined {
  const exits = outputsOf(node);
  const free = exits.find((p) => !doc.edges.some((e) => e.from === node.id && e.port === p));
  return free ?? (exits.includes("next") ? "next" : exits[0]);
}

/** Make room under `after` for one more block: everything lower on the canvas moves down a step. */
function shiftBelow(doc: ScenarioDoc, after: ScenarioNode, except: string): ScenarioDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id !== except && n.position.y > after.position.y
        ? { ...n, position: { x: n.position.x, y: n.position.y + STEP } }
        : n,
    ),
  };
}

/** Wire the block `added` between `after` and whatever `after` led to: after → added → old next. */
function splice(doc: ScenarioDoc, afterId: string, added: string): ScenarioDoc {
  const after = doc.nodes.find((n) => n.id === afterId);
  const node = doc.nodes.find((n) => n.id === added);
  if (!after || !node || blockSpec(node.type)?.hasInput === false) return doc;
  const port = exitFor(doc, after);
  if (port === undefined) return doc;
  const old = doc.edges.find((e) => e.from === afterId && e.port === port);
  let next = connect(doc, afterId, port, added);
  const out = outputsOf(node)[0];
  if (old && out !== undefined && old.to !== added) next = connect(next, added, out, old.to);
  return next;
}

/**
 * A block pressed in the palette goes right after the selected block (the old next block follows it); with nothing
 * selected it goes to the end of the main line, as it always did. A block that cannot be entered (the start) is only
 * placed.
 */
export function insertBlock(
  doc: ScenarioDoc,
  item: PaletteItem,
  afterId?: string,
): { doc: ScenarioDoc; nodeId: string } {
  const after = afterId ? doc.nodes.find((n) => n.id === afterId) : undefined;
  if (!after) return appendBlock(doc, item);
  const at = { x: after.position.x, y: after.position.y + STEP };
  const added = addBlock(doc, item, at);
  const room = shiftBelow(added.doc, after, added.nodeId);
  return { doc: splice(room, after.id, added.nodeId), nodeId: added.nodeId };
}

/** Blocks taken off the canvas, with the wires between them. */
export interface Snippet {
  readonly nodes: readonly ScenarioNode[];
  readonly edges: readonly ScenarioEdge[];
}

/** What a copy takes: the blocks asked for (never the start) and the wires that run between them. */
export function copyNodes(doc: ScenarioDoc, ids: readonly string[]): Snippet | undefined {
  const nodes = doc.nodes.filter((n) => ids.includes(n.id) && n.type !== "start");
  if (nodes.length === 0) return undefined;
  const kept = new Set(nodes.map((n) => n.id));
  return { nodes, edges: doc.edges.filter((e) => kept.has(e.from) && kept.has(e.to)) };
}

function freshId(taken: ReadonlySet<string>, prefix: string): string {
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

function checkRoom(doc: ScenarioDoc, snippet: Snippet): void {
  for (const node of snippet.nodes) {
    const spec = blockSpec(node.type);
    if (spec?.maxCount === undefined) continue;
    const have = doc.nodes.filter((n) => n.type === node.type).length;
    const adding = snippet.nodes.filter((n) => n.type === node.type).length;
    if (have + adding > spec.maxCount)
      throw new FlowError(
        `${withJosa(spec.label, "은")} 시나리오에 ${spec.maxCount}개까지만 둘 수 있어서 붙여 넣을 수 없어요`,
      );
  }
}

/** The snippet's blocks and wires under new ids, moved by `by`. */
function renumber(
  doc: ScenarioDoc,
  snippet: Snippet,
  by: { x: number; y: number },
): { nodes: ScenarioNode[]; edges: ScenarioEdge[]; ids: Map<string, string> } {
  const takenNodes = new Set(doc.nodes.map((n) => n.id));
  const ids = new Map<string, string>();
  const nodes = snippet.nodes.map((n) => {
    const id = freshId(takenNodes, "n");
    takenNodes.add(id);
    ids.set(n.id, id);
    return {
      ...n,
      id,
      params: { ...n.params },
      position: { x: n.position.x + by.x, y: n.position.y + by.y },
    };
  });
  const takenEdges = new Set(doc.edges.map((e) => e.id));
  const edges = snippet.edges.map((e) => {
    const id = freshId(takenEdges, "e");
    takenEdges.add(id);
    return { id, from: ids.get(e.from) ?? e.from, port: e.port, to: ids.get(e.to) ?? e.to };
  });
  return { nodes, edges, ids };
}

/**
 * Paste a copy. One block goes right after the selected block like a new one from the palette; several keep the shape
 * they had, a little to the side of the originals, wired among themselves and to nothing else.
 */
export function pasteSnippet(
  doc: ScenarioDoc,
  snippet: Snippet,
  afterId?: string,
): { doc: ScenarioDoc; nodeIds: string[] } {
  checkRoom(doc, snippet);
  const after = afterId ? doc.nodes.find((n) => n.id === afterId) : undefined;
  const single = snippet.nodes.length === 1 ? snippet.nodes[0] : undefined;
  if (single && after) {
    const place = {
      x: after.position.x - single.position.x,
      y: after.position.y + STEP - single.position.y,
    };
    const room = shiftBelow(doc, after, "");
    const copy = renumber(room, snippet, place);
    const merged = { ...room, nodes: [...room.nodes, ...copy.nodes] };
    const added = copy.nodes[0];
    return {
      doc: added ? splice(merged, after.id, added.id) : merged,
      nodeIds: copy.nodes.map((n) => n.id),
    };
  }
  const copy = renumber(doc, snippet, { x: NUDGE, y: NUDGE });
  return {
    doc: { ...doc, nodes: [...doc.nodes, ...copy.nodes], edges: [...doc.edges, ...copy.edges] },
    nodeIds: copy.nodes.map((n) => n.id),
  };
}

/** Ctrl+D: a copy of the block right after it. */
export function duplicateNode(
  doc: ScenarioDoc,
  id: string,
): { doc: ScenarioDoc; nodeIds: string[] } {
  const snippet = copyNodes(doc, [id]);
  if (!snippet) throw new FlowError("시작 블록은 복제할 수 없어요");
  return pasteSnippet(doc, snippet, id);
}

/**
 * Delete a block and close the gap: what led into it now leads to what it led to, so a line of blocks stays a line.
 * The start block stays.
 */
export function removeAndMend(doc: ScenarioDoc, id: string): ScenarioDoc {
  const node = doc.nodes.find((n) => n.id === id);
  if (!node || node.type === "start") return doc;
  const into = doc.edges.filter((e) => e.to === id);
  const out = outputsOf(node);
  const onward =
    out.length === 1 ? doc.edges.find((e) => e.from === id && e.port === out[0]) : undefined;
  const rest = {
    ...doc,
    nodes: doc.nodes.filter((n) => n.id !== id),
    edges: doc.edges.filter((e) => e.from !== id && e.to !== id),
  };
  if (!onward || into.length !== 1 || !into[0]) return rest;
  return {
    ...rest,
    edges: [
      ...rest.edges,
      {
        id: freshId(new Set(rest.edges.map((e) => e.id)), "e"),
        from: into[0].from,
        port: into[0].port,
        to: onward.to,
      },
    ],
  };
}
