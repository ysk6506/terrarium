/**
 * 서비스부터 ② (ADR-0107 item 3, ADR-0108 item 4): eight layers, each a ladder from cheap-and-often-down to dear-and-rarely-
 * down, a preset row, and on the right the card of the choice under the hand and what the eight come to. Each ladder is a
 * radio group; a choice shows its card when pointed at, focused or pressed.
 */
import { withJosa } from "@terrarium/core/kernel";
import { SERVICE_LAYERS, type ServiceDraft } from "@terrarium/core/sources/worldgen";
import { LAYER_IDS, type LayerId } from "@terrarium/core/world";
import { type KeyboardEvent, useState } from "react";
import {
  type Chip,
  chipsOfLayer,
  LAYER_INFO,
  PRESET_LABELS,
  type PresetId,
  type ShapeView,
} from "../../logic";
import { Check } from "../kit";
import { ChipDetail } from "./chip-card";
import type { Flow, LadderState } from "./shape-flow";
import { ShapePanel } from "./shape-panel";
import { SameShape } from "./shape-same";

const PRESETS: readonly PresetId[] = ["auto", "cheap", "middle", "steady"];

function Presets({ state, layers }: { readonly state: LadderState; readonly layers: number }) {
  return (
    <div className="we-presets" role="radiogroup" aria-label="한꺼번에 고르기">
      {PRESETS.map((p) => (
        // biome-ignore lint/a11y/useSemanticElements: a radio group of chips; the arrows move the choice
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={state.preset === p}
          className={`we-pre${p === "auto" ? " auto" : ""}`}
          onClick={() => state.applyPreset(p)}
        >
          {PRESET_LABELS[p]}
        </button>
      ))}
      <span className="we-hint">
        누르면 {layers === LAYER_IDS.length ? "여덟" : "네"} 층이 한꺼번에 바뀌어요 ·{" "}
        <span className="we-soonkey">점선</span>은 아직 흉내 낼 수 없어요
      </span>
    </div>
  );
}

function OwnLayers({ flow }: { readonly flow: Flow }) {
  const [open, setOpen] = useState(false);
  const names = flow.own.map((l) => LAYER_INFO[l].name).join(" · ");
  return (
    <>
      <p className="we-domain">
        {flow.own.length > 0 ? (
          <>
            운영하는 층 <b>{names}</b> · 나머지 층은 알아서 골라져 있어요 ·{" "}
          </>
        ) : (
          <>운영하는 층을 아직 안 골랐어요 · 여덟 층 모두 알아서 골라져 있어요 · </>
        )}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          바꾸기
        </button>
      </p>
      {open && (
        <fieldset className="we-own">
          <legend>내가 운영하는 층 (실험 설정의 내 도메인이 생기면 거기서 가져와요)</legend>
          {LAYER_IDS.map((l) => (
            <Check
              key={l}
              label={LAYER_INFO[l].name}
              checked={flow.own.includes(l)}
              onChange={(on) => {
                flow.setOwn(on ? [...flow.own, l] : flow.own.filter((x) => x !== l));
                if (!on) flow.choose(l, undefined);
              }}
            />
          ))}
        </fieldset>
      )}
    </>
  );
}

interface LadderProps {
  readonly layer: LayerId;
  readonly state: LadderState;
  readonly shown: string;
  readonly onShow: (chip: string) => void;
}

function ChipButton(props: {
  readonly chip: Chip;
  readonly checked: boolean;
  readonly picked: boolean;
  readonly shown: boolean;
  readonly tab: boolean;
  readonly onShow: () => void;
  readonly onPress: () => void;
}) {
  const { chip } = props;
  const classes = [
    "we-o",
    !chip.mech.modeled && "soon",
    props.picked && "picked",
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
      title={chip.mech.modeled ? undefined : "아직 흉내 낼 수 없어요"}
      onPointerEnter={props.onShow}
      onFocus={props.onShow}
      onClick={props.onPress}
    >
      {chip.card.label}
    </button>
  );
}

