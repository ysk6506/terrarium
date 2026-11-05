/** The slow turn of a showcase: the camera goes round what is in view until the viewer touches it or the machine struggles. */
import type { Engine } from "./engine";
import type { Rig } from "./rig";
import { Strain } from "./strain";
import { SPIN_STEP_S } from "./view-look";

/** Start turning; returns how to stop. `giveUp` is called when frames get slow. */
export function startSpin(
  engine: Engine,
  rig: Rig,
  degPerSecond: number,
  giveUp: () => void,
): () => void {
  let since = 0;
  const strain = new Strain();
  const off = engine.onFrame((dt) => {
    since += dt;
    if (strain.frame(dt)) return giveUp();
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
