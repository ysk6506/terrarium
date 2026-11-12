/**
 * The parts of a run's page (REQ-037): what the agent answered against the truth, the scoring sheet,
 * each tool call, and what the harness itself recorded (spans, logs) when ClickStack has it.
 */
import { costOf, type Span, spanKind, type Telemetry, usageOf } from "@terrarium/core/analysis";
import type { RunView } from "@terrarium/core/contract";
import type { ScoreItem } from "@terrarium/core/oracle";
import { emulationGaps, formatDuration, simTime } from "../../logic";
import { Note } from "../kit";

const VERDICTS: Readonly<Record<ScoreItem["verdict"], { label: string; tone: string }>> = {
  pass: { label: "해냈어요", tone: "good" },
  clean: { label: "깨끗했어요", tone: "good" },
  partial: { label: "일부만", tone: "warn" },
  fail: { label: "못했어요", tone: "bad" },
  penalty: { label: "감점", tone: "bad" },
};

/** A long explanation shows its start, and the rest opens on request. */
function Detail({ text }: { readonly text: string }) {
  if (text.length <= 160) return <>{text}</>;
  return (
    <details>
      <summary>{text.slice(0, 120)}...</summary>
      {text}
    </details>
  );
}

export function ScoreSheet({ items }: { readonly items: readonly ScoreItem[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>항목</th>
            <th>결과</th>
            <th className="num">점수</th>
            <th>이유</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const v = VERDICTS[i.verdict] ?? { label: i.verdict, tone: "neutral" };
            return (
              <tr key={i.id}>
                <td>{i.label}</td>
                <td>
                  <span className={`status status-${v.tone}`}>{v.label}</span>
                </td>
                <td className="num">
                  {i.points} / {i.max || "감점"}
                </td>
                <td className="small">
                  <Detail text={i.detail} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The agent's answer beside what actually happened. */
export function DiagnosisCompare({ view }: { readonly view: RunView }) {
  const result = view.run.result;
  const a = view.analysis.diagnosis;
  const facts = result?.score.items.find((i) => i.facts)?.facts;
  if (!result) return null;
  if (!result.diagnosis)
    return (
      <Note tone="warn">
        에이전트가 진단을 내지 않고 끝났어요. 점수는 그동안 한 일로만 매겼어요.
      </Note>
    );
  const d = result.diagnosis;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>
              <span className="sr-only">항목</span>
            </th>
            <th>에이전트의 답</th>
            <th>실제 정답</th>
            <th>맞았나</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">원인 장비</th>
            <td>{d.rootCause}</td>
            <td>{facts?.rootCause.join(", ") ?? "—"}</td>
            <td>{a.root ? "맞았어요" : "틀렸어요"}</td>
          </tr>
          <tr>
            <th scope="row">고장 종류</th>
            <td>{d.faultType}</td>
            <td>{facts?.faultType.join(", ") ?? "—"}</td>
            <td>{a.type ? "맞았어요" : "틀렸어요"}</td>
          </tr>
          <tr>
            <th scope="row">설명</th>
            <td colSpan={3}>{d.summary}</td>
          </tr>
          {d.actions.length > 0 && (
            <tr>
              <th scope="row">제안한 조치</th>
              <td colSpan={3}>{d.actions.join(" / ")}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const compact = (args: Readonly<Record<string, unknown>>) => {
  const text = JSON.stringify(args);
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
};

export function CallsTable({ view }: { readonly view: RunView }) {
  const calls = view.run.result?.toolCalls ?? [];
  if (calls.length === 0) return <p className="muted small">부른 툴이 없어요.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="num">시각</th>
            <th>툴</th>
            <th>인자</th>
            <th>결과</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: calls are an ordered log without ids
            <tr key={i}>
              <td className="num">{simTime(c.t)}</td>
              <td>
                <code>{c.tool}</code>
              </td>
              <td className="small">
                <code>{compact(c.args)}</code>
              </td>
              <td>
                {c.ok ? (
                  <span className="status status-good">성공</span>
                ) : (
                  <span className="status status-bad">{c.error ?? "실패"}</span>
                )}
                {emulationGaps.gapCount([c]) > 0 && (
                  <div>
                    <span className="status status-warn">{emulationGaps.GAP_TAG}</span>
                    <p className="muted small" style={{ margin: "2px 0 0" }}>
                      {emulationGaps.GAP_EXPLAIN}
                    </p>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const KIND_LABELS = { llm: "모델 호출", tool: "툴", agent: "에이전트", other: "기타" } as const;

function SpanRow({ span, origin }: { readonly span: Span; readonly origin: number }) {
  const kind = spanKind(span);
  return (
    <tr>
      <td className="num">+{formatDuration((span.start - origin) / 1000)}</td>
      <td>{KIND_LABELS[kind]}</td>
      <td>{span.name}</td>
      <td className="num">{((span.end - span.start) / 1000).toFixed(1)}초</td>
      <td>
        {span.status === "error" ? (
          <span className="status status-bad">오류</span>
        ) : (
          <span className="status status-good">정상</span>
        )}
      </td>
    </tr>
  );
}

/** Calls, time in the model, answer time per call, tokens, models and cost, in one sentence each. */
function UsageLines({ telemetry }: { readonly telemetry: Telemetry }) {
  const usage = usageOf(telemetry);
  const cost = costOf(telemetry);
  const each = usage.llmCalls > 0 ? usage.llmSeconds / usage.llmCalls : 0;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <p className="small" style={{ margin: 0 }}>
        모델 호출 {usage.llmCalls}번, 모델에 쓴 시간 {usage.llmSeconds.toFixed(1)}초
        {usage.llmCalls > 0 && `(한 번에 ${each.toFixed(1)}초)`}.
      </p>
      <p className="small" style={{ margin: 0 }}>
        토큰 {(usage.inputTokens + usage.outputTokens).toLocaleString("ko-KR")}개
        {usage.models.length > 0 && `, 모델 ${usage.models.join(", ")}`}
        {cost > 0 && `, 비용 ${cost.toFixed(4)} 달러`}.
        {usage.errors > 0 && ` 오류 ${usage.errors}건.`}
      </p>
    </div>
  );
}

export function TelemetryPanel({
  telemetry,
  source,
}: {
  readonly telemetry: Telemetry;
  /** The tool the records were read from. */
  readonly source?: string;
}) {
  if (telemetry.spans.length === 0 && telemetry.logs.length === 0)
    return (
      <Note>
        {source ? `${source}에서` : "트레이스를 쌓는 곳에서"} 이 실행의 기록을 찾지 못했어요.
        하네스가 run_id를 남기는지 봐 주세요.
      </Note>
    );
  const origin = Math.min(...telemetry.spans.map((s) => s.start));
  const errorLogs = telemetry.logs.filter((l) => l.level === "error" || l.level === "warn");
  return (
    <div className="stack" style={{ gap: 20 }}>
      {source && <p className="small muted">{source}에서 읽었어요.</p>}
      <UsageLines telemetry={telemetry} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="num">시작</th>
              <th>종류</th>
              <th>이름</th>
              <th className="num">걸린 시간</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {[...telemetry.spans]
              .sort((a, b) => a.start - b.start)
              .slice(0, 300)
              .map((s) => (
                <SpanRow key={s.spanId} span={s} origin={origin} />
              ))}
          </tbody>
        </table>
      </div>
      {errorLogs.length > 0 && (
        <div className="stack">
          <h3 className="small">경고와 오류 로그</h3>
          <ul className="list-plain small">
            {errorLogs.slice(0, 50).map((l) => (
              <li key={`${l.time}:${l.message}`}>{l.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
