/**
 * The picture of a choice on a ladder (ADR-0108 item 4): boxes in rows, lines between rows, and a red cross on the box
 * that breaks. It is drawn from data (`Diagram`) in the app's colours, so the same routine draws all 44 and both themes.
 */
import type { Diagram, DiagramRow } from "../../logic";

const W = 240;
const LEFT = 62;
const BOX_W = 22;
const BOX_H = 16;
const STEP = 34;
const TOP = 16;

const xs = (n: number): number[] => {
  const span = W - LEFT - 12;
  return Array.from({ length: n }, (_, i) => LEFT + (span * (i + 0.5)) / n);
};

interface Line {
  readonly key: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

function linesBetween(prev: DiagramRow, row: DiagramRow, r: number): Line[] {
  const y1 = TOP + (r - 1) * STEP + BOX_H;
  const y2 = TOP + r * STEP;
  const from = xs(prev.n);
  const to = xs(row.n);
  const join = row.join ?? "mesh";
  if (join === "none") return [];
  if (join === "bus") return [];
  return to.flatMap((x2, i) => {
    const sources =
      join === "one"
        ? [Math.min(prev.n - 1, Math.floor((i * prev.n) / row.n))]
        : from.map((_, k) => k);
    return sources.map((k) => ({ key: `${r}-${k}-${i}`, x1: from[k] as number, y1, x2, y2 }));
  });
}

function busLine(row: DiagramRow, r: number): Line[] {
  if (row.join !== "bus" || row.n < 2) return [];
  const x = xs(row.n);
  const y = TOP + r * STEP + BOX_H / 2;
  return [{ key: `bus-${r}`, x1: x[0] as number, y1: y, x2: x[x.length - 1] as number, y2: y }];
}

export function ChipArt({ diagram }: { readonly diagram: Diagram }) {
  const { rows, cut } = diagram;
  const height = TOP + rows.length * STEP;
  const lines = rows.flatMap((row, r) => [
    ...(r > 0 ? linesBetween(rows[r - 1] as DiagramRow, row, r) : []),
    ...busLine(row, r),
  ]);
  return (
    <svg className="we-art" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={diagram.alt}>
      {lines.map((l) => (
        <line key={l.key} className="w" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
      ))}
      {rows.map((row, r) => {
        const y = TOP + r * STEP;
        return (
          <g key={row.label}>
            <text className="t" x={4} y={y + BOX_H - 4}>
              {row.label}
            </text>
            {xs(row.n).map((x, i) => (
              <g key={`${row.label}-${x}`} className={`b r${Math.min(r, 2)}`}>
                <rect x={x - BOX_W / 2} y={y} width={BOX_W} height={BOX_H} rx={4} />
                {cut && cut[0] === r && cut[1] === i && (
                  <g className="x">
                    <line
                      x1={x - BOX_W / 2 - 2}
                      y1={y + BOX_H + 2}
                      x2={x + BOX_W / 2 + 2}
                      y2={y - 2}
                    />
                    <circle cx={x + BOX_W / 2} cy={y - 1} r={7} />
                    <text x={x + BOX_W / 2} y={y + 2.5} textAnchor="middle">
                      ×
                    </text>
                  </g>
                )}
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
