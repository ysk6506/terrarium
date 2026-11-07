/**
 * 서비스부터 ③ (ADR-0107 item 7): one number, the servers. Racks, rooms, switches, PDUs, cooling units and kW are counted
 * from the shape. What a stop costs an hour is per service and per way of stopping (ADR-0108 item 2). When it is built,
 * one line says what came of it, and two buttons: look around the world, or make an experiment on it.
 */
import type { ServiceDraft, ShapePlan } from "@terrarium/core/sources/worldgen";
import type { Layers } from "@terrarium/core/world";
import { count, worldScale } from "../../logic";

function Servers({
  servers,
  real,
  onChange,
}: {
  readonly servers: number;
  readonly real: boolean;
  readonly onChange: (n: number, real: boolean) => void;
}) {
  return (
    <>
      <div className="we-big">
        <input
          aria-label="서버 수"
          inputMode="numeric"
          value={real ? "실측" : String(servers)}
          readOnly={real}
          onChange={(e) => {
            const n = Number(e.target.value.replace(/[^0-9]/g, ""));
            if (Number.isFinite(n)) onChange(n, false);
          }}
        />
        <small>대</small>
      </div>
      <fieldset className="we-quick" aria-label="빠른 선택">
        {worldScale.SERVER_QUICK.map((n) => (
          <button key={n} type="button" className="we-chip" onClick={() => onChange(n, false)}>
            {count(n)}
          </button>
        ))}
        <button type="button" className="we-chip" onClick={() => onChange(servers, true)}>
          화성 실측
        </button>
      </fieldset>
    </>
  );
}

export function SizeStep(props: {
  readonly services: readonly ServiceDraft[];
  readonly layers: Layers;
  readonly plan: ShapePlan;
  readonly servers: number;
  readonly real: boolean;
  readonly onServers: (n: number, real: boolean) => void;
  readonly problem: string | undefined;
}) {
  const { services, plan } = props;
  return (
    <>
      <div className="we-qhead">
        <h1>서버는 몇 대예요?</h1>
        <span className="we-step">3 / 3</span>
      </div>
      <p className="we-sub">
        {services.map((s) => `${s.name}가 쓰는 호스트는 ${plan.serviceHosts}대예요`).join(". ")}.
        나머지는 배경이고, 랙·스위치·PDU·냉방기는 고른 모양에 맞춰 세요. 배경이 클수록 에이전트가
        찾을 곳이 많아져요.
      </p>
      <div className="we-two">
        <section className="we-panel">
          <h3>서버</h3>
          <Servers servers={props.servers} real={props.real} onChange={props.onServers} />
          <div className="we-result">
            {worldScale.planFigures(plan, props.layers).map((f) => (
              <div key={f.unit}>
                <b>{f.value}</b>
                <small>{f.unit}</small>
              </div>
            ))}
          </div>
          {props.problem && (
            <p className="we-note" role="alert">
              {props.problem}
            </p>
          )}
          <p className="we-note">토폴로지는 접어서 보여 줘요 · 첫 그림까지 1초 안</p>
        </section>
      </div>
    </>
  );
}
