/**
 * "숫자 고치기" (REQ-109, ADR-0132): the four numbers a service carries — requests a second, data, people at once and the
 * stop it allows — in one small sheet, with the training hours when the card has them. No money here: what a stop
 * costs is the experiment's "바꾸기". The numbers are what "알아서" and the sizing read.
 */
import { withJosa } from "@terrarium/core/kernel";
import { LOAD_LABELS, LOAD_LIMITS, loadProblem, type ServiceLoad } from "@terrarium/core/world";
import { useState } from "react";
import { Button, Dialog, NumberField } from "../kit";

type Key = keyof ServiceLoad;

const HELP: Readonly<Record<Key, string>> = {
  rps: "바쁜 시간에 1초마다 들어오는 요청이에요",
  dataGB: "쌓아 두는 데이터예요 (1 TB는 1,000 GB)",
  users: "같은 때에 쓰는 사람 수예요",
  maxDowntimeS: "이만큼까지는 멈춰도 괜찮아요 (60초는 1분)",
  gpuHours: "한 달 동안 도는 GPU 학습 시간이에요",
};

export function LoadSheet({
  name,
  load,
  onApply,
  onClose,
}: {
  readonly name: string;
  readonly load: ServiceLoad;
  readonly onApply: (load: ServiceLoad) => void;
  readonly onClose: () => void;
}) {
  const [edit, setEdit] = useState<ServiceLoad>(load);
  const keys: Key[] = ["rps", "dataGB", "users", "maxDowntimeS"];
  if (load.gpuHours !== undefined && load.gpuHours > 0) keys.push("gpuHours");
  const problem = loadProblem(edit);
  return (
    <Dialog
      title={`${withJosa(name, "이")} 얼마나 받아요?`}
      onClose={onClose}
      actions={
        <>
          <Button data-moss-skip="세계 폼 안의 입력" kind="quiet" onClick={onClose}>
            닫기
          </Button>
          <Button
            data-moss-skip="세계 폼 안의 입력"
            kind="primary"
            disabled={problem !== undefined}
            why={problem}
            onClick={() => onApply(edit)}
          >
            이 숫자로 정해요
          </Button>
        </>
      }
    >
      <p className="we-sub">"알아서"가 층을 고르고, 서버 수가 시작하는 값이 이 숫자에서 나와요.</p>
      <div className="we-load-fields">
        {keys.map((k) => (
          <NumberField
            key={k}
            label={LOAD_LABELS[k].name}
            unit={LOAD_LABELS[k].unit}
            help={HELP[k]}
            min={LOAD_LIMITS[k].min}
            max={LOAD_LIMITS[k].max}
            value={edit[k]}
            onChange={(v) => setEdit((e) => ({ ...e, [k]: v ?? 0 }))}
          />
        ))}
      </div>
    </Dialog>
  );
}
