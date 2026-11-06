/**
 * 서비스부터 ② for a service after the first (ADR-0108 item 5): by default it is shaped like the first, so the screen
 * says so and shows what that comes to; "따로 고르기" opens its own ladders for the layers a service chooses.
 */
import { withJosa } from "@terrarium/core/kernel";
import { SERVICE_LAYERS, type ServiceDraft } from "@terrarium/core/sources/worldgen";
import { cardOf, LAYER_INFO, type ShapeView } from "../../logic";
import type { Flow } from "./shape-flow";
import { ShapePanel } from "./shape-panel";

export function SameShape({
  flow,
  service,
  view,
  at,
}: {
  readonly flow: Flow;
  readonly service: ServiceDraft;
  readonly view: ShapeView;
  /** Its place among the services, from 1 (the first is not asked here). */
  readonly at: number;
}) {
  const { services, layers } = flow.spec;
  const first = services[0]?.name ?? "서비스 1";
  return (
    <>
      <div className="we-qhead">
        <h1>{withJosa(service.name, "는")} 어떻게 돌리나요?</h1>
        <span className="we-step">
          서비스 {at + 1} / {services.length}
        </span>
      </div>
      <p className="we-sub">
        기본은 {withJosa(first, "과")} 같은 모양이에요. 이 서비스만 다르게 돌리고 싶으면 따로
        골라요.
      </p>
      <div className="we-layers">
        <div className="we-lcol">
          <section className="we-same" data-testid="same-shape" aria-label="같은 모양">
            <h3>같은 모양</h3>
            <ul className="list-plain">
              {SERVICE_LAYERS.map((l) => (
                <li key={l}>
                  <b>{LAYER_INFO[l].name}</b> {cardOf(layers[l])?.label ?? layers[l]}
                </li>
              ))}
            </ul>
            <p className="tiny muted">
              네트워크·전원·냉방·사업장은 건물 하나라 모든 서비스가 같아요.
            </p>
            <button
              type="button"
              className="we-linkbtn"
              onClick={() => flow.setApart(service, true)}
            >
              따로 고르기
            </button>
          </section>
        </div>
        <div className="we-rcol">
          <ShapePanel view={view} />
        </div>
      </div>
    </>
  );
}
