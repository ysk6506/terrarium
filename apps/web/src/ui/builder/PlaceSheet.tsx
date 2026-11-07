/**
 * "놓기" (REQ-102, ADR-0123): the one button at the top left of the 3D view, in place of the left palette. It opens a small
 * sheet of only what fits the stage the person is on; a kind with several types asks the type next. Esc or a press
 * outside closes it. The button is primary while nothing is picked and secondary once something is.
 */
import { useEffect, useRef, useState } from "react";
import { builder, won } from "../../logic";
import { Button } from "../kit";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";
import { widenRoom } from "./widen";

/** What is at this level that decides which kinds say a line. */
export function viewOf(b: Builder): builder.ToolView {
  const { index, level, blueprint } = b.state;
  return {
    buildings: index.ofKind("building").length,
    forSale: builder.parcelViews(index, catalog).filter((p) => !p.owned).length,
    rooms: level.kind === "floor" ? index.childrenOf(level.id, "room").length : 0,
    roomFull: level.kind === "room" && builder.roomFull(blueprint, catalog, level.id),
  };
}

/** Close on Esc (before the builder's own Esc runs) and on a press outside the panel. */
function useDismiss(open: boolean, close: () => void) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      close();
    };
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", away, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", away, true);
    };
  }, [open, close]);
  return box;
}

function Kinds(props: {
  readonly kinds: readonly builder.PlaceKind[];
  readonly onChoose: (k: builder.PlaceKind) => void;
}) {
  return (
    <>
      {props.kinds.map((k) => {
        const none = !k.direct && !k.ask;
        return (
          <button
            key={k.id}
            type="button"
            role="menuitem"
            className="place-item"
            data-moss-skip="3D 위에 놓는 일은 사람 몫이에요"
            disabled={none}
            onClick={() => props.onChoose(k)}
          >
            {k.title}
            <small>{k.line}</small>
          </button>
        );
      })}
    </>
  );
}

/** The land for sale, one line each: pressing one buys it (the price is said before, not after). */
function Land({ b, onDone }: { readonly b: Builder; readonly onDone: () => void }) {
  const parcels = builder.parcelViews(b.state.index, catalog).filter((p) => !p.owned);
  return (
    <>
      {parcels.map((p) => (
        <button
          key={p.id}
          type="button"
          role="menuitem"
          className="place-item"
          data-moss-skip="땅을 사는 일은 값을 보고 사람이 정해요"
          aria-label={`${p.name}, ${won(p.priceM)}에 사기`}
          onClick={() => {
            b.apply(
              (bp) => builder.buyParcel(bp, p.id),
              `${p.name}을 샀어요. 이제 건물을 지을 수 있어요`,
            );
            onDone();
          }}
        >
          {p.name}
          <small>{won(p.priceM)}에 사기</small>
        </button>
      ))}
    </>
  );
}

export function PlaceSheet({ b }: { readonly b: Builder }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<builder.PlaceKind>();
  const { level, tool, selected } = b.state;
  const close = () => {
    setOpen(false);
    setAsking(undefined);
  };
  const box = useDismiss(open, close);
  const holding = tool.kind !== "select";
  const kinds = builder.placeKinds(level, catalog, viewOf(b));
  const choose = (k: builder.PlaceKind) => {
    if (k.ask) return setAsking(k);
    if (k.direct?.kind === "widen") widenRoom(b);
    else if (k.direct) b.setTool(k.direct.tool);
    close();
  };
  return (
    <div className="place" ref={box}>
      <Button
        kind={selected.length === 0 && !holding ? "primary" : "plain"}
        aria-haspopup="menu"
        aria-expanded={open}
        data-moss-skip="3D 위에 놓는 일은 사람 몫이에요"
        onClick={() => {
          if (holding) return b.setTool({ kind: "select" });
          setOpen((o) => !o);
          setAsking(undefined);
        }}
      >
        {holding ? "그만 놓기" : "놓기"}
      </Button>
      {open && (
        <div className="place-sheet" role="menu" aria-label={asking ? asking.title : "놓을 것"}>
          {asking ? (
            <>
              <button
                type="button"
                className="place-back"
                data-moss-skip="시트를 한 걸음 되돌리는 보기 조작"
                onClick={() => setAsking(undefined)}
              >
                ‹ {asking.title}
              </button>
              {asking.id === "land" && <Land b={b} onDone={close} />}
              {asking.ask?.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  role="menuitem"
                  className="place-item"
                  data-moss-skip="3D 위에 놓는 일은 사람 몫이에요"
                  title={p.hint}
                  onClick={() => {
                    b.setTool(p.tool);
                    close();
                  }}
                >
                  {p.label.split(" — ").at(-1)}
                  <small>{p.hint}</small>
                </button>
              ))}
            </>
          ) : (
            <Kinds kinds={kinds} onChoose={choose} />
          )}
        </div>
      )}
    </div>
  );
}
