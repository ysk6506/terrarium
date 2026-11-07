/**
 * The 3D stage (REQ-006, REQ-036): the whole world as a miniature, from the site down to a rack. Used
 * two ways. Looking around, a click on a building, room or rack goes into it and a bar says where you
 * are. Building, the builder gives it a level: the camera stays on that level, the pointer reports plan
 * points and the things under it, and the selection and the next placement are drawn over the picture.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { BlueprintIndex } from "@terrarium/core/world";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ActivityState, type builder, noActivity, world3d } from "../../logic";
import { ActivityPanel } from "./ActivityPanel";
import { ActivityPins } from "./ActivityPins";
import { AirDoor } from "./AirDoor";
import type { AirInput } from "./AirMap";
import { CrewBubble } from "./CrewBubble";
import type { LifeMode } from "./life-layer";
import { PlanLabels } from "./PlanLabels";
import type { RackState } from "./rack-layer";
import { StageHint } from "./StageHint";
import type { Ghost, StageEvents } from "./stage-types";
import { useCrew } from "./useCrew";
import { useLatest, useStageEvents, useWorldContent, useWorldView } from "./useWorldView";
import type { Aisle, WorldView } from "./view";
import { WorldBar } from "./WorldBar";

type Focus = world3d.Focus;

export interface WorldStageProps extends StageEvents {
  readonly index: BlueprintIndex;
  readonly catalog: Catalog;
  /** The level being edited; leave it out to look around freely. */
  readonly level?: builder.Level;
  /** At the site level, show the whole land and not only the buildings (the land for sale lies beyond them). */
  readonly wide?: boolean;
  /** What the builder draws for the level: names to label, and the things to outline. */
  readonly scene?: builder.Scene;
  readonly selected?: readonly string[];
  readonly ghost?: Ghost;
  /** Handles on the selected room or building, in the level's plan. */
  readonly handles?: readonly world3d.PlanHandle[];
  /** Live facts to colour by (temperatures, alarms), after "시운전". */
  readonly overlay?: world3d.Overlay;
  readonly readOnly?: boolean;
  readonly label?: string;
  /** Turn slowly about the view, degrees a second (a showcase). */
  readonly spin?: number;
  /** Show the bar for moving between levels and layers. */
  readonly explore?: boolean;
  readonly life?: LifeMode;
  /** The runs at work in this world (REQ-050): markers in the picture and a list over it. */
  readonly activity?: ActivityState;
  /** Clock of the page, ms, for telling quiet runs apart. */
  readonly now?: number;
  /** A run's marker or list entry was picked: the equipment it is at. Left out, the camera goes there. */
  readonly onWatch?: (entityId: string) => void;
  /** On the room level: the temperature and airflow map (REQ-072), from what "시운전" recorded. */
  readonly air?: AirInput;
  readonly children?: ReactNode;
}

