/**
 * 서비스부터 ② (ADR-0107 item 3, ADR-0108 item 4, ADR-0123): eight quiet rows, one layer open at a time. Closed, a row says the
 * one choice that stands and why; open, it unfolds the ladder, and the right column turns from "이 모양이면" into the
 * structure card of the choice under the hand. The same screen serves a service that chose its own shape. One
 * screen, one question (REQ-109): the sums of the shape are not here, they are on the next screen and on the last.
 */
import { withJosa } from "@terrarium/core/kernel";
import { cardOfKey, SERVICE_LAYERS, type ServiceDraft } from "@terrarium/core/sources/worldgen";
import {
  catalogCard,
  LAYER_IDS,
  type LayerId,
  pointlessOf,
  unmetNeeds,
  withChoice,
} from "@terrarium/core/world";
import { type KeyboardEvent, type RefObject, useRef, useState } from "react";
import { LAYER_INFO, ladderHead, PRESET_LABELS, type PresetId } from "../../logic";
import { useMossActions } from "../../moss";
import { ChipDetail } from "./chip-card";
import { LayerDetail, LayerRow, type Notice, rowFacts } from "./ladder-rows";
import type { Flow, LadderState } from "./shape-flow";
import { SameShape } from "./shape-same";

const PRESETS: readonly PresetId[] = ["auto", "cheap", "middle", "steady"];

function Presets({ state }: { readonly state: LadderState }) {
  // 이끼의 "사다리를 …로 고르기": 아래 알약과 같은 `applyPreset`이에요 (REQ-103)
  useMossActions("newWorld", {
    "ladder-preset-auto": () => state.applyPreset("auto"),
    "ladder-preset-cheap": () => state.applyPreset("cheap"),
    "ladder-preset-middle": () => state.applyPreset("middle"),
    "ladder-preset-steady": () => state.applyPreset("steady"),
  });
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
          data-moss-action={`ladder-preset-${p}`}
          onClick={() => state.applyPreset(p)}
        >
          {PRESET_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

const COSTS: ReadonlyArray<{ readonly v: -1 | 0 | 1; readonly label: string }> = [
  { v: -1, label: "한 칸 싸게" },
  { v: 0, label: "그대로" },
  { v: 1, label: "한 칸 튼튼하게" },
];

/** On "알아서": every layer it picks may move one choice cheaper or steadier (REQ-109). */
function CostShift({ flow }: { readonly flow: Flow }) {
  return (
    <div className="we-cost" role="radiogroup" aria-label="알아서 고른 층을 한 칸 옮기기">
      {COSTS.map((c) => (
        // biome-ignore lint/a11y/useSemanticElements: a radio group of pills; the press is the choice
        <button
          key={c.v}
          type="button"
          role="radio"
          aria-checked={flow.cost === c.v}
          className="we-pre small"
          data-moss-skip="알아서 고른 층을 한 칸 옮기는 보기 조작"
          onClick={() => flow.setCost(c.v)}
        >
          {c.label}
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
      <button
        type="button"
        data-moss-skip="서비스 하나의 모양 폼 안의 입력"
        onClick={() => flow.setApart(service, false)}
      >
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

/** "웹 API는 컴퓨트·네트워크·애플리케이션이 특히 중요해요." for a service made from a catalog card. */
function mattersLine(service: ServiceDraft | undefined): string {
  const card = service ? catalogCard(cardOfKey(service.key)) : undefined;
  if (!service || !card) return "";
  return ` ${withJosa(service.name, "은")} ${withJosa(card.matters.map((l) => LAYER_INFO[l].name).join("·"), "이")} 특히 중요해요.`;
}

function QHead(props: { readonly title: string; readonly at: number; readonly count: number }) {
  // this screen is asked once for each service: the title is the service's own name, the badge counts them
  const head = ladderHead(props.title, props.at, props.count);
  return (
    <div className="we-qhead">
      <h1>{head.title}</h1>
      <span className="we-step">{head.badge}</span>
    </div>
  );
}

/** The structure card of the choice under the hand; nothing when no layer is open. */
function RightColumn({ ui }: { readonly ui: ReturnType<typeof useOpen> }) {
  if (!ui.open) return null;
  return (
    <div className="we-rcol">
      <ChipDetail layer={ui.open} chipId={ui.shown} onShow={ui.setShown} />
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

/** 이끼의 "받치는 층도 바꾸기": 알림의 버튼과 같은 함수예요 (REQ-103) */
function useFixAction(ui: ReturnType<typeof useOpen>): void {
  useMossActions("newWorld", {
    "ladder-fix-needs": () => {
      if (!ui.notice) throw new Error("지금 물어보는 칩이 없어요");
      ui.fix();
    },
  });
}

function Hint({
  service,
  many,
}: {
  readonly service: ServiceDraft | undefined;
  readonly many: boolean;
}) {
  return (
    <p className="we-sub">
      층을 누르면 고를 수 있어요. 모르는 층은 알아서 골라져 있어요.{mattersLine(service)}
      {many && " 네트워크·전원·냉방·사이트는 건물 하나라 모든 서비스가 같이 써요."}
    </p>
  );
}

export function LaddersStep({ flow }: { readonly flow: Flow }) {
  const { services } = flow.spec;
  const at = Math.min(flow.ladder, services.length - 1);
  const service = services[at];
  const apart = service && at > 0 ? flow.apartOf(service) : undefined;
  if (service && at > 0 && !apart) return <SameShape flow={flow} service={service} at={at} />;
  return <Ladders flow={flow} at={at} service={service} apart={apart} />;
}

/** The nine rows of one service (the world's, or one the person chose apart). */
function Ladders({
  flow,
  at,
  service,
  apart,
}: {
  readonly flow: Flow;
  readonly at: number;
  readonly service: ServiceDraft | undefined;
  readonly apart: ReturnType<Flow["apartOf"]>;
}) {
  const count = flow.spec.services.length;
  const state = apart ?? worldState(flow);
  const layers = apart ? SERVICE_LAYERS : LAYER_IDS;
  const ui = useOpen(state, layers);
  const table = useRef<HTMLDivElement>(null);
  useFixAction(ui);
  const pairs = pointlessOf(state.layers);
  const onKey = escapeOf(ui, table);
  return (
    <>
      <QHead title={service?.name ?? "서비스"} at={at} count={count} />
      <Hint service={service} many={count > 1} />
      {apart && service && <Lead flow={flow} service={service} />}
      <Presets state={state} />
      {!apart && state.preset === "auto" && <CostShift flow={flow} />}
      <div className={`we-layers${ui.open ? "" : " solo"}`}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: Esc closes the open layer from anywhere inside it */}
        <div className="we-tbl" ref={table} onKeyDown={onKey}>
          <Rows ui={ui} state={state} layers={layers} pairs={pairs} />
        </div>
        <RightColumn ui={ui} />
      </div>
    </>
  );
}
