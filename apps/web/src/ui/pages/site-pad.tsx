/**
 * Drawing a site's shape (REQ-048): click to put a point, and the shape closes itself. The pad is 1,200 × 800 m with a
 * line every 100 m; points land on a 10 m grid. The same drawing shows a preset's or a rectangle's shape, read only.
 */
import type { Outline, Point } from "@terrarium/core/spatial";
import { useRef, useState } from "react";
import { builder } from "../../logic";

const PAD = { w: 1200, d: 800 } as const;
const STEP = builder.SITE_GRID_M;

const snap = (n: number, max: number) => Math.min(max, Math.max(0, Math.round(n / STEP) * STEP));
const text = (points: readonly Point[]) => points.map((p) => `${p.x},${p.y}`).join(" ");

function Grid() {
  const lines = [];
  for (let x = 0; x <= PAD.w; x += 100)
    lines.push(<line key={`x${x}`} className="pad-grid" x1={x} y1={0} x2={x} y2={PAD.d} />);
  for (let y = 0; y <= PAD.d; y += 100)
    lines.push(<line key={`y${y}`} className="pad-grid" x1={0} y1={y} x2={PAD.w} y2={y} />);
  return <>{lines}</>;
}

interface PadProps {
  readonly points: readonly Point[];
  readonly onChange: (points: Point[]) => void;
}

/** The drawing pad: pointer or keyboard puts points, Backspace takes the last one back. */
export function SitePad({ points, onChange }: PadProps) {
  const svg = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<Point>({ x: 600, y: 400 });
  const put = (p: Point) => {
    const last = points.at(-1);
    if (!last || last.x !== p.x || last.y !== p.y) onChange([...points, p]);
  };
  const at = (e: { clientX: number; clientY: number }): Point => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return cursor;
    return {
      x: snap(((e.clientX - box.left) / box.width) * PAD.w, PAD.w),
      y: snap(((e.clientY - box.top) / box.height) * PAD.d, PAD.d),
    };
  };
  const key = (e: React.KeyboardEvent) => {
    const jump = e.shiftKey ? STEP * 5 : STEP;
    const move: Record<string, Point> = {
      ArrowLeft: { x: -jump, y: 0 },
      ArrowRight: { x: jump, y: 0 },
      ArrowUp: { x: 0, y: -jump },
      ArrowDown: { x: 0, y: jump },
    };
    const step = move[e.key];
    if (step) setCursor({ x: snap(cursor.x + step.x, PAD.w), y: snap(cursor.y + step.y, PAD.d) });
    else if (e.key === "Enter" || e.key === " ") put(cursor);
    else if (e.key === "Backspace") onChange(points.slice(0, -1));
    else return;
    e.preventDefault();
  };
  const last = points.at(-1);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a drawing surface has no native element; keys and pointer both work on it
    <svg
      ref={svg}
      className="pad"
      viewBox={`0 0 ${PAD.w} ${PAD.d}`}
      role="group"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the pad is driven by the arrow keys, so it must take focus
      tabIndex={0}
      aria-label="사업장 모양 그리기. 화살표 키로 움직이고 Enter로 점을 찍어요. Backspace로 마지막 점을 지워요."
      onPointerMove={(e) => setCursor(at(e))}
      onPointerDown={(e) => put(at(e))}
      onKeyDown={key}
    >
      <rect className="pad-ground" x={0} y={0} width={PAD.w} height={PAD.d} />
      <Grid />
      {points.length >= 3 ? (
        <polygon className="pad-shape" points={text(points)} />
      ) : (
        <polyline className="pad-line" points={text(points)} />
      )}
      {last && <line className="pad-guide" x1={last.x} y1={last.y} x2={cursor.x} y2={cursor.y} />}
      {points.map((p, i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: points have no identity but their order
          key={i}
          className={i === 0 ? "pad-dot pad-first" : "pad-dot"}
          cx={p.x}
          cy={p.y}
          r={i === 0 ? 16 : 11}
        />
      ))}
      <circle className="pad-cursor" cx={cursor.x} cy={cursor.y} r={8} />
      <text className="pad-scale" x={16} y={PAD.d - 16}>
        한 칸은 100 m
      </text>
    </svg>
  );
}

/** A shape drawn small, read only: a preset's outline or a rectangle. */
export function OutlineView({ outline }: { readonly outline: Outline }) {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const pad = 40;
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) - x0 + pad;
  const d = Math.max(...ys) - y0 + pad;
  return (
    <svg
      className="pad pad-small"
      viewBox={`${x0} ${y0} ${w} ${d}`}
      role="img"
      aria-label="이 사업장의 모양"
    >
      <polygon className="pad-shape" points={text(outline)} />
    </svg>
  );
}
