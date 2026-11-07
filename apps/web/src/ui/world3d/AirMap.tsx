/**
 * The airflow map on the room level of the world page (REQ-072, ADR-0074): two quiet view toggles over
 * the picture (3D or the plan seen from above; inlet, outlet or air), the card beside it, and the
 * rack names on the plan. It reads what the "시운전" run recorded, so the time can be dragged; with no run
 * yet it offers to make one. The sentence that says it is a calculation is always on screen.
 */
import type { BlueprintIndex } from "@terrarium/core/world";
import { useEffect, useMemo, useState } from "react";
import { type builder, hallAir, world3d } from "../../logic";
import { Segmented } from "../fields";
import { useMediaQuery } from "../hooks";
import { AirLabels } from "./AirLabels";
import { AirPanel } from "./AirPanel";
import { AirStage } from "./air-stage";
import type { WorldView } from "./view";

type AirView = world3d.AirView;

export interface AirInput {
  readonly roomId: string;
  /** The map mode is on: the page has folded its own panels and left the picture to the map. */
  readonly on: boolean;
  readonly onToggle: (on: boolean) => void;
  /** What "시운전" recorded, if it has been run. */
  readonly preview: builder.Preview | undefined;
  readonly previewing: boolean;
  readonly onRun: () => void;
  readonly onToggleUnit: (id: string) => void;
  /** What the page has selected: a rack that is picked there is picked here. */
  readonly selected: readonly string[];
  /** The moment of the run that is shown, when the page keeps it (so the topology view shows the same one). */
  readonly at?: number;
  readonly onAt?: (i: number) => void;
  /** Told which moment of the run is shown (the people in the room follow it), and undefined when the map closes. */
  readonly onFrame?: (index: number | undefined) => void;
}

/** How much of the picture the card covers when it is open, pixels. */
const CARD_PX = 304;
/** A stage narrower than this folds the card at first. */
const ROOMY_PX = 760;

type Dim = "flat" | "top";

function useRackPointer(
  view: WorldView,
  on: boolean,
  set: { hover: (id: string | undefined) => void; pick: (id: string | undefined) => void },
) {
  useEffect(() => {
    if (!on) return;
    let last = 0;
    const rackAt = (x: number, y: number) => {
      const tag = view.pickAt(x, y);
      return tag?.kind === "rack" ? tag.id : undefined;
    };
    const offs = [
      view.rig.onHover((x, y) => {
        const now = performance.now();
        if (now - last < 60) return;
        last = now;
        set.hover(rackAt(x, y));
      }),
      view.rig.onClick((x, y) => {
        if (view.crew.hit(x, y) === undefined) set.pick(rackAt(x, y));
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [view, on, set]);
}

function AirBar(p: {
  readonly dim: Dim;
  readonly onDim: (d: Dim) => void;
  readonly kind: AirView;
  readonly onKind: (k: AirView) => void;
}) {
  return (
    <div className="air-bar">
      <div className="row">
        <Segmented
          label={world3d.AIR_WORDS.how}
          value={p.dim}
          options={[
            { value: "flat", label: world3d.AIR_WORDS.flat },
            { value: "top", label: world3d.AIR_WORDS.top },
          ]}
          onChange={p.onDim}
        />
        <Segmented
          label={world3d.AIR_WORDS.what}
          value={p.kind}
          options={world3d.AIR_VIEWS.map((v) => ({ value: v.id, label: v.label }))}
          onChange={p.onKind}
        />
      </div>
      <p className="air-note">{world3d.AIR_NOTE}</p>
    </div>
  );
}

interface MapProps {
  readonly view: WorldView;
  readonly index: BlueprintIndex;
  readonly input: AirInput;
  readonly scene: world3d.RoomScene;
}

/**
 * The map, once it is on (the way in is `AirDoor`, which the first screen carries). This file and the drawing code
 * under it are one bundle that comes down the first time the map is opened.
 */
export function AirMap(props: MapProps) {
  return <AirMapOn {...props} />;
}

function AirMapOn({ view, index, input, scene }: MapProps) {
  useEffect(() => view.loadAir((engine, rig, host) => new AirStage(engine, rig, host)), [view]);
  const { roomId, preview } = input;
  const [dim, setDim] = useState<Dim>("flat");
  const [kind, setKind] = useState<AirView>("inlet");
  const [localAt, setLocalAt] = useState<number>();
  const at = input.onAt ? input.at : localAt;
  const setAt = input.onAt ?? setLocalAt;
  const [picked, setPicked] = useState<string>();
  const [hovered, setHovered] = useState<string>();
  const [open, setOpen] = useState(() => view.canvasSize.w >= ROOMY_PX);
  const frames = preview?.frames;
  const frame = frames ? Math.min(at ?? frames.length - 1, frames.length - 1) : 0;
  const readings = useMemo<world3d.AirReadings | undefined>(() => {
    const f = frames?.[frame];
    return f ? { racks: f.racks, units: f.units, ambientC: f.rooms.get(roomId) ?? 22 } : undefined;
  }, [frames, frame, roomId]);
  const air = useMemo(
    () => (readings ? hallAir.airflowOf(scene, readings, kind) : undefined),
    [scene, readings, kind],
  );
  const nameOf = useMemo(() => (id: string) => index.find(id)?.name ?? id, [index]);
  const calm = useMediaQuery("(prefers-reduced-motion: reduce)");
  const { onFrame } = input;
  useEffect(() => {
    onFrame?.(frames ? frame : undefined);
    return () => onFrame?.(undefined);
  }, [onFrame, frames, frame]);
  const pointer = useMemo(() => ({ hover: setHovered, pick: setPicked }), []);
  useRackPointer(view, true, pointer);
  const selectedRack = input.selected.length === 1 ? input.selected[0] : undefined;
  useEffect(() => {
    if (selectedRack && scene.sets.some((s) => s.ids.includes(selectedRack)))
      setPicked(selectedRack);
  }, [selectedRack, scene]);
  const inset = open && air ? CARD_PX : 0;
  useEffect(() => {
    if (!air) {
      view.setAirflow(undefined);
      return;
    }
    const mode = calm ? "still" : "live";
    view.setAirflow({ roomId, scene, air, view: kind, map: dim === "top", picked, inset, mode });
  }, [view, scene, air, kind, dim, picked, inset, roomId, calm]);
  useEffect(() => () => view.setAirflow(undefined), [view]);
  const spot = (id: string | undefined) => air?.racks.find((r) => r.id === id);
  return (
    <>
      <AirBar dim={dim} onDim={setDim} kind={kind} onKind={setKind} />
      <AirPanel
        air={air}
        kind={kind}
        nameOf={nameOf}
        shown={spot(hovered) ?? spot(picked)}
        onPickHottest={setPicked}
        preview={preview}
        previewing={input.previewing}
        frame={frame}
        onFrame={setAt}
        onRun={input.onRun}
        onToggleUnit={input.onToggleUnit}
        open={open}
        onOpen={setOpen}
      />
      {air && dim === "top" && <AirLabels view={view} air={air} nameOf={nameOf} picked={picked} />}
    </>
  );
}
