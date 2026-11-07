/**
 * "이 모양이면" (ADR-0107 item 3): what the nine choices come to, read off the core: hosts, VMs, switches and price;
 * what stops, what only slows, how to bring it back; how many scenarios fit. It sits under the card of the choice.
 */
import { costText, type ShapeView } from "../../logic";

function Line({
  tone,
  title,
  items,
}: {
  readonly tone: "bad" | "warn" | "good";
  readonly title: string;
  readonly items: readonly string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className={`we-sh ${tone}`}>
      <b>{title}</b>
      {items.join(" · ")}
    </div>
  );
}

export function ShapePanel({ view }: { readonly view: ShapeView }) {
  const handover = view.handover.map((h) => `${h.team} ${h.count}`).join(" · ");
  return (
    <section className="we-shape" aria-label="이 모양이면">
      <h3>이 모양이면</h3>
      <div className="we-shape-n">
        <div>
          <b>{view.hosts}</b>
          <small>호스트</small>
        </div>
        <div>
          <b>{view.vms}</b>
          <small>VM</small>
        </div>
        <div>
          <b>{view.switches}</b>
          <small>스위치</small>
        </div>
        {view.gpus > 0 && (
          <>
            <div>
              <b>{view.gpus}</b>
              <small>GPU</small>
            </div>
            <div>
              <b>{view.kw}</b>
              <small>kW</small>
            </div>
          </>
        )}
        <div>
          <b>{costText(view.costM).replace(/ 원$/, "")}</b>
          <small>원 · 대략</small>
        </div>
      </div>
      <Line tone="bad" title="멈추는 고장" items={view.stops} />
      <Line tone="warn" title="느려지는 고장" items={view.slows} />
      <Line tone="good" title="살리는 길" items={view.ways} />
      {view.dr && (
        <div className="we-sh good">
          <b>복구 목표</b>
          {view.dr.label} · {view.dr.promise}
        </div>
      )}
      <p className="we-shape-foot">
        시나리오 <b>{view.scenarios}개</b>가 이 모양에 맞아요.
        {view.handover.length > 0 && (
          <>
            {" "}
            {view.handover.reduce((n, h) => n + h.count, 0)}개는 넘겨야 풀려요({handover}).
          </>
        )}
        {view.dotted.length > 0 && <> 아직 흉내 못 내는 층은 시나리오가 안 생겨요.</>}
      </p>
    </section>
  );
}
