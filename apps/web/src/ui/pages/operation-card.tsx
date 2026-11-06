/**
 * The check-in card of a running operation (REQ-090, ADR-0094 item 8): "14시간째 · 열린 사건 1 · 놓친 알람 0 · 다음 담당자
 * 완료 2시간 뒤". It reads the run's live events, so it is the same sentence the result will end with.
 */
import type { RunSummary } from "@terrarium/core/contract";
import { operationWords } from "../../logic";
import { Go } from "../context";
import { useRunData } from "../topology/useRunData";

function Card({
  run,
  worldId,
  hours,
  title,
}: {
  readonly run: Pick<RunSummary, "id" | "index">;
  readonly worldId: string;
  readonly hours: number;
  readonly title?: string;
}) {
  const { data } = useRunData(run.id, worldId, true);
  const text = data
    ? operationWords.checkText(operationWords.checkCard(data.record.events, hours))
    : "상태를 가져오는 중이에요";
  return (
    <article className="op-card">
      <div className="op-card-head">
        <b>{title ?? `${run.index + 1}번째 실행`}</b>
        <Go to={{ name: "run", id: run.id }}>자세히 보기</Go>
      </div>
      <output className="op-card-text" style={{ display: "block" }}>
        {text}
      </output>
    </article>
  );
}

const CSS = `
.op-card { padding: 14px 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); box-shadow: var(--card-shadow); }
.op-card-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.op-card-text { margin: 6px 0 0; font-variant-numeric: tabular-nums; color: var(--ink); }
.op-cards { display: grid; gap: 10px; }
`;

/** One card for each run of an operation that is going now; nothing when none is. */
export function OperationCards({
  runs,
  worldId,
  hours,
  title,
}: {
  readonly runs: readonly Pick<RunSummary, "id" | "index" | "status">[];
  readonly worldId: string;
  readonly hours: number;
  readonly title?: string;
}) {
  const going = runs.filter((r) => r.status === "running");
  if (going.length === 0) return null;
  return (
    <section className="op-cards" aria-label="운영 중간 점검">
      <style>{CSS}</style>
      {going.map((r) => (
        <Card key={r.id} run={r} worldId={worldId} hours={hours} {...(title ? { title } : {})} />
      ))}
    </section>
  );
}
