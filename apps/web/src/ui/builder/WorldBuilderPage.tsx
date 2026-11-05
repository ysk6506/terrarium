/**
 * The tycoon-style builder (REQ-006, REQ-035, REQ-036): site → building → floor → room → racks and
 * equipment, with running totals, a heat preview and saving. Opened lazily: three.js loads here.
 */
import type { WorldRecord } from "@terrarium/core/experiments";
import { useMemo, useState } from "react";
import { builder, celsius, type world3d } from "../../logic";
import { useApp, useAsync, useLeaveGuard, usePageTitle } from "../context";
import { Failure, Loading } from "../kit";
import { useActivity } from "../world3d/useActivity";
import { WorldStage } from "../world3d/WorldStage";
import { BuilderBar } from "./BuilderBar";
import { Inspector } from "./Inspector";
import { NextChip } from "./NextChip";
import { Toolbox } from "./Toolbox";
import { useAutosave } from "./useAutosave";
import { type Builder, catalog, useBuilder } from "./useBuilder";
import { useBuilderKeys } from "./useBuilderKeys";
import { useGestures } from "./useGestures";

/** The numbers an experiment runs on, over the picture: racks, servers, heat against cooling, power left (no money). */
function Hud({ b }: { readonly b: Builder }) {
  const { index, level, preview, blueprint } = b.state;
  const stats = builder.levelStats(index, catalog, level);
  const site = level.kind === "site" ? builder.siteUse(blueprint, catalog) : undefined;
  return (
    <div className="stage-top">
      <section className="hud" aria-label="실험에 들어가는 숫자">
        {builder.hudItems(stats, site).map((item) => (
          <div
            key={item.label}
            className="hud-item"
            style={item.bad ? { color: "var(--bad)" } : undefined}
          >
            {item.label}
            <b>{item.value}</b>
          </div>
        ))}
      </section>
      {preview && (
        <div className="heat-scale" title="랙 흡기 온도: 파랑은 차갑고 빨강은 너무 더워요">
          <span>18°C</span>
          <span className="heat-bar" />
          <span>32°C</span>
          {preview.hottest && (
            <span>
              가장 더운 랙 {preview.hottest.name} {celsius(preview.hottest.inletC)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Putting something down on the site (land, a building, plant) needs the whole land in view. */
function needsWholeLand(b: Builder): boolean {
  const { index, level, selected } = b.state;
  const tool = b.state.tool.kind;
  return (
    level.kind === "site" &&
    (tool === "buy" ||
      tool === "building" ||
      tool === "plant" ||
      selected.some((id) => index.find(id)?.kind === "parcel"))
  );
}

/** What the stage needs for the airflow map of the room being built (REQ-072). */
function airInput(
  b: Builder,
  roomId: string,
  on: boolean,
  setMapRoom: (id: string | undefined) => void,
) {
  return {
    roomId,
    on,
    onToggle: (next: boolean) => setMapRoom(next ? roomId : undefined),
    preview: b.state.preview,
    previewing: b.state.previewing,
    onRun: b.runPreview,
    onToggleUnit: b.toggleUnit,
    selected: b.state.selected,
  };
}

const NO_HANDLES: readonly world3d.PlanHandle[] = [];

/** The map mode is for looking: no handles on it. */
const shownHandles = (map: boolean, g: { readonly handles: readonly world3d.PlanHandle[] }) =>
  map ? NO_HANDLES : g.handles;

/** The map mode (REQ-072): the picture takes the page, the palette and the numbers fold away. */
function useMapMode(level: builder.Level) {
  const [mapRoom, setMapRoom] = useState<string>();
  return { map: level.kind === "room" && mapRoom === level.id, setMapRoom };
}

/** Keys, saving on its own, and the warning before leaving a change that is not saved yet. */
function useBuilderHabits(b: Builder): void {
  useBuilderKeys(b);
  useAutosave(b);
  useLeaveGuard(
    b.state.dirty ? "저장하지 않고 나가면 고친 것이 사라져요. 그래도 나갈까요?" : undefined,
  );
}

function BuilderScreen({ initial }: { readonly initial: WorldRecord }) {
  const b = useBuilder(initial);
  const { index, level, preview, selected } = b.state;
  const { map, setMapRoom } = useMapMode(level);
  usePageTitle(initial.name);
  useBuilderHabits(b);
  const gestures = useGestures(b);
  const { activity, now } = useActivity(initial.id);
  const overlay = useMemo(
    () => (preview ? { heat: preview.heat, alarmed: preview.alarmed } : undefined),
    [preview],
  );
  const wide = needsWholeLand(b);
  const scene = useMemo(
    () => builder.sceneOf(index, catalog, level, overlay ?? {}),
    [index, level, overlay],
  );
  return (
    <div className="page-wide">
      <BuilderBar b={b} map={map} onLeaveMap={() => setMapRoom(undefined)} />
      <div className={`builder${map ? " builder-map" : ""}`}>
        {!map && <Toolbox b={b} />}
        <div className="stage">
          <WorldStage
            index={index}
            catalog={catalog}
            level={level}
            wide={wide}
            scene={scene}
            selected={selected}
            {...(gestures.ghost ? { ghost: gestures.ghost } : {})}
            handles={shownHandles(map, gestures)}
            {...(overlay ? { overlay } : {})}
            {...gestures.events}
            {...(level.kind === "room" ? { air: airInput(b, level.id, map, setMapRoom) } : {})}
            activity={activity}
            now={now}
            onWatch={(id) => b.go(builder.levelOf(index, id))}
          >
            {!map && <Hud b={b} />}
            {!map && gestures.hint && (
              <output className={`stage-hint${gestures.bad ? " stage-hint-bad" : ""}`}>
                {gestures.hint}
              </output>
            )}
            {!map && <NextChip b={b} worldId={initial.id} />}
          </WorldStage>
        </div>
        {!map && <Inspector b={b} />}
      </div>
    </div>
  );
}

export default function WorldBuilderPage({ id }: { readonly id: string }) {
  const { api } = useApp();
  const world = useAsync((signal) => api.call("getWorld", { params: { id }, signal }), [id]);
  if (world.error)
    return (
      <div className="page">
        <Failure error={world.error} retry={world.reload} />
      </div>
    );
  if (!world.data || world.data.id !== id)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  return <BuilderScreen key={world.data.id} initial={world.data} />;
}
