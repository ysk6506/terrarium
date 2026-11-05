/**
 * "서버룸 채우기" (REQ-043, REQ-047, REQ-077): a bare server room gets its racks, servers, cooling and power in one
 * go, with the aisles covered or not. The button is the pick card's main one; what is left here are the two choices
 * under it, worded as what they come to ("랙마다 서버 7대, 전력 4 kW").
 */
import { useMemo, useState } from "react";
import { builder } from "../../logic";
import { SelectField } from "../kit";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";

export interface FillChoice {
  readonly load: builder.FillLoad;
  readonly aisle: builder.FillAisle;
}

export function useFillChoice() {
  const [choice, setChoice] = useState<FillChoice>({ load: "half", aisle: "cold" });
  return { choice, setChoice };
}

/** Fill the room with what was chosen; the whole of it is one step of undo. */
export function fillWith(b: Builder, roomId: string, choice: FillChoice): void {
  b.apply(
    (bp) => builder.fillRoom(bp, catalog, roomId, choice),
    "랙과 설비를 채웠어요. 되돌리려면 Ctrl+Z를 눌러요",
  );
}

export function FillChoices({
  choice,
  onChange,
}: {
  readonly choice: FillChoice;
  readonly onChange: (next: FillChoice) => void;
}) {
  const loads = useMemo(() => builder.loadChoices(catalog), []);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <SelectField
        label="랙을 얼마나 채울까요"
        value={choice.load}
        options={loads}
        onChange={(load) => onChange({ ...choice, load: load as builder.FillLoad })}
      />
      <SelectField
        label="복도는 어떻게 할까요"
        value={choice.aisle}
        options={builder.AISLE_CHOICES}
        onChange={(aisle) => onChange({ ...choice, aisle: aisle as builder.FillAisle })}
      />
      <p className="tiny muted">
        랙은 두 줄씩 짝을 지어 세워요. 냉방기와 전기는 방의 뒤쪽 벽에 세우고 케이블도 이어 줘요.
      </p>
    </div>
  );
}
