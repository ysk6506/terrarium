/**
 * 서비스부터 ② (ADR-0107 item 3, ADR-0108 item 4, ADR-0123): eight quiet rows, one layer open at a time. Closed, a row says the
 * one choice that stands and why; open, it unfolds the ladder, and the right column turns from "이 모양이면" into the
 * structure card of the choice under the hand. The same screen serves a service that chose its own shape.
 */
import { withJosa } from "@terrarium/core/kernel";
import { SERVICE_LAYERS, type ServiceDraft } from "@terrarium/core/sources/worldgen";
import {
  LAYER_IDS,
  type LayerId,
  pointlessOf,
  unmetNeeds,
  withChoice,
} from "@terrarium/core/world";
import { type KeyboardEvent, type RefObject, useRef, useState } from "react";
import { PRESET_LABELS, type PresetId, type ShapeView } from "../../logic";
import { ChipDetail } from "./chip-card";
import { LayerDetail, LayerRow, type Notice, rowFacts } from "./ladder-rows";
import type { Flow, LadderState } from "./shape-flow";
import { ShapePanel } from "./shape-panel";
import { SameShape } from "./shape-same";

const PRESETS: readonly PresetId[] = ["auto", "cheap", "middle", "steady"];

function Presets({ state }: { readonly state: LadderState }) {
  return (
    <div className="we-presets" role="radiogroup" aria-label="한꺼번에 고르기">
      {PRESETS.map((p) => (
        // biome-ignore lint/a11y/useSemanticElements: a radio group of pills; the press is the choice
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={state.preset === p}
          className="we-pre"
          onClick={() => state.applyPreset(p)}
        >
          {PRESET_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

/** Above the ladders, only for a service that chose its own shape: what it shares with the world. */
function Lead({ flow, service }: { readonly flow: Flow; readonly service: ServiceDraft }) {
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

/** One line in the warn colour under a row, for a pair that is allowed but makes little sense. */
function Pointless({ pair }: { readonly pair: ReturnType<typeof pointlessOf>[number] }) {
  return <p className="we-warn">{pair.note}</p>;
}

/** What the open layer does when a choice is pressed: take it, or ask first when its need is not met. */
function useOpen(state: LadderState, editable: readonly LayerId[]) {
  const [open, setOpen] = useState<LayerId>();
  const [shown, setShown] = useState("");
  const [notice, setNotice] = useState<Notice>();
  const toggle = (layer: LayerId) => {
    setNotice(undefined);
    if (open === layer) return setOpen(undefined);
    setOpen(layer);
    setShown(state.layers[layer]);
  };
  const pick = (layer: LayerId, chip: string) => {
    setShown(chip);
    if (unmetNeeds({ ...state.layers, [layer]: chip }, layer, chip).length > 0)
      return setNotice({ layer, chip });
    setNotice(undefined);
    state.choose(layer, chip);
  };
  const fix = () => {
    if (!notice) return;
    const next = withChoice(state.layers, notice.layer, notice.chip);
    for (const l of editable) if (next[l] !== state.layers[l]) state.choose(l, next[l]);
    setNotice(undefined);
  };
  return {
    open,
    shown,
    notice,
    toggle,
    pick,
    fix,
    setShown,
    close: () => setOpen(undefined),
    clear: () => setNotice(undefined),
  };
}

/** Esc closes the open layer and hands the focus back to its row. */
function escapeOf(ui: ReturnType<typeof useOpen>, table: RefObject<HTMLDivElement | null>) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || !ui.open) return;
    e.preventDefault();
    e.stopPropagation();
    table.current?.querySelector<HTMLButtonElement>(`[data-layer="${ui.open}"]`)?.focus();
    ui.close();
  };
}

function QHead(props: { readonly title: string; readonly at: number; readonly count: number }) {
  const step = props.count > 1 ? `서비스 ${props.at + 1} / ${props.count}` : "2 / 3";
  return (
    <div className="we-qhead">
      <h1>{withJosa(props.title, "는")} 어떻게 돌리나요?</h1>
      <span className="we-step">{step}</span>
    </div>
  );
}

function RightColumn(props: { readonly ui: ReturnType<typeof useOpen>; readonly view: ShapeView }) {
  const { ui, view } = props;
  return (
    <div className="we-rcol">
      {ui.open ? (
        <ChipDetail layer={ui.open} chipId={ui.shown} onShow={ui.setShown} />
      ) : (
        <ShapePanel view={view} />
      )}
    </div>
  );
}

function Rows(props: {
  readonly ui: ReturnType<typeof useOpen>;
  readonly state: LadderState;
  readonly layers: readonly LayerId[];
  readonly pairs: ReturnType<typeof pointlessOf>;
}) {
  const { ui, state, layers, pairs } = props;
  return (
    <>
      {layers.map((layer) => (
        <section key={layer} className="we-lrow" aria-label={layer}>
          <LayerRow
            facts={rowFacts(layer, state)}
            open={ui.open === layer}
            onToggle={() => ui.toggle(layer)}
          />
          {ui.open === layer && (
            <LayerDetail
              layer={layer}
              state={state}
              shown={ui.shown}
              notice={ui.notice}
              editable={layers}
              onShow={ui.setShown}
              onPick={(chip) => ui.pick(layer, chip)}
              onFix={ui.fix}
              onCloseNotice={ui.clear}
            />
          )}
          {pairs
            .filter((p) => p.layer === layer || p.other === layer)
            .map((p) => (
              <Pointless key={`${p.chip}-${p.otherChip}`} pair={p} />
            ))}
        </section>
      ))}
    </>
  );
}

export function LaddersStep({ flow, view }: { readonly flow: Flow; readonly view: ShapeView }) {
  const { services } = flow.spec;
  const at = Math.min(flow.ladder, services.length - 1);
  const service = services[at];
  const apart = service && at > 0 ? flow.apartOf(service) : undefined;
  const state = apart ?? worldState(flow);
  const layers = apart ? SERVICE_LAYERS : LAYER_IDS;
  const ui = useOpen(state, layers);
  const table = useRef<HTMLDivElement>(null);
  const title = service?.name ?? "서비스";
  if (service && at > 0 && !apart)
    return <SameShape flow={flow} service={service} view={view} at={at} />;
  const pairs = pointlessOf(state.layers);
  const onKey = escapeOf(ui, table);
  return (
    <>
      <QHead title={title} at={at} count={services.length} />
      <p className="we-sub">층을 누르면 고를 수 있어요. 모르는 층은 알아서 골라져 있어요.</p>
      {apart && service && <Lead flow={flow} service={service} />}
      <Presets state={state} />
      <div className="we-layers">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: Esc closes the open layer from anywhere inside it */}
        <div className="we-tbl" ref={table} onKeyDown={onKey}>
          <Rows ui={ui} state={state} layers={layers} pairs={pairs} />
        </div>
        <RightColumn ui={ui} view={view} />
      </div>
    </>
  );
}
