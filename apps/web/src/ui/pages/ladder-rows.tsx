/**
 * The eight rows of the ladder screen (REQ-102, ADR-0123): closed, a row is the layer, the one choice and a grey line of
 * why; open, it unfolds a rail of equal choices and one line of what choosing the one under the hand comes to. A choice
 * whose need is not met is muted and asks first (ADR-0123 item 3).
 */
import { josa, withJosa } from "@terrarium/core/kernel";
import {
  LAYER_IDS,
  type LayerId,
  type Layers,
  unmetNeeds,
  withChoice,
} from "@terrarium/core/world";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { type Chip, cardOf, chipsOfLayer, LAYER_INFO } from "../../logic";
import type { LadderState } from "./shape-flow";

/** One layer of the screen: the choice that stands, and why it stands. */
export interface RowFacts {
  readonly layer: LayerId;
  readonly label: string;
  readonly auto: boolean;
  readonly why: string;
}

export function rowFacts(layer: LayerId, state: LadderState): RowFacts {
  const resolved = state.layers[layer];
  const auto = state.manual[layer] === undefined;
  return {
    layer,
    label: cardOf(resolved)?.label ?? resolved,
    auto,
    why: auto ? `알아서${state.why[layer] ? ` · ${state.why[layer]}` : ""}` : "직접 골랐어요",
  };
}

