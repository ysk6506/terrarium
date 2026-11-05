/**
 * The way into the airflow map (REQ-072): one quiet button that is always there in a hall with racks. The map itself,
 * and the drawing code under it, is a bundle of its own that comes down when the button is pointed at or pressed,
 * so the first screen does not carry it. While the bundle comes, a line says so, and the page does not jump.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { BlueprintIndex } from "@terrarium/core/world";
import { lazy, Suspense, useMemo } from "react";
import { world3d } from "../../logic";
import { Button } from "../kit";
import type { AirInput } from "./AirMap";
import type { WorldView } from "./view";

const loadMap = () => import("./AirMap").then((m) => ({ default: m.AirMap }));
const AirMap = lazy(loadMap);

/** Start the download early: the hand is on its way to the button. */
const warm = () => void loadMap();

export function AirDoor({
  view,
  index,
  catalog,
  input,
}: {
  readonly view: WorldView;
  readonly index: BlueprintIndex;
  readonly catalog: Catalog;
  readonly input: AirInput;
}) {
  const { roomId } = input;
  const scene = useMemo(() => world3d.roomScene(index, catalog, roomId), [index, catalog, roomId]);
  if (!scene || scene.purpose !== "data_hall" || scene.racks <= 0) return null;
  if (!input.on)
    return (
      <div className="air-enter">
        <Button
          kind="quiet"
          onClick={() => input.onToggle(true)}
          onPointerEnter={warm}
          onFocus={warm}
        >
          {world3d.AIR_WORDS.open}
        </Button>
      </div>
    );
  return (
    <Suspense
      fallback={
        <div className="air-bar">
          <output className="air-note">{world3d.AIR_WORDS.loading}</output>
        </div>
      }
    >
      <AirMap view={view} index={index} input={input} scene={scene} />
    </Suspense>
  );
}
