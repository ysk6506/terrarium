/**
 * Worlds (REQ-009, REQ-033, REQ-035, REQ-077, REQ-094, REQ-101): the list as cards in popularity order, and the way to a new
 * world, which is a page of its own with the first question (what are you here to do) and two doors.
 */
import { Go } from "../context";
import { PageHead } from "../kit";
import { WorldBoard } from "./world-board";

export { ORIGIN_LABELS } from "./world-card";

export function WorldsPage() {
  return (
    <div className="page">
      <PageHead
        title="세계"
        lede="에이전트가 일할 데이터센터예요. 사업장 그대로 만들거나, 작게 시작해서 직접 키워요."
        actions={
          <Go data-moss-action="go-new-world" to={{ name: "newWorld" }} className="btn btn-primary">
            새 세계
          </Go>
        }
      />
      <WorldBoard />
    </div>
  );
}
