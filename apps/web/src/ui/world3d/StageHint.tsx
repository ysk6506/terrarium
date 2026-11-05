/**
 * A line at the bottom of the stage that says what a click does where the camera is now (feedback 6 and 8): at a
 * rack, that a server turns the rack about; inside a containment, how to get out, with a button that does it.
 */
import { world3d } from "../../logic";
import { Button } from "../kit";
import type { RackState } from "./rack-layer";
import type { Aisle, WorldView } from "./view";

/** What a click on a server does, given where the rack stands. */
export function rackHint(state: RackState): string {
  if (state.selected === undefined) return "서버를 누르면 랙이 돌아 뒷면이 보여요";
  return state.rear
    ? "같은 서버를 다시 누르면 앞면이 보여요. Esc를 누르면 서버를 넣어요"
    : "서버를 누르면 뒷면이 보여요. Esc를 누르면 서버를 넣어요";
}

export function StageHint({
  view,
  focus,
  rack,
  aisle,
}: {
  readonly view: WorldView;
  readonly focus: world3d.Focus;
  readonly rack: RackState | undefined;
  readonly aisle: Aisle | undefined;
}) {
  if (aisle)
    return (
      <div className="stage-hint">
        <output>{world3d.LEAVE_HINT}</output>
        <Button size="small" onClick={() => view.leaveAisle()}>
          복도 나가기
        </Button>
      </div>
    );
  if (focus.kind !== "rack") return null;
  return (
    <>
      <div className="stage-vignette" aria-hidden="true" />
      <div className="stage-hint">
        <output>{rackHint(rack ?? { selected: undefined, rear: false })}</output>
      </div>
    </>
  );
}
