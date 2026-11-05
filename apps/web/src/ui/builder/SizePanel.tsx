/**
 * The size of the room or building picked (REQ-075, ADR-0079, ADR-0080): width and depth to type, the pieces of a
 * room to choose, attach and take off, what it comes to in tiles and money, and — when an edit was refused — the
 * reason with the way on. The handles on the 3D view do the same things by dragging.
 */
import type { Entity } from "@terrarium/core/world";
import { useEffect, useState } from "react";
import { builder, count, won } from "../../logic";
import { Button, Field, Note } from "../kit";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";

const DEFAULT_OUT_M = 3.6;
const DEFAULT_ALONG_M = 7.2;

/** A number box that applies on Enter or when you leave it, so typing "14.4" is one change and not three. */
function SizeBox(props: {
  readonly label: string;
  readonly value: number;
  readonly onCommit: (v: number) => boolean;
  readonly testId: string;
}) {
  // Sizes are tile multiples (0.6 m), so float sums show as 21.400000000000002 unless rounded.
  const shown = String(Math.round(props.value * 100) / 100);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const n = Number(text.replace(",", "."));
    // A refused size puts the old number back; the reason is in the toast.
    if (!(Number.isFinite(n) && n > 0 && n !== props.value && props.onCommit(n))) setText(shown);
  };
  return (
    <Field label={props.label}>
      {({ id }) => (
        <div className="input-unit">
          <input
            id={id}
            className="input"
            inputMode="decimal"
            data-testid={props.testId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <span className="unit">m</span>
        </div>
      )}
    </Field>
  );
}

/** Body, then one chip per piece: which rectangle of the room the boxes below are about. */
function PieceChips({ room, b }: { readonly room: Entity; readonly b: Builder }) {
  const pieces = builder.shapeOf(room).length - 1;
  if (pieces === 0) return null;
  const chosen = b.state.piece !== undefined && b.state.piece < pieces ? b.state.piece : undefined;
  return (
    <div className="row">
      <Button
        size="small"
        kind={chosen === undefined ? "quiet" : "plain"}
        aria-pressed={chosen === undefined}
        onClick={() => b.setPiece(undefined)}
      >
        본체
      </Button>
      {Array.from({ length: pieces }, (_, i) => (
        <Button
          key={`piece-${i + 1}`}
          size="small"
          kind={chosen === i ? "quiet" : "plain"}
          aria-pressed={chosen === i}
          onClick={() => b.setPiece(i)}
        >
          조각 {i + 1}
        </Button>
      ))}
    </div>
  );
}

/** What the refused edit was and where to go from there. */
function RefusalNote({ b }: { readonly b: Builder }) {
  const { refusal, index } = b.state;
  if (!refusal) return null;
  const way = refusal.way;
  const target = way ? index.find(way.entityId) : undefined;
  return (
    <Note tone="bad">
      {refusal.message}
      {way && target && (
        <div style={{ marginTop: 6 }}>
          {way.kind === "widen-building" ? (
            <Button size="small" onClick={() => b.go(builder.levelOf(index, target.id))}>
              건물 넓히기
            </Button>
          ) : (
            <Button
              size="small"
              onClick={() => {
                b.go({ kind: "site" });
                b.setTool({ kind: "buy" });
              }}
            >
              옆 땅 사기
            </Button>
          )}
        </div>
      )}
    </Note>
  );
}

function Totals({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const area = builder.shapeOf(entity).reduce((sum, r) => sum + r.w * r.d, 0);
  const cost = builder.structureOfM(b.state.blueprint, catalog, entity.id);
  return (
    <p className="small" data-testid="size-totals">
      {entity.kind === "room"
        ? `타일 ${count(builder.tileCount(entity))}장`
        : `${count(Math.round(area))}㎡`}{" "}
      · 건설비 {won(cost)}
    </p>
  );
}

export function SizePanel({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const shape = builder.shapeOf(entity);
  const room = entity.kind === "room";
  const pieces = shape.length - 1;
  const piece = b.state.piece !== undefined && b.state.piece < pieces ? b.state.piece : undefined;
  const rect = shape[piece === undefined ? 0 : piece + 1];
  if (!rect) return null;
  const resize = (next: { w?: number; d?: number }): boolean =>
    b.apply((bp) =>
      piece === undefined
        ? builder.resizeBody(bp, catalog, entity.id, { ...rect, ...next })
        : builder.resizePiece(bp, catalog, entity.id, piece, { ...rect, ...next }),
    );
  const attach = (side: builder.Side) => {
    const sideways = side === "left" || side === "right";
    const along = Math.min(sideways ? rect.d : rect.w, DEFAULT_ALONG_M);
    const at = piece === undefined ? 0 : piece + 1;
    const made = b.apply((bp) =>
      builder.addPiece(bp, catalog, entity.id, side, { along, out: DEFAULT_OUT_M }, { to: at }),
    );
    if (made) b.setPiece(pieces);
  };
  const label = piece === undefined ? (room ? "서버룸" : "건물") : `조각 ${piece + 1}`;
  return (
    <div className="builder-block stack" data-testid="size-panel">
      <h3>{room ? "서버룸 크기" : "건물 크기"}</h3>
      {room && <PieceChips room={entity} b={b} />}
      <div className="row">
        <SizeBox
          label={`${label} 가로`}
          value={rect.w}
          testId="size-w"
          onCommit={(w) => resize({ w })}
        />
        <SizeBox
          label={`${label} 세로`}
          value={rect.d}
          testId="size-d"
          onCommit={(d) => resize({ d })}
        />
      </div>
      <Totals entity={entity} b={b} />
      {room && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="small" style={{ fontWeight: 600 }}>
            조각 덧붙이기
          </div>
          <div className="row">
            {builder.SIDES.map((side) => (
              <Button key={side} size="small" onClick={() => attach(side)}>
                {builder.SIDE_LABELS[side]}
              </Button>
            ))}
          </div>
          {piece !== undefined && (
            <Button
              size="small"
              icon="trash"
              onClick={() => {
                if (b.apply((bp) => builder.removePiece(bp, catalog, entity.id, piece)))
                  b.setPiece(undefined);
              }}
            >
              조각 떼기
            </Button>
          )}
          <p className="tiny muted">
            3D 화면에서는 변 가운데의 네모를 끌면 넓어지고, 바깥의 +를 끌어내면 조각이 붙어요.
          </p>
        </div>
      )}
      {!room && <p className="tiny muted">건물은 5 m 단위로 바뀌어요. 안의 방이 잘리면 막아요.</p>}
      <RefusalNote b={b} />
    </div>
  );
}
