/**
 * The side card of the airflow map (REQ-072): what the colours mean, the cooling units and whether they
 * run, the numbers of the rack that was picked, where it is hottest, and the time of the run. The
 * sentence that says it is a calculation and not a fluid simulation is outside the card, so it stays
 * on screen when the card is folded.
 */
import type { builder } from "../../logic";
import { celsius, hallAir, world3d } from "../../logic";
import { Button } from "../kit";

type Airflow = world3d.Airflow;
type AirView = world3d.AirView;

const STOPS = 8;

/** The colour bar of a temperature view, as a CSS gradient, with the warning and critical lines marked on it. */
function Legend({ kind }: { readonly kind: "inlet" | "outlet" }) {
  const { lo, hi } = hallAir.AIR_SCALES[kind];
  const css = Array.from({ length: STOPS }, (_, i) => {
    const c = hallAir.airColor(kind, lo + ((hi - lo) * i) / (STOPS - 1));
    return `rgb(${c.map((v) => Math.round(v * 255)).join(",")}) ${Math.round((i / (STOPS - 1)) * 100)}%`;
  }).join(", ");
  const at = (c: number) => `${Math.round(((c - lo) / (hi - lo)) * 100)}%`;
  return (
    <div className="air-legend">
      <div className="air-legend-bar" style={{ background: `linear-gradient(90deg, ${css})` }}>
        {kind === "inlet" && (
          <>
            <i
              style={{ left: at(hallAir.WARN_C) }}
              title={`${world3d.AIR_WORDS.warn} ${hallAir.WARN_C}°C`}
            />
            <i
              style={{ left: at(hallAir.CRITICAL_C) }}
              title={`${world3d.AIR_WORDS.critical} ${hallAir.CRITICAL_C}°C`}
            />
          </>
        )}
      </div>
      <div className="air-legend-ends">
        <span>{lo}°C</span>
        {kind === "inlet" && (
          <span>
            {world3d.AIR_WORDS.warn} {hallAir.WARN_C} · {world3d.AIR_WORDS.critical}{" "}
            {hallAir.CRITICAL_C}
          </span>
        )}
        <span>{hi}°C</span>
      </div>
    </div>
  );
}

function FlowLegend() {
  return (
    <ul className="air-flow-legend">
      <li>
        <i className="air-dot air-dot-cold" />
        {world3d.AIR_WORDS.supply}
      </li>
      <li>
        <i className="air-dot air-dot-hot" />
        {world3d.AIR_WORDS.exhaust}
      </li>
      <li>{world3d.AIR_WORDS.strong}</li>
    </ul>
  );
}

function Units({
  air,
  stopped,
  busy,
  onToggle,
}: {
  readonly air: Airflow;
  readonly stopped: ReadonlySet<string>;
  readonly busy: boolean;
  readonly onToggle: (id: string) => void;
}) {
  if (air.units.length === 0) return <p className="tiny muted">{world3d.AIR_WORDS.noUnits}</p>;
  return (
    <ul className="air-units">
      {air.units.map((u) => (
        <li key={u.id}>
          <div className="air-unit-head">
            <span className={`air-state${u.running ? " air-state-on" : ""}`}>
              {u.running ? world3d.AIR_WORDS.unitOn : world3d.AIR_WORDS.unitOff}
            </span>
            <span className="air-unit-name">{u.name}</span>
            <Button kind="quiet" size="small" busy={busy} onClick={() => onToggle(u.id)}>
              {stopped.has(u.id) || !u.running
                ? world3d.AIR_WORDS.startUnit
                : world3d.AIR_WORDS.stopUnit}
            </Button>
          </div>
          {u.running && (
            <div className="air-unit-load">
              <span className="meter" aria-hidden="true">
                <i style={{ width: `${Math.round(hallAir.loadShareOf(u) * 100)}%` }} />
              </span>
              <span className="tiny">
                {Math.round(u.loadKw)} / {Math.round(u.capacityKw)} kW · 급기 {celsius(u.supplyC)}
              </span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function RackNumbers({ rack, name }: { readonly rack: world3d.RackSpot; readonly name: string }) {
  return (
    <div className="air-rack">
      <b>{name}</b>
      <dl>
        <div>
          <dt>{world3d.AIR_WORDS.inlet}</dt>
          <dd>{celsius(rack.inletC)}</dd>
        </div>
        <div>
          <dt>{world3d.AIR_WORDS.outlet}</dt>
          <dd>{celsius(rack.outletC)}</dd>
        </div>
        <div>
          <dt>{world3d.AIR_WORDS.gap}</dt>
          <dd>{celsius(rack.outletC - rack.inletC)}</dd>
        </div>
      </dl>
      <p className="tiny">{hallAir.marginText(rack.inletC)}</p>
    </div>
  );
}

export interface AirPanelProps {
  readonly air: Airflow | undefined;
  readonly kind: AirView;
  readonly nameOf: (id: string) => string;
  readonly shown: world3d.RackSpot | undefined;
  readonly onPickHottest: (id: string) => void;
  readonly preview: builder.Preview | undefined;
  readonly previewing: boolean;
  readonly frame: number;
  readonly onFrame: (index: number) => void;
  readonly onRun: () => void;
  readonly onToggleUnit: (id: string) => void;
  readonly open: boolean;
  readonly onOpen: (open: boolean) => void;
}

export function AirPanel(p: AirPanelProps) {
  const frames = p.preview?.frames ?? [];
  const hottest = p.air?.hottest;
  return (
    <details
      className="air-card"
      open={p.open}
      onToggle={(e) => p.onOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>{world3d.AIR_WORDS.title}</summary>
      {!p.air ? (
        <div className="air-block stack">
          <p className="small">{world3d.AIR_WORDS.none}</p>
          <div>
            <Button size="small" icon="play" busy={p.previewing} onClick={p.onRun}>
              {world3d.AIR_WORDS.run}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {hottest && (
            <button
              type="button"
              className="air-callout"
              onClick={() => p.onPickHottest(hottest.id)}
            >
              {hallAir.hottestText(p.nameOf(hottest.id), hottest.inletC)}
            </button>
          )}
          <div className="air-block">
            {p.kind === "flow" ? <FlowLegend /> : <Legend kind={p.kind} />}
            {p.air.liquid && <p className="tiny muted">{world3d.AIR_WORDS.liquid}</p>}
          </div>
          <div className="air-block">
            <h3>{world3d.AIR_WORDS.units}</h3>
            <Units
              air={p.air}
              stopped={p.preview?.stopped ?? new Set()}
              busy={p.previewing}
              onToggle={p.onToggleUnit}
            />
          </div>
          <div className="air-block">
            <h3>{world3d.AIR_WORDS.racks}</h3>
            {p.shown ? (
              <RackNumbers rack={p.shown} name={p.nameOf(p.shown.id)} />
            ) : (
              <p className="tiny muted">{world3d.AIR_WORDS.pickHint}</p>
            )}
          </div>
          {frames.length > 1 && (
            <div className="air-block">
              <label className="air-time">
                <span>
                  {world3d.AIR_WORDS.time} <b>{hallAir.frameText(frames[p.frame]?.t ?? 0)}</b>
                </span>
                <input
                  type="range"
                  min={0}
                  max={frames.length - 1}
                  step={1}
                  value={p.frame}
                  aria-label={world3d.AIR_WORDS.scrub}
                  onChange={(e) => p.onFrame(Number(e.target.value))}
                />
              </label>
            </div>
          )}
        </>
      )}
    </details>
  );
}
