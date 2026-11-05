/**
 * The size of the room or building picked (REQ-075, ADR-0079, ADR-0080, REQ-077): width and depth to type, the pieces
 * of a room to choose and take off, its area in square metres, and — when an edit was refused — the way on. The
 * reason was said once already, next to the pointer. The handles and the + on the 3D view do the same by dragging.
 */
import { withJosa } from "@terrarium/core/kernel";
import type { Blueprint, Entity } from "@terrarium/core/world";
import { useEffect, useState } from "react";
import { builder, count } from "../../logic";
import { Button, Field, Note } from "../kit";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";

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

/** The way on from a refused edit. The reason itself was said once, next to the pointer; the panel keeps only the way. */
function RefusalWay({ b }: { readonly b: Builder }) {
  const { refusal, index } = b.state;
  const way = refusal?.way;
  const target = way ? index.find(way.entityId) : undefined;
  if (!way || !target) return null;
  return (
    <div className="row">
      {way.kind === "widen-building" ? (
        <Button size="small" onClick={() => b.go(builder.levelOf(index, target.id))}>
          건물 넓히기
        </Button>
      ) : way.kind === "other-floor" ? (
        <Button size="small" onClick={() => b.go({ kind: "floor", id: target.id })}>
          {withJosa(target.name, "으로")} 가기
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
  );
}

/** How big it is, in square metres: tiles are the builder's unit, not the person's. */
function Totals({ entity }: { readonly entity: Entity }) {
  const area = builder.shapeOf(entity).reduce((sum, r) => sum + r.w * r.d, 0);
  return (
    <p className="small" data-testid="size-totals">
      넓이 {count(Math.round(area))} m²
    </p>
  );
}

/** Apply an edit to the thing whose size is shown; for a room, say how many racks more the new floor takes (REQ-076). */
function changer(entity: Entity, b: Builder) {
  return (make: (bp: Blueprint) => builder.Edit): boolean => {
    let text: string | undefined;
    const made = b.apply((bp) => {
      const edit = make(bp);
      text =
        entity.kind === "room" ? builder.racksGainText(bp, edit.blueprint, entity.id) : undefined;
      return edit;
    });
    if (made && text) b.setGain({ id: entity.id, text });
    return made;
  };
}

/** Taking off the piece that is chosen, and where the shape is changed: the + on the 3D view. */
function PieceControls(props: {
  readonly entity: Entity;
  readonly b: Builder;
  readonly piece: number | undefined;
}) {
  const { entity, b, piece } = props;
  return (
    <div className="stack" style={{ gap: 6 }}>
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
      <p className="tiny muted">모양을 바꾸려면 테두리의 +를 끌어요.</p>
    </div>
  );
}

export function SizePanel({ entity, b }: { readonly entity: Entity; readonly b: Builder }) {
  const shape = builder.shapeOf(entity);
  const room = entity.kind === "room";
  const pieces = shape.length - 1;
  const piece = b.state.piece !== undefined && b.state.piece < pieces ? b.state.piece : undefined;
  const rect = shape[piece === undefined ? 0 : piece + 1];
  if (!rect) return null;
  const change = changer(entity, b);
  const resize = (next: { w?: number; d?: number }): boolean =>
    change((bp) =>
      piece === undefined
        ? builder.resizeBody(bp, catalog, entity.id, { ...rect, ...next })
        : builder.resizePiece(bp, catalog, entity.id, piece, { ...rect, ...next }),
    );
  const label = piece === undefined ? (room ? "서버룸" : "건물") : `조각 ${piece + 1}`;
  return (
    <div className="builder-block stack" data-testid="size-panel">
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
      <Totals entity={entity} />
      {b.state.gain?.id === entity.id && (
        <Note tone="good">
          <span data-testid="rack-gain">{b.state.gain.text}</span>
        </Note>
      )}
      {room && <PieceControls entity={entity} b={b} piece={piece} />}
      {!room && <p className="tiny muted">건물은 5 m 단위로 바뀌어요.</p>}
      <RefusalWay b={b} />
    </div>
  );
}
