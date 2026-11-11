/**
 * The tycoon-style builder (REQ-006, REQ-035, REQ-036, REQ-102): site → building → floor → room → racks and
 * equipment, with a "놓기" button, one card for what is picked, a bar at the foot, a trial run and saving. Opened lazily: three.js loads here.
 */
import type { WorldRecord } from "@terrarium/core/experiments";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { builder, hallTopology, type world3d } from "../../logic";
import { useApp, useAsync, useLeaveGuard, usePageTitle } from "../context";
import { Failure, Loading } from "../kit";
import { FramesBar } from "../replay/FramesBar";
import { useActivity } from "../world3d/useActivity";
import { WorldStage } from "../world3d/WorldStage";
import { BuilderBar } from "./BuilderBar";
import { NextChip } from "./NextChip";
import { PlaceSheet } from "./PlaceSheet";
import { StageCards } from "./StageCards";
import { StepBar } from "./StepBar";
import { useAutosave } from "./useAutosave";
import { type Builder, catalog, useBuilder } from "./useBuilder";
import { useBuilderKeys } from "./useBuilderKeys";
import { useGestures } from "./useGestures";

/** What a trial run left, in one line at the top of the picture: alarms, the hottest place, the power left (REQ-102). */
function TrialPill({ b }: { readonly b: Builder }) {
  const { index, level, preview, blueprint } = b.state;
  if (!preview) return null;
  const site = level.kind === "site" ? builder.siteUse(blueprint, catalog) : undefined;
  const line = builder.trialLine(preview, index, catalog, level, site);
  return (
    <output
      className="trial-pill"
      data-testid="trial-result"
      title="랙 흡기 온도: 파랑은 차갑고 빨강은 너무 더워요"
    >
      {line.head} · <b className={preview.alarms.length === 0 ? "good" : "bad"}>{line.alarms}</b>
      {line.rest && ` · ${line.rest}`}
      <span className="heat-bar" aria-hidden="true" />
    </output>
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
const NO_UNITS: ReadonlySet<string> = new Set();

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
  /** The moment of the "시운전" that is shown, shared by the airflow map and the topology view. */
  readonly at: number | undefined;
  readonly setAt: (i: number) => void;
}

/** The 3D eye: the picture of the level, with what the builder draws over it. */
function Stage3D(
  props: StageProps & {
    readonly map: boolean;
    readonly worldId: string;
    readonly anchor: builder.AnchorStore;
    readonly setMapRoom: (id: string | undefined) => void;
    /** The topology eye is in front: the 3D one keeps its place and its context, and draws nothing. */
    readonly paused: boolean;
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
      paused={props.paused}
      level={level}
      wide={needsWholeLand(b)}
      scene={scene}
      selected={selected}
      {...(gestures.ghost ? { ghost: gestures.ghost } : {})}
      handles={shownHandles(map, gestures)}
      {...(overlay ? { overlay } : {})}
      {...gestures.events}
      onAnchor={props.anchor.set}
      {...(level.kind === "room"
        ? { air: airInput(b, level.id, map, props.setMapRoom, at, setAt) }
        : {})}
      activity={activity}
      now={now}
      onWatch={(id) => b.go(builder.levelOf(index, id))}
    >
      {!map && <TrialPill b={b} />}
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
  const source = useMemo(
    () => hallTopology.sourceOf(index, catalog, preview, at),
    [index, preview, at],
  );
  const frames = preview?.frames ?? [];
  return (
    <Suspense fallback={<Loading />}>
      <TopologyView
        index={index}
        source={source}
        ran={preview !== undefined}
        selected={selected}
        onSelect={b.setSelected}
        start={topologyStart(b)}
        unit={{ stopped: preview?.stopped ?? NO_UNITS, busy: previewing, onToggle: b.toggleUnit }}
        bar={
          preview && frames.length > 1 ? (
            <FramesBar frames={frames} at={hallTopology.frameOf(preview, at)} onAt={setAt} />
          ) : undefined
        }
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

function BuilderScreen({ initial }: { readonly initial: WorldRecord }) {
  const b = useBuilder(initial);
  const { level, preview } = b.state;
  const { map, setMapRoom, topology, openTopology } = useViews(level);
  const moment = useRunMoment(preview);
  const anchor = useMemo(builder.anchorStore, []);
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
      <div className="builder">
        <div className="stage">
          {/* The 3D eye stays mounted behind the topology one: letting go of its graphics context costs seconds on a machine
              that draws with its processor, and a click made at that moment waits for it (ADR-0141). */}
          <div className="stage-hold" hidden={topology}>
            <Stage3D
              b={b}
              map={map}
              worldId={initial.id}
              anchor={anchor}
              setMapRoom={setMapRoom}
              paused={topology}
              {...moment}
            />
          </div>
          {topology && <TopologyStage b={b} {...moment} />}
          {!map && !topology && <PlaceSheet b={b} />}
          {!map && <NextChip b={b} worldId={initial.id} />}
          {!map && <StageCards b={b} anchor={anchor} />}
          {!map && <StepBar b={b} />}
        </div>
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
