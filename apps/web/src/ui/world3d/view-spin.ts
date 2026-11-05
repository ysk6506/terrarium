/** The slow turn of a showcase: the camera goes round what is in view until the viewer touches it; it waits while the machine struggles badly. */
import { world3d } from "../../logic";
import type { Engine } from "./engine";
import type { Rig } from "./rig";
import { SPIN_STEP_S } from "./view-look";

/** Start turning; returns how to stop. `giveUp` is called when the viewer touches the view. */
export function startSpin(
  engine: Engine,
  rig: Rig,
  degPerSecond: number,
  giveUp: () => void,
): () => void {
  let since = 0;
  const off = engine.onFrame((dt) => {
    since += dt;
    // From the second level of strain on, the turn waits (it starts again when the machine recovers).
    if (!world3d.spinsAt(engine.strain.level)) {
      since = 0;
      return;
    }
    if (since < SPIN_STEP_S) return;
    const pose = rig.pose();
    rig.set({ ...pose, yaw: pose.yaw + (degPerSecond * Math.PI * since) / 180 });
    since = 0;
  });
  const stopOnTouch = rig.onUserMove(giveUp);
  return () => {
    off();
    stopOnTouch();
  };
}
