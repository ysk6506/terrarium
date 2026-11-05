/**
 * The tycoon-style builder (REQ-006, REQ-035, REQ-036): site → building → floor → room → racks and
 * equipment, with running totals, a heat preview and saving. Opened lazily: three.js loads here.
 */
import type { WorldRecord } from "@terrarium/core/experiments";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { builder, celsius, hallTopology, type world3d } from "../../logic";
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
  at: number | undefined,
  setAt: (i: number) => void,
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
    at,
    onAt: setAt,
  };
}

const NO_HANDLES: readonly world3d.PlanHandle[] = [];

/** The topology view is a bundle of its own (REQ-078): it comes down when it is pointed at or opened. */
const loadTopology = () => import("../topology/TopologyView");
const TopologyView = lazy(loadTopology);
const warmTopology = () => void loadTopology();

/** Where the topology view starts: around the picked equipment, or folded all the way when nothing is picked. */
function topologyStart(b: Builder): readonly string[] {
  return hallTopology.pathFor(b.state.index, b.state.selected[0]);
}

/** The map mode is for looking: no handles on it. */
const shownHandles = (map: boolean, g: { readonly handles: readonly world3d.PlanHandle[] }) =>
  map ? NO_HANDLES : g.handles;

/** Keys, saving on its own, and the warning before leaving a change that is not saved yet. */
function useBuilderHabits(b: Builder): void {
  useBuilderKeys(b);
  useAutosave(b);
  useLeaveGuard(
    b.state.dirty ? "저장하지 않고 나가면 고친 것이 사라져요. 그래도 나갈까요?" : undefined,
  );
}

interface StageProps {
  readonly b: Builder;
  /** The moment of the "돌려 보기" run that is shown, shared by the airflow map and the topology view. */
  readonly at: number | undefined;
  readonly setAt: (i: number) => void;
}

/** The 3D eye: the picture of the level, with what the builder draws over it. */
function Stage3D(
  props: StageProps & {
    readonly map: boolean;
    readonly worldId: string;
    readonly setMapRoom: (id: string | undefined) => void;
  },
) {
  const { b, map, at, setAt } = props;
  const { index, level, preview, selected } = b.state;
  const gestures = useGestures(b);
  const { activity, now } = useActivity(props.worldId);
  const overlay = useMemo(
    () => (preview ? { heat: preview.heat, alarmed: preview.alarmed } : undefined),
    [preview],
  );
  const scene = useMemo(
    () => builder.sceneOf(index, catalog, level, overlay ?? {}),
    [index, level, overlay],
  );
  return (
    <WorldStage
      index={index}
      catalog={catalog}
      level={level}
      wide={needsWholeLand(b)}
      scene={scene}
      selected={selected}
      {...(gestures.ghost ? { ghost: gestures.ghost } : {})}
      handles={shownHandles(map, gestures)}
      {...(overlay ? { overlay } : {})}
      {...gestures.events}
      {...(level.kind === "room"
        ? { air: airInput(b, level.id, map, props.setMapRoom, at, setAt) }
        : {})}
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
    </WorldStage>
  );
}

/** The topology eye (REQ-078): the same world, the same picks, the same moment of the run. */
function TopologyStage({ b, at, setAt }: StageProps) {
  const { index, preview, selected, previewing } = b.state;
  return (
    <Suspense fallback={<Loading />}>
      <TopologyView
        index={index}
        catalog={catalog}
        preview={preview}
        previewing={previewing}
        selected={selected}
        onSelect={b.setSelected}
        at={at}
        onAt={setAt}
        onToggleUnit={b.toggleUnit}
        start={topologyStart(b)}
      />
    </Suspense>
  );
}

/** The moment of the run that is shown: the last one until it is dragged, and none once the run is gone. */
function useRunMoment(run: builder.Preview | undefined) {
  const [at, setAt] = useState<number>();
  useEffect(() => {
    if (run === undefined) setAt(undefined);
  }, [run]);
  return { at, setAt };
}

/** Which eye is open, and the map mode of the 3D one (REQ-072, REQ-078): the topology has nothing to put down. */
function useViews(level: builder.Level) {
  const [mapRoom, setMapRoom] = useState<string>();
  const [topology, setTopology] = useState(false);
  const map = level.kind === "room" && mapRoom === level.id;
  const openTopology = (on: boolean) => {
    setTopology(on);
    if (on) setMapRoom(undefined);
  };
  return { map, setMapRoom, topology, openTopology };
}

/** The class of the builder's grid: all three columns, the picture alone (map mode), or the picture and the card. */
function gridClass(map: boolean, topology: boolean): string {
  if (map) return "builder builder-map";
  return topology ? "builder builder-topo" : "builder";
}

function BuilderScreen({ initial }: { readonly initial: WorldRecord }) {
  const b = useBuilder(initial);
  const { level, preview } = b.state;
  const { map, setMapRoom, topology, openTopology } = useViews(level);
  const moment = useRunMoment(preview);
  usePageTitle(initial.name);
  useBuilderHabits(b);
  return (
    <div className="page-wide">
      <BuilderBar
        b={b}
        map={map}
        onLeaveMap={() => setMapRoom(undefined)}
        topology={topology}
        onTopology={openTopology}
        warm={warmTopology}
      />
      <div className={gridClass(map, topology)}>
        {!map && !topology && <Toolbox b={b} />}
        <div className="stage">
          {topology ? (
            <TopologyStage b={b} {...moment} />
          ) : (
            <Stage3D b={b} map={map} worldId={initial.id} setMapRoom={setMapRoom} {...moment} />
          )}
          {!map && <NextChip b={b} worldId={initial.id} />}
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
