/**
 * The structure card of one choice (ADR-0108 item 4): its picture, a paragraph, what may be lost and what may not, the
 * faults this layer has, the price, and a way to the choice on either side. It changes under the hand, the pointer and
 * the focus, so it is a live region; a dotted choice says at the end that it cannot be imitated yet.
 */

import type { LayerId } from "@terrarium/core/world";
import { capList, chipsOfLayer, LAYER_INFO } from "../../logic";
import { MossAsk, termQuestion } from "../../moss";
import { ChipArt } from "./chip-art";

export function ChipDetail({
  layer,
  chipId,
  onShow,
}: {
  readonly layer: LayerId;
  readonly chipId: string;
  readonly onShow: (id: string) => void;
}) {
  const chips = chipsOfLayer(layer);
  const at = Math.max(
    0,
    chips.findIndex((c) => c.card.id === chipId),
  );
  const chip = chips[at];
  if (!chip) return null;
  const { card, mech } = chip;
  const before = chips[at - 1];
  const after = chips[at + 1];
  return (
    <section className="we-detail" aria-live="polite" aria-label="고른 선택지의 구조">
      <div className="we-d-head">
        <span className="we-d-layer">{LAYER_INFO[layer].name}</span>
        <h3>
          <MossAsk question={termQuestion(card.label)}>{card.label}</MossAsk>
        </h3>
        {!mech.modeled && <span className="we-d-soon">아직 흉내 낼 수 없어요</span>}
      </div>
      <ChipArt diagram={card.diagram} />
      <p className="we-d-what">{card.what}</p>
      <dl className="we-kv">
        <dt>잃어도 되는 것</dt>
        <dd>{capList(card.canLose)}</dd>
        <dt>잃으면 안 되는 것</dt>
        <dd>{capList(card.mustNot)}</dd>
        <dt>생기는 고장</dt>
        <dd>{capList(card.faults)}</dd>
        <dt>비용</dt>
        <dd>{card.cost}</dd>
      </dl>
      {!mech.modeled && (
        <p className="we-note">
          고를 수는 있어요. 이 층의 시나리오는 만들어지지 않고, 세계는 가까운 모양으로 지어요.
        </p>
      )}
      <div className="we-nav">
        {before ? (
          <button type="button" onClick={() => onShow(before.card.id)}>
            ← {before.card.label}
          </button>
        ) : (
          <span />
        )}
        {after ? (
          <button type="button" onClick={() => onShow(after.card.id)}>
            {after.card.label} →
          </button>
        ) : (
          <span />
        )}
      </div>
    </section>
  );
}
