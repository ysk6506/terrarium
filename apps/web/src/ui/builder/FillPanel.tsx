/**
 * "서버룸 채우기" (REQ-043, REQ-047): a bare server room gets its racks, servers, cooling and power in one go, with
 * the aisles sealed or not. A room with things in it says why it cannot be filled.
 */
import { roomPurposeOf } from "@terrarium/core/world";
import { useState } from "react";
import { builder, count } from "../../logic";
import { Button, SelectField } from "../kit";
import type { Builder } from "./useBuilder";
import { catalog } from "./useBuilder";

const LOAD_HELP: Readonly<Record<builder.FillLoad, string>> = {
  empty: "랙만 세워요. 서버는 나중에 한 대씩 달 수 있어요.",
  half: "랙마다 서버를 PDU 용량의 3분의 1쯤 채워요.",
  full: "랙마다 서버를 PDU 용량의 80%까지 채워요.",
};

/** Why this room cannot be filled right now, or undefined when it can. */
function whyNot(b: Builder, roomId: string): string | undefined {
  return b.state.index.childrenOf(roomId).length > 0
    ? "이미 놓은 것이 있어요. 모두 지우고 비운 서버룸에서 다시 채워 보세요"
    : undefined;
}

export function FillPanel({ roomId, b }: { readonly roomId: string; readonly b: Builder }) {
  const [load, setLoad] = useState<builder.FillLoad>("half");
  const [aisle, setAisle] = useState<builder.FillAisle>("cold");
  const blocked = whyNot(b, roomId);
  if (roomPurposeOf(b.state.index.entity(roomId)) !== "data_hall") return null;
  const fill = () =>
    b.apply(
      (bp) => builder.fillRoom(bp, catalog, roomId, { load, aisle }),
      `랙과 설비를 채웠어요. 되돌리려면 Ctrl+Z를 눌러요`,
    );
  return (
    <div className="builder-block stack">
      <h3>서버룸 채우기</h3>
      <SelectField
        label="서버"
        value={load}
        options={builder.FILL_LOADS.map((o) => ({ value: o.value, label: o.label }))}
        onChange={(v) => setLoad(v as builder.FillLoad)}
        help={LOAD_HELP[load]}
      />
      <SelectField
        label="복도"
        value={aisle}
        options={builder.FILL_AISLES.map((o) => ({ value: o.value, label: o.label }))}
        onChange={(v) => setAisle(v as builder.FillAisle)}
      />
      <Button
        icon="wand"
        kind="primary"
        disabled={blocked !== undefined}
        {...(blocked ? { why: blocked } : {})}
        onClick={fill}
      >
        서버룸 채우기
      </Button>
      {blocked ? (
        <p className="tiny muted">{blocked}</p>
      ) : (
        <p className="tiny muted">
          한 줄에 최대 {count(20)}개씩, 두 줄이 한 쌍이에요. 냉방기와 분전반, UPS는 방의 뒤쪽 벽에
          세우고 케이블은 모두 이어 줘요. 방이 {builder.MIN_FILL_M.w} × {builder.MIN_FILL_M.d} m보다
          작으면 채울 수 없어요.
        </p>
      )}
    </div>
  );
}
