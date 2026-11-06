/**
 * The result of an operation run (REQ-090, ADR-0094 item 7): the three numbers that come first (availability, missed
 * alarms, detection delay), how long each incident lasted, and the rest of the measures. Read from the run's events, so
 * the numbers are the same whether the run is over or still going.
 */
import type { RunView } from "@terrarium/core/contract";
import { endReasonLabel } from "@terrarium/core/oracle";
import { incidents } from "@terrarium/core/world";
import { useMemo } from "react";
import { formatDuration, operationWords as op } from "../../logic";
import { Figures, Note, Section } from "../kit";

/** The bars of how long each incident lasted, longest at the top; an open one runs to the end and is red. */
function Distribution({ view }: { readonly view: RunView }) {
  const events = view.run.result?.events ?? [];
  const rows = useMemo(() => {
    const end = events.reduce((t, e) => Math.max(t, e.t), 0);
    return incidents(events)
      .map((i) => ({ ...i, lasted: (i.endT ?? end) - i.t, open: i.endT === undefined }))
      .sort((a, b) => b.lasted - a.lasted);
  }, [events]);
  if (rows.length === 0) return <p className="small muted">이 실행에서는 고장이 나지 않았어요.</p>;
  const longest = Math.max(...rows.map((r) => r.lasted), 1);
  return (
    <ul className="op-dist list-plain" aria-label="사건별 복구 시간">
      {rows.map((r) => (
        <li key={r.id}>
          <span className="op-dist-name small">{r.target}</span>
          <span className="op-dist-track" aria-hidden="true">
            <i
              className={r.open ? "open" : ""}
              style={{ width: `${Math.max(2, (r.lasted / longest) * 100)}%` }}
            />
          </span>
          <span className="small">
            {formatDuration(Math.round(r.lasted))}
            {r.open ? " · 아직 안 풀렸어요" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

const CSS = `
.op-dist { display: grid; gap: 6px; }
.op-dist li { display: grid; grid-template-columns: 9em 1fr 11em; gap: 10px; align-items: center; }
.op-dist-track { display: block; height: 8px; border-radius: 4px; background: var(--line); }
.op-dist-track i { display: block; height: 100%; border-radius: 4px; background: var(--good); }
.op-dist-track i.open { background: var(--bad); }
@media (max-width: 640px) { .op-dist li { grid-template-columns: 1fr; gap: 2px; } }
`;

export function OperationResult({ view }: { readonly view: RunView }) {
  const result = view.run.result;
  const report = result?.operation;
  const e = view.analysis.efficiency;
  const tokens =
    e.inputTokens === undefined ? undefined : (e.inputTokens ?? 0) + (e.outputTokens ?? 0);
  const metrics = useMemo(
    () => (result && report ? op.metricsOf(result.events ?? [], report.harms, tokens) : undefined),
    [result, report, tokens],
  );
  if (!result || !report || !metrics) return null;
  const note = op.limitNote(result.endReason, report.config.budget);
  return (
    <>
      <style>{CSS}</style>
      <p className="small muted" data-testid="operation-pace">
        {op.paceNote(report.config)} ·{" "}
        {endReasonLabel(result.endReason, {
          hours: report.config.hours,
          maxToolCalls: result.task.maxToolCalls,
        })}
      </p>
      {note && <Note tone="warn">{note}</Note>}
      {op.resumeNotes(result.events ?? []).map((text) => (
        <Note key={text}>{text}</Note>
      ))}
      {report.left > 0 && (
        <Note>
          계획한 고장 {report.planned}개 중 {report.left}개는 준 툴로 닿을 수 없어 일어나지 않게
          했어요.
        </Note>
      )}
      <Figures items={op.headlineFigures(metrics)} />
      <Section title="사건별 복구 시간">
        <Distribution view={view} />
      </Section>
      <Section title="비용과 감시">
        <Figures items={op.otherFigures(metrics)} />
      </Section>
    </>
  );
}
