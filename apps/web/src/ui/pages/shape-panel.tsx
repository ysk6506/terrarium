/**
 * "이 크기에서 일어나는 일" (ADR-0107 item 3, ADR-0134): what the choices come to, read off the core and in words only:
 * what stops, what only slows, how to bring it back (each list at most three, then "외 n가지"); how many scenarios fit.
 * It has no counts of hosts, VMs, switches or money: the size is said once, by the total on the left of screen ③.
 */
import { capList, type ShapeView } from "../../logic";

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
      {capList(items.join(" · "))}
    </div>
  );
}

export function ShapePanel({ view }: { readonly view: ShapeView }) {
  const handover = view.handover.map((h) => `${h.team} ${h.count}`).join(" · ");
  return (
    <section className="we-shape" aria-label="이 크기에서 일어나는 일">
      <h3>이 크기에서 일어나는 일</h3>
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
