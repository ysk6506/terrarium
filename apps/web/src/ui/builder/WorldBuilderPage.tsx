/**
 * The tycoon-style builder (REQ-006, REQ-035, REQ-036): site → building → floor → room → racks and
 * equipment, with running totals, a heat preview and saving. Opened lazily: three.js loads here.
 */
import type { WorldRecord } from "@terrarium/core/experiments";
import { useMemo, useState } from "react";
import { builder, celsius, count, watts, won } from "../../logic";
import { useApp, useAsync, useLeaveGuard, usePageTitle } from "../context";
import { Failure, Loading } from "../kit";
import { useActivity } from "../world3d/useActivity";
import { WorldStage } from "../world3d/WorldStage";
import { BuilderBar } from "./BuilderBar";
import { Inspector } from "./Inspector";
import { Toolbox } from "./Toolbox";
import { type Builder, catalog, useBuilder } from "./useBuilder";
import { useBuilderKeys } from "./useBuilderKeys";
import { useGestures } from "./useGestures";

function Hud({ b }: { readonly b: Builder }) {
  const { index, level, preview } = b.state;
  const stats = builder.levelStats(index, catalog, level);
  const heatKw = stats.itTypicalW / 1000;
  const short = stats.coolingKw > 0 && heatKw > stats.coolingKw;
  return (
    <div className="stage-top">
      <section className="hud" aria-label="이 화면의 합계">
        <div className="hud-item">
          들인 돈<b>{won(stats.costM)}</b>
        </div>
        <div className="hud-item">
          랙<b>{count(stats.racks)}</b>
        </div>
        <div className="hud-item">
          서버<b>{count(stats.servers)}</b>
        </div>
        <div className="hud-item" style={short ? { color: "var(--bad)" } : undefined}>
          발열 / 냉방
          <b>
            {watts(stats.itTypicalW)} / {stats.coolingKw} kW
          </b>
        </div>
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

function BuilderScreen({ initial }: { readonly initial: WorldRecord }) {
  const b = useBuilder(initial);
  const { index, level, preview, selected, dirty } = b.state;
  // The map mode (REQ-072): the picture takes the page, the palette and the numbers fold away.
  const [mapRoom, setMapRoom] = useState<string>();
  const map = level.kind === "room" && mapRoom === level.id;
  usePageTitle(initial.name);
  useBuilderKeys(b);
  useLeaveGuard(dirty ? "저장하지 않고 나가면 고친 것이 사라져요. 그래도 나갈까요?" : undefined);
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
            {...(overlay ? { overlay } : {})}
            {...gestures.events}
            {...(level.kind === "room" ? { air: airInput(b, level.id, map, setMapRoom) } : {})}
            activity={activity}
            now={now}
            onWatch={(id) => b.go(builder.levelOf(index, id))}
          >
            {!map && <Hud b={b} />}
            {!map && (
              <output className={`stage-hint${gestures.bad ? " stage-hint-bad" : ""}`}>
                {gestures.hint}
              </output>
            )}
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