export function LayerRow(props: {
  readonly facts: RowFacts;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const { facts, open } = props;
  return (
    <button
      type="button"
      className={`we-row${open ? " open" : ""}`}
      aria-expanded={open}
      aria-controls={`we-detail-${facts.layer}`}
      onClick={props.onToggle}
    >
      <span className="we-ln">{LAYER_INFO[facts.layer].name}</span>
      <span className="we-pick">
        <span className={`we-ch${facts.auto ? " auto" : ""}`}>{facts.label}</span>
        <small>{facts.why}</small>
      </span>
      <span className="we-arr" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

/** "클라우드 네이티브는 컴퓨트가 컨테이너 오케스트레이션이어야 골라져요" — what a muted choice waits for. */
export function needText(layers: Layers, layer: LayerId, chip: string): string {
  const label = cardOf(chip)?.label ?? chip;
  const clauses = unmetNeeds(layers, layer, chip).map((need) => {
    const spots = [need, ...(need.orElse ? [need.orElse] : [])];
    return spots
      .map((spot, i) => {
        const name = cardOf(spot.atLeast)?.label ?? spot.atLeast;
        const place = withJosa(LAYER_INFO[spot.layer].name, "이");
        const last = i === spots.length - 1;
        const batchim = josa(name, "이") === "이";
        const tail = last ? (batchim ? "이어야" : "여야") : batchim ? "이거나" : "거나";
        return `${place} ${name}${tail}`;
      })
      .join(" ");
  });
  return `${withJosa(label, "은")} ${clauses.join(" · ")} 골라져요`;
}

/** The layers a press on "바꾸기" changes besides the one pressed. */
export function alsoChanged(layers: Layers, layer: LayerId, chip: string): readonly LayerId[] {
  const next = withChoice(layers, layer, chip);
  return LAYER_IDS.filter((l) => l !== layer && next[l] !== layers[l]);
}

export interface Notice {
  readonly layer: LayerId;
  readonly chip: string;
}

function NeedNotice(props: {
  readonly layers: Layers;
  readonly notice: Notice;
  readonly editable: readonly LayerId[];
  readonly onFix: () => void;
  readonly onClose: () => void;
}) {
  const { layers, notice, editable } = props;
  const also = alsoChanged(layers, notice.layer, notice.chip);
  const fixable = also.every((l) => editable.includes(l));
  const names = also.map((l) => LAYER_INFO[l].name).join("·");
  return (
    <div className="we-need" role="alert">
      <p>{needText(layers, notice.layer, notice.chip)}</p>
      <div className="we-need-acts">
        {fixable ? (
          <button type="button" className="we-need-fix" onClick={props.onFix}>
            {names}도 바꾸기
          </button>
        ) : (
          <span className="we-need-away">{names}은 서비스 1과 같아서 거기서 바꿔요</span>
        )}
        <button type="button" className="we-need-quit" onClick={props.onClose}>
          그만두기
        </button>
      </div>
    </div>
  );
}

function RailChip(props: {
  readonly chip: Chip;
  readonly checked: boolean;
  readonly auto: boolean;
  readonly unmet: boolean;
  readonly shown: boolean;
  readonly tab: boolean;
  readonly onShow: () => void;
  readonly onPress: () => void;
}) {
  const { chip } = props;
  const classes = [
    "we-rc",
    props.checked && "on",
    props.checked && props.auto && "auto",
    !chip.mech.modeled && "soon",
    props.unmet && "unmet",
    props.shown && "shown",
  ];
  return (
    // biome-ignore lint/a11y/useSemanticElements: a radio group of chips; the arrows move the choice
    <button
      type="button"
      role="radio"
      aria-checked={props.checked}
      tabIndex={props.tab ? 0 : -1}
      className={classes.filter(Boolean).join(" ")}
      title={
        props.unmet
          ? "먼저 필요한 것이 있어요"
          : chip.mech.modeled
            ? undefined
            : "아직 흉내 낼 수 없어요"
      }
      onPointerEnter={props.onShow}
      onFocus={props.onShow}
      onClick={props.onPress}
    >
      {chip.card.label}
    </button>
  );
}

export interface DetailProps {
  readonly layer: LayerId;
  readonly state: LadderState;
  readonly shown: string;
  readonly notice: Notice | undefined;
  /** The layers this screen can change (a service that chose its own changes four). */
  readonly editable: readonly LayerId[];
  readonly onShow: (chip: string) => void;
  readonly onPick: (chip: string) => void;
  readonly onFix: () => void;
  readonly onCloseNotice: () => void;
}

/** The open layer: a rail of equal choices, one line of what the one under the hand comes to, and a notice if one asks. */
export function LayerDetail(props: DetailProps) {
  const { layer, state, shown } = props;
  const chips = chipsOfLayer(layer);
  const manual = state.manual[layer];
  const resolved = state.layers[layer];
  const auto = manual === undefined;
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rail.current?.querySelector<HTMLButtonElement>("[tabindex='0']")?.focus();
  }, []);
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = chips.findIndex((c) => c.card.id === shown);
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? at + 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? at - 1
          : at;
    const to = chips[next];
    if (next === at || !to) return;
    e.preventDefault();
    props.onShow(to.card.id);
    rail.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
  };
  const onCard = chips.find((c) => c.card.id === shown)?.card;
  return (
    <div className="we-rdetail" id={`we-detail-${layer}`}>
      <div className="we-rbox">
        <span className="we-end l">싸게 · 자주 멈춤</span>
        <span className="we-end r">비싸게 · 잘 안 멈춤</span>
        <div
          ref={rail}
          className="we-rail"
          role="radiogroup"
          aria-label={`${LAYER_INFO[layer].name} 고르기`}
          style={{ gridTemplateColumns: `repeat(${chips.length}, 1fr)` }}
          onKeyDown={move}
        >
          {chips.map((chip) => (
            <RailChip
              key={chip.card.id}
              chip={chip}
              checked={resolved === chip.card.id}
              auto={auto}
              unmet={
                unmetNeeds({ ...state.layers, [layer]: chip.card.id }, layer, chip.card.id).length >
                0
              }
              shown={shown === chip.card.id}
              tab={shown === chip.card.id}
              onShow={() => props.onShow(chip.card.id)}
              onPress={() => props.onPick(chip.card.id)}
            />
          ))}
        </div>
      </div>
      <p className="we-why2">
        <b>이걸 고르면</b> {onCard?.result ?? ""}
        {!auto && (
          <button type="button" className="we-back" onClick={() => state.choose(layer, undefined)}>
            알아서로 되돌리기
          </button>
        )}
      </p>
      {props.notice?.layer === layer && (
        <NeedNotice
          layers={state.layers}
          notice={props.notice}
          editable={props.editable}
          onFix={props.onFix}
          onClose={props.onCloseNotice}
        />
      )}
    </div>
  );
}
