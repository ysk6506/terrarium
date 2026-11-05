/**
 * Puts the people into the room being looked at (REQ-074, ADR-0078): who is there, and what is the matter
 * with the machines. The alarms are those of the moment on show: the airflow map's time scrubber when it is
 * on, otherwise the end of the last "돌려 보기". The runs at work come from the activity stream.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { BlueprintIndex } from "@terrarium/core/world";
import { useEffect, useMemo, useState } from "react";
import { type ActivityState, type builder, world3d } from "../../logic";
import type { WorldView } from "./view";

export interface CrewInput {
  readonly index: BlueprintIndex;
  readonly catalog: Catalog;
  /** The room in view, if the camera is in one. */
  readonly roomId: string | undefined;
  /** What "돌려 보기" recorded, and which moment of it is shown (the last when none is picked). */
  readonly preview: builder.Preview | undefined;
  readonly frame: number | undefined;
  readonly activity: ActivityState;
  readonly now: number;
}

const NONE: Pick<world3d.CrewWorld, "alarms" | "activity"> = { alarms: [], activity: [] };

/** The crew module, fetched the first time a room is looked at. */
function useKit(wanted: boolean): typeof import("./crew-lazy") | undefined {
  const [loaded, setLoaded] = useState<typeof import("./crew-lazy")>();
  useEffect(() => {
    if (!wanted || loaded) return;
    let live = true;
    import("./crew-lazy").then((m) => live && setLoaded(m));
    return () => {
      live = false;
    };
  }, [wanted, loaded]);
  return loaded;
}

export function useCrew(view: WorldView | undefined, input: CrewInput): void {
  const { index, catalog, roomId, preview, activity, now } = input;
  const lazy = useKit(roomId !== undefined);
  const crew = useMemo(() => {
    const scene = roomId && lazy ? world3d.roomScene(index, catalog, roomId) : undefined;
    return scene && lazy ? lazy.crewOf(scene) : undefined;
  }, [index, catalog, roomId, lazy]);
  const frames = preview?.frames;
  const shown = frames
    ? frames[Math.min(input.frame ?? frames.length - 1, frames.length - 1)]
    : undefined;
  const trouble = useMemo(
    () =>
      crew && lazy
        ? lazy.troubleOf(index, crew, {
            alarms: shown?.alarms ?? [],
            t: shown?.t ?? 0,
            workers: activity.workers,
            now,
          })
        : NONE,
    [index, crew, lazy, shown, activity, now],
  );
  useEffect(() => {
    if (!view) return;
    view.crew.set(
      roomId && crew && lazy
        ? { kit: lazy.kit, roomId, crew, trouble, nameOf: (id) => index.find(id)?.name ?? id }
        : undefined,
    );
  }, [view, roomId, crew, lazy, trouble, index]);
  useEffect(() => () => view?.crew.set(undefined), [view]);
}