interface Tip {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

const KEY_TURN = Math.PI / 4;

/** Read after the canvas's name, for anyone who cannot drag: the keys that move the view. An attribute, not text on the page: words drawn on the first screen cost a font file. */
const STAGE_HELP =
  "끌어서 돌리고 휠로 확대해요. 키보드로는 Q와 E로 45도씩 돌리고, 더하기와 빼기로 확대하고 줄이고, A로 가운데 가까이의 고양이나 새에게 인사하고, Esc로 한 단계 나와요. 랙에서 서버를 누르면 랙이 돌아 뒷면이 보이고, 컨테인먼트를 누르면 복도 안으로 들어가요.";

/** Q and E turn the view, + and - move in and out, Escape steps back out of a level. */
function keysFor(view: WorldView, back: () => void) {
  return (e: React.KeyboardEvent) => {
    const pose = view.rig.pose();
    const key = e.key.toLowerCase();
    if (key === "q") view.rig.flyTo({ ...pose, yaw: pose.yaw - KEY_TURN }, 250);
    else if (key === "e") view.rig.flyTo({ ...pose, yaw: pose.yaw + KEY_TURN }, 250);
    else if (key === "+" || key === "=")
      view.rig.flyTo({ ...pose, distance: pose.distance / 1.25 }, 150);
    else if (key === "-") view.rig.flyTo({ ...pose, distance: pose.distance * 1.25 }, 150);
    else if (key === "a") view.animals.greet();
    else if (key === "escape") back();
  };
}

/** What the viewer is told while looking around: where the camera went, what the pointer is over. */
function useLookingAround(view: WorldView | undefined, index: BlueprintIndex, on: boolean) {
  const [focus, setFocus] = useState<Focus>({ kind: "site" });
  const [tip, setTip] = useState<Tip>();
  const [rack, setRack] = useState<RackState>();
  const [aisle, setAisle] = useState<Aisle>();
  useEffect(() => {
    if (!view || !on) return;
    view.setEvents({
      onFocus: (f) => {
        setFocus(f);
        setRack(undefined);
      },
      onRack: setRack,
      onAisle: setAisle,
      onHover: (tag, x, y) => {
        const name = tag ? index.find(tag.id)?.name : undefined;
        setTip((prev) => {
          if (!name) return prev ? undefined : prev;
          return prev?.text === name && Math.abs(prev.x - x) < 6 && Math.abs(prev.y - y) < 6
            ? prev
            : { text: name, x, y };
        });
      },
    });
  }, [view, index, on]);
  return { focus, tip, rack, aisle };
}

/** Escape goes one level up while looking around (a builder keeps its level). */
function useStepBack(view: WorldView | undefined, index: BlueprintIndex, building: boolean) {
  return useCallback(() => {
    if (!view || building) return;
    // First the smallest thing: a server put back, the aisle left, then a level up.
    if (view.rack.clear() || view.leaveAisle()) return;
    const up = world3d.crumbsOf(index, view.focus).at(-2);
    if (up) view.focusOn(up.focus);
  }, [view, index, building]);
}

/** The visitors (cats, cars, deer) and the slow turn of a showcase. */
function useAmbience(view: WorldView | undefined, props: WorldStageProps, lifeOn: boolean) {
  const around = useLookingAround(view, props.index, props.level === undefined);
  const mode: LifeMode = props.life ?? (lifeOn ? "auto" : "off");
  useEffect(() => view?.setLife(mode), [view, mode]);
  useEffect(() => view?.setSpin(props.spin ?? 0), [view, props.spin]);
  return around;
}

/** Put a marker on each run at work; the places are looked up once for each change of world or of activity. */
function useMarkers(view: WorldView | undefined, index: BlueprintIndex, activity: ActivityState) {
  const [markers, setMarkers] = useState<readonly world3d.Marker[]>([]);
  useEffect(() => {
    if (!view) return;
    const known = new Map<string, world3d.Spot | undefined>();
    const next = world3d.markersOf(activity, (id) => {
      if (!known.has(id)) known.set(id, index.has(id) ? view.spotOf(id) : undefined);
      return known.get(id);
    });
    view.setActivity(next);
    setMarkers(next);
  }, [view, index, activity]);
  return markers;
}

/** What picking a run does: the host's own way of going to the equipment, or the camera flies there. */
function useWatch(
  view: WorldView | undefined,
  index: BlueprintIndex,
  activity: ActivityState,
  onWatch: ((entityId: string) => void) | undefined,
) {
  return useCallback(
    (runId: string) => {
      const at = activity.workers.find((w) => w.runId === runId)?.at;
      if (!at) return;
      if (onWatch) onWatch(at);
      else view?.focusOn(world3d.focusOf(index, at));
    },
    [activity, index, onWatch, view],
  );
}

interface CanvasProps {
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>;
  readonly failed: boolean;
  readonly label: string | undefined;
  readonly onKeyDown: ((e: React.KeyboardEvent) => void) | undefined;
  readonly onLeave: () => void;
}

/** The picture itself, or a note saying why there is none. */
function StageCanvas({ canvasRef, failed, label, onKeyDown, onLeave }: CanvasProps) {
  if (failed)
    return (
      <div className="note note-warn" style={{ margin: 20 }}>
        이 브라우저에서는 3D를 그릴 수 없어요(WebGL이 꺼져 있어요). 목록과 패널로는 계속 볼 수
        있어요.
      </div>
    );
  return (
    // biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: a 3D viewer with its own keys is an application; a focusable canvas needs a role to carry its name
    <canvas
      ref={canvasRef}
      role="application"
      tabIndex={0}
      aria-label={`${label ?? "세계"}의 3D 보기`}
      aria-description={STAGE_HELP}
      style={{ touchAction: "none" }}
      onKeyDown={onKeyDown}
      onPointerLeave={onLeave}
    />
  );
}

interface ActivityProps {
  readonly view: WorldView | undefined;
  readonly index: BlueprintIndex;
  readonly markers: readonly world3d.Marker[];
  readonly activity: ActivityState;
  readonly now: number;
  readonly onPick: (runId: string) => void;
}

/** The runs at work (REQ-050): names over their equipment, and the list of who is doing what. */
function StageActivity({ view, index, markers, activity, now, onPick }: ActivityProps) {
  return (
    <>
      {view && markers.length > 0 && (
        <ActivityPins view={view} markers={markers} activity={activity} onPick={onPick} />
      )}
      <ActivityPanel activity={activity} index={index} now={now} onPick={onPick} />
    </>
  );
}

interface OverlayProps {
  readonly view: WorldView | undefined;
  readonly props: WorldStageProps;
  readonly around: ReturnType<typeof useLookingAround>;
  readonly layer: world3d.Layer;
  readonly onLayer: (layer: world3d.Layer) => void;
  readonly life: boolean;
  readonly onLife: (on: boolean) => void;
}

/** What sits over the picture: plan labels, the bar, the airflow map (REQ-072) and the name under the pointer. */
function StageOverlays({ view, props, around, layer, onLayer, life, onLife }: OverlayProps) {
  return (
    <>
      {view && props.scene && <PlanLabels view={view} labels={props.scene.labels} />}
      {props.explore && view && (
        <WorldBar
          view={view}
          index={props.index}
          focus={around.focus}
          aisle={around.aisle}
          layer={layer}
          onLayer={onLayer}
          life={life}
          onLife={onLife}
        />
      )}
      {props.explore && view && (
        <StageHint view={view} focus={around.focus} rack={around.rack} aisle={around.aisle} />
      )}
      {view && props.air && (
        <AirDoor view={view} index={props.index} catalog={props.catalog} input={props.air} />
      )}
      {around.tip && (
        <span className="stage-tip" style={{ left: around.tip.x + 14, top: around.tip.y + 14 }}>
          {around.tip.text}
        </span>
      )}
    </>
  );
}

/** The room the camera is in: the builder's level, or where the viewer has gone. */
function roomInView(level: builder.Level | undefined, focus: Focus): string | undefined {
  if (level) return level.kind === "room" ? level.id : undefined;
  return focus.kind === "room" ? focus.id : undefined;
}

export function WorldStage(props: WorldStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const { view, failed } = useWorldView(canvasRef, hostRef);
  const [chosen, setChosen] = useState<world3d.Layer>("plain");
  const [lifeOn, setLifeOn] = useState(true);
  const layer = props.explore ? chosen : props.overlay?.heat ? "heat" : "plain";
  useWorldContent(view, { ...props, layer });
  useStageEvents(view, useLatest(props));
  const around = useAmbience(view, props, lifeOn);
  const back = useStepBack(view, props.index, props.level !== undefined);
  const activity = props.activity ?? noActivity;
  const markers = useMarkers(view, props.index, activity);
  const [airFrame, setAirFrame] = useState<number>();
  const room = roomInView(props.level, around.focus);
  const air = useMemo(
    () => (props.air ? { ...props.air, onFrame: setAirFrame } : undefined),
    [props.air],
  );
  useCrew(view, {
    index: props.index,
    catalog: props.catalog,
    roomId: room,
    preview: props.air?.preview,
    frame: airFrame,
    activity,
    now: props.now ?? 0,
    aisle: around.aisle?.id,
  });
  const watch = useWatch(view, props.index, activity, props.onWatch);
  return (
    <div ref={hostRef} style={{ position: "absolute", inset: 0 }}>
      <StageCanvas
        canvasRef={canvasRef}
        failed={failed}
        label={props.label}
        onKeyDown={view ? keysFor(view, back) : undefined}
        onLeave={() => props.onHover?.(undefined, undefined)}
      />
      <StageActivity
        view={view}
        index={props.index}
        markers={markers}
        activity={activity}
        now={props.now ?? 0}
        onPick={watch}
      />
      <StageOverlays
        view={view}
        props={{ ...props, air }}
        around={around}
        layer={chosen}
        onLayer={setChosen}
        life={lifeOn}
        onLife={setLifeOn}
      />
      {view && <CrewBubble view={view} />}
      {props.children}
    </div>
  );
}
