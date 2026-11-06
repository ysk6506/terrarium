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
import { type DragEvent, useEffect, useId, useMemo, useState } from "react";
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

const DIRECTIONS: Readonly<Record<string, string>> = {
  left: "왼쪽",
  right: "오른쪽",
  up: "위",
  down: "아래",
};

/** What the canvas library says to a screen reader, in the words of the rest of the screen. */
const ARIA_WORDS = {
  "node.a11yDescription.default":
    "엔터나 스페이스로 블록을 골라요. Delete로 지우고 Esc로 그만둬요.",
  "node.a11yDescription.keyboardDisabled":
    "엔터나 스페이스로 블록을 고른 뒤 화살표 키로 옮겨요. Delete로 지우고 Esc로 그만둬요.",
  "node.a11yDescription.ariaLiveMessage": ({
    direction,
    x,
    y,
  }: {
    direction: string;
    x: number;
    y: number;
  }) =>
    `블록을 ${DIRECTIONS[direction] ?? direction}으로 옮겼어요. 새 자리는 가로 ${x}, 세로 ${y}예요`,
  "edge.a11yDescription.default":
    "엔터나 스페이스로 이음선을 골라요. Delete로 지우고 Esc로 그만둬요.",
  "controls.ariaLabel": "보기 조절",
  "controls.zoomIn.ariaLabel": "확대",
  "controls.zoomOut.ariaLabel": "축소",
  "controls.fitView.ariaLabel": "전체 보기",
  "controls.interactive.ariaLabel": "움직임 켜고 끄기",
  "minimap.ariaLabel": "미니맵",
  "handle.ariaLabel": "이음 점",
};

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
          domAttributes: { "aria-roledescription": "블록", "aria-selected": n.id === e.selected },
        }),
      ),
    [flow, e.selected],
  );
  const [nodes, setNodes] = useState<BlockNode[]>(fromDoc);
  useEffect(() => setNodes(fromDoc), [fromDoc]);
  const titleOf = (id: string) => flow.nodes.find((n) => n.id === id)?.title ?? id;
  const edges: Edge[] = flow.edges.map((x) => ({
    id: x.id,
    source: x.source,
    sourceHandle: x.sourceHandle,
    target: x.target,
    label: x.label === "다음" ? undefined : x.label,
    ariaLabel: `${titleOf(x.source)}에서 ${titleOf(x.target)} 쪽으로 이어져요`,
    domAttributes: { "aria-roledescription": "이음선" },
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

function Flow({ e, keysId }: { readonly e: ScenarioEditor; readonly keysId: string }) {
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
        e.change((d) => gone.reduce((acc, n) => scenario.removeAndMend(acc, n.id), d))
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
      ariaLabelConfig={ARIA_WORDS}
      aria-label="시나리오 흐름. 블록을 끌어 옮기고, 아래쪽 점에서 다음 블록 위쪽 점으로 끌어 이어요."
      aria-describedby={keysId}
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}

/** The keys, said once on the canvas and read out when the canvas is entered. */
const KEYS_TEXT =
  "Ctrl+C/V 복사·붙여넣기 · Ctrl+D 복제 · Ctrl+Z 되돌리기 · Ctrl+Y 다시 · Del 지우기 · 끌어서 놓기";

export function Canvas({ e }: { readonly e: ScenarioEditor }) {
  const keysId = useId();
  const picked = e.selected ? e.doc.nodes.find((n) => n.id === e.selected) : undefined;
  return (
    <div className="stage" style={{ background: "var(--paper)" }}>
      <p className="canvas-keys" id={keysId}>
        {KEYS_TEXT}
      </p>
      <p className="sr-only" aria-live="polite">
        {picked ? `고른 블록: ${scenario.titleOf(picked)}` : ""}
      </p>
      <div style={{ position: "absolute", inset: 0 }}>
        <ReactFlowProvider>
          <Flow e={e} keysId={keysId} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