function Ladder({ layer, state, shown, onShow }: LadderProps) {
  const chips = chipsOfLayer(layer);
  const manual = state.manual[layer];
  const resolved = state.layers[layer];
  const auto = manual === undefined;
  const info = LAYER_INFO[layer];
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const ids = [undefined, ...chips.map((c) => c.card.id)];
    const at = ids.indexOf(manual);
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? at + 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? at - 1
          : at;
    if (next === at || next < 0 || next >= ids.length) return;
    e.preventDefault();
    state.choose(layer, ids[next]);
    onShow(ids[next] ?? resolved);
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]");
    buttons[next]?.focus();
  };
  const card = chips.find((c) => c.card.id === resolved)?.card;
  return (
    <fieldset className="we-layer">
      <legend className="sr-only">
        {info.name}, {info.question}
      </legend>
      <div className="we-lname" aria-hidden="true">
        {info.name}
        <small>{info.question}</small>
      </div>
      <div
        className="we-ladder"
        role="radiogroup"
        aria-label={`${info.name} 고르기`}
        onKeyDown={move}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: a radio group of chips; the arrows move the choice */}
        <button
          type="button"
          role="radio"
          aria-checked={auto}
          tabIndex={auto ? 0 : -1}
          className="we-o auto"
          onPointerEnter={() => onShow(resolved)}
          onFocus={() => onShow(resolved)}
          onClick={() => state.choose(layer, undefined)}
        >
          알아서
        </button>
        {chips.map((chip) => (
          <ChipButton
            key={chip.card.id}
            chip={chip}
            checked={manual === chip.card.id}
            picked={auto && resolved === chip.card.id}
            shown={shown === chip.card.id}
            tab={manual === chip.card.id}
            onShow={() => onShow(chip.card.id)}
            onPress={() => {
              state.choose(layer, chip.card.id);
              onShow(chip.card.id);
            }}
          />
        ))}
      </div>
      <p className="we-why">{auto ? state.why[layer] : (card?.result ?? "")}</p>
    </fieldset>
  );
}

/** The card that follows the ladder under the hand; on a screen with fewer ladders it starts on the first of them. */
function cardPoint(
  pointed: { layer: LayerId; chip: string },
  layers: readonly LayerId[],
  state: LadderState,
): { layer: LayerId; chip: string } {
  const first = layers[0] as LayerId;
  return layers.includes(pointed.layer) ? pointed : { layer: first, chip: state.layers[first] };
}

/** Above the ladders: which layers the person operates, or what a service that chose its own shape shares with the world. */
function Lead({
  flow,
  service,
}: {
  readonly flow: Flow;
  readonly service?: ServiceDraft | undefined;
}) {
  if (!service) return <OwnLayers flow={flow} />;
  return (
    <p className="we-domain" data-testid="apart-note">
      {withJosa(service.name, "은")} 컴퓨트·스토리지·데이터베이스·앱을 따로 골라요.
      네트워크·전원·냉방·사업장은 건물 하나라 서비스 1과 같아요 ·{" "}
      <button type="button" onClick={() => flow.setApart(service, false)}>
        같은 모양으로 되돌리기
      </button>
    </p>
  );
}

/** The ladders the world is shaped by, or those of a service that chose its own. */
function worldState(flow: Flow): LadderState {
  return {
    manual: flow.manual,
    layers: flow.spec.layers,
    why: flow.why,
    preset: flow.preset,
    choose: flow.choose,
    applyPreset: flow.applyPreset,
  };
}

export function LaddersStep({ flow, view }: { readonly flow: Flow; readonly view: ShapeView }) {
  const { services } = flow.spec;
  const at = Math.min(flow.ladder, services.length - 1);
  const service = services[at];
  const apart = service && at > 0 ? flow.apartOf(service) : undefined;
  const state = apart ?? worldState(flow);
  const layers = apart ? SERVICE_LAYERS : LAYER_IDS;
  const [pointed, setShown] = useState<{ layer: LayerId; chip: string }>({
    layer: "network",
    chip: flow.spec.layers.network,
  });
  const shown = cardPoint(pointed, layers, state);
  const show = (layer: LayerId) => (chip: string) => setShown({ layer, chip });
  const title = service?.name ?? "서비스";
  const many = services.length > 1;
  if (service && at > 0 && !apart)
    return <SameShape flow={flow} service={service} view={view} at={at} />;
  return (
    <>
      <div className="we-qhead">
        <h1>{withJosa(title, "는")} 어떻게 돌리나요?</h1>
        <span className="we-step">{many ? `서비스 ${at + 1} / ${services.length}` : "2 / 3"}</span>
      </div>
      <p className="we-sub">
        층마다 하나씩 골라요. 왼쪽일수록 싸고 자주 멈추고, 오른쪽일수록 비싸고 잘 안 멈춰요. 누르면
        오른쪽에 그림과 설명이 떠요. 모르는 층은 <b>알아서</b>를 누르면 돼요.
      </p>
      <Lead flow={flow} service={apart ? service : undefined} />
      <Presets state={state} layers={layers.length} />
      <div className="we-layers">
        <div className="we-lcol">
          {layers.map((layer) => (
            <Ladder
              key={layer}
              layer={layer}
              state={state}
              shown={shown.layer === layer ? shown.chip : ""}
              onShow={show(layer)}
            />
          ))}
        </div>
        <div className="we-rcol">
          <ChipDetail
            layer={shown.layer}
            chipId={shown.chip}
            onShow={(chip) => setShown({ layer: shown.layer, chip })}
          />
          <ShapePanel view={view} />
        </div>
      </div>
    </>
  );
}
