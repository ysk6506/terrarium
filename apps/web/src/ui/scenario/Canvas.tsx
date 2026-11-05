/**
 * The workflow canvas (REQ-034): blocks and wires with React Flow. The document is the truth; React
 * Flow only holds positions while a block is being dragged, and every change goes back through
 * logic.scenario (connect, disconnect, move, remove) so the rules live in one tested place.
 */
import { CATEGORY_LABELS } from "@terrarium/core/scenario";
import {
  applyNodeChanges,
  Background,
  type Connection,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { type DragEvent, useEffect, useMemo, useState } from "react";
import { scenario } from "../../logic";
import { DRAG_TYPE, paletteItem } from "./Palette";
import type { ScenarioEditor } from "./useScenario";

type BlockData = scenario.FlowNode & Record<string, unknown>;
type BlockNode = Node<BlockData, "block">;

function Block({ data, selected }: NodeProps<BlockNode>) {
  const flag = data.errors.length > 0 ? "고칠 곳" : data.warnings.length > 0 ? "주의" : undefined;
  const caption =
    data.type === "start" || data.type === "note" || data.category === "unknown"
      ? undefined
      : CATEGORY_LABELS[data.category];
  return (
    <div className="block" data-category={data.category} data-selected={selected}>
      {data.hasInput && <Handle type="target" position={Position.Top} />}
      <div className="block-head">
        <span>
          {caption && <span className="block-cap">{caption}</span>}
          {data.title}
        </span>
        {flag && (
          <span
            className="block-flag"
            style={data.errors.length === 0 ? { color: "var(--warn)" } : undefined}
            title={[...data.errors, ...data.warnings].join("\n")}
          >
            {flag}
          </span>
        )}
      </div>
      {data.summary && <div className="block-body">{data.summary}</div>}
      {data.outputs.length > 0 && (
        <div className="block-ports">
          {data.outputs.map((p) => (
            <span key={p.id} className="block-port">
              {data.outputs.length > 1 ? p.label : ""}
              <Handle type="source" id={p.id} position={Position.Bottom} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const NODE_TYPES = { block: Block };

/** The nodes and edges the editor draws: from the document, with dragging kept local until it stops. */
function useFlowGraph(e: ScenarioEditor) {
  const flow = useMemo(() => scenario.toFlow(e.doc, e.issues, e.index), [e.doc, e.issues, e.index]);
  const fromDoc = useMemo(
    () =>
      flow.nodes.map(
        (n): BlockNode => ({
          id: n.id,
          type: "block",
          position: { ...n.position },
          data: n as BlockData,
          selected: n.id === e.selected,
          deletable: n.type !== "start",
        }),
      ),
    [flow, e.selected],
  );
  const [nodes, setNodes] = useState<BlockNode[]>(fromDoc);
  useEffect(() => setNodes(fromDoc), [fromDoc]);
  const edges: Edge[] = flow.edges.map((x) => ({
    id: x.id,
    source: x.source,
    sourceHandle: x.sourceHandle,
    target: x.target,
    label: x.label === "다음" ? undefined : x.label,
  }));
  return { nodes, setNodes, edges };
}

/** Dropping a palette block on the canvas adds it where it landed and selects it. */
function useDropBlock(e: ScenarioEditor) {
  const rf = useReactFlow();
  return (ev: DragEvent) => {
    ev.preventDefault();
    const item = paletteItem(e, ev.dataTransfer.getData(DRAG_TYPE));
    if (!item) return;
    const at = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
    let added: string | undefined;
    const ok = e.change((d) => {
      const r = scenario.addBlock(d, item, { x: at.x - 115, y: at.y - 20 });
      added = r.nodeId;
      return r.doc;
    });
    if (ok && added) e.select(added);
  };
}

function Flow({ e }: { readonly e: ScenarioEditor }) {
  const { nodes, setNodes, edges } = useFlowGraph(e);
  const onDrop = useDropBlock(e);
  const onNodesChange = (changes: NodeChange<BlockNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    for (const c of changes) if (c.type === "select" && c.selected) e.select(c.id);
  };
  const onConnect = (c: Connection) => {
    if (c.source && c.target)
      e.change((d) => scenario.connect(d, c.source, c.sourceHandle ?? "next", c.target));
  };

  return (
    <ReactFlow<BlockNode, Edge>
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onNodeDragStop={(_ev, node) => e.change((d) => scenario.moveNode(d, node.id, node.position))}
      onNodesDelete={(gone) =>
        e.change((d) =>
          scenario.removeNodes(
            d,
            gone.map((n) => n.id),
          ),
        )
      }
      onEdgesDelete={(gone) =>
        e.change((d) => gone.reduce((acc, x) => scenario.disconnect(acc, x.id), d))
      }
      onConnect={onConnect}
      onPaneClick={() => e.select(undefined)}
      onDragOver={(ev) => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
      }}
      onDrop={onDrop}
      deleteKeyCode={["Delete", "Backspace"]}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
      aria-label="시나리오 흐름. 블록을 끌어 옮기고, 아래쪽 점에서 다음 블록 위쪽 점으로 끌어 이어요."
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}

export function Canvas({ e }: { readonly e: ScenarioEditor }) {
  return (
    <div className="stage" style={{ background: "var(--paper)" }}>
      <div style={{ position: "absolute", inset: 0 }}>
        <ReactFlowProvider>
          <Flow e={e} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
