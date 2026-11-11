/**
 * 업무로 보면 (REQ-112, ADR-0135, 목업 4의 #8): 한 실험의 전후 비교와 단계 장부. 왼쪽은 사람이 적은 값("지금 하는 방식"),
 * 오른쪽은 테라리움이 실행의 기록에서 코드로 센 값이에요. 적은 표가 없으면 잰 값만 보이고 숫자를 지어내지 않아요.
 */
import { AGENT_WHO, type LedgerRow, type ProcessNumbers } from "@terrarium/core/analysis";
import type { ExperimentView, ProcessCompareView } from "@terrarium/core/contract";
import { processCompare as pc } from "../../logic";
import { MossAsk } from "../../moss";
import { Go, useApp, useAsync } from "../context";
import { Empty, Section } from "../kit";
import { WorldOntology } from "./process-ontology";

const { COMPARE_WORDS: W } = pc;

/** 운영 실험처럼 몇 시간씩 도는 실행은 줄이 많아서, 장부는 앞부분만 보여 줘요. */
const MAX_LINES = 40;

type Metric = "steps" | "people" | "time";

const ASKS: Readonly<Record<Metric, string>> = {
  steps: "남은 단계는 어떻게 세요?",
  people: "사람 수는 어떻게 세요?",
  time: "시간은 어떻게 재요?",
};

function Tile({
  metric,
  value,
  unit,
  delta,
}: {
  readonly metric: Metric;
  readonly value: string;
  readonly unit: string;
  readonly delta?: { readonly text: string; readonly up: boolean };
}) {
  return (
    <div className="pc-tile">
      <dd className="pc-num">{value}</dd>
      <dt className="pc-unit">
        <MossAsk question={ASKS[metric]}>{unit}</MossAsk>
      </dt>
      {delta && (
        <dd className={`pc-delta${delta.up ? " pc-delta-up" : ""}`}>
          <span className="sr-only">바뀐 양 </span>
          {delta.text}
        </dd>
      )}
    </div>
  );
}

function Written({ n }: { readonly n: ProcessNumbers }) {
  return (
    <section className="pt-card pc-col" aria-label={W.written}>
      <h3>{W.written}</h3>
      <div className="pc-lab">{W.writtenLab}</div>
      <dl className="pc-three">
        <Tile metric="steps" value={pc.countText(n.steps)} unit={W.steps} />
        <Tile metric="people" value={pc.countText(n.people)} unit={W.people} />
        <Tile metric="time" value={pc.timeText(n.seconds)} unit={W.time} />
      </dl>
    </section>
  );
}

function Measured({
  view,
  measured,
}: {
  readonly view: ProcessCompareView;
  readonly measured: ProcessNumbers;
}) {
  const d = view.delta;
  const tone = (n: number) => ({ up: n > 0 });
  return (
    <section className="pt-card pc-col" aria-label={W.measured}>
      <h3>{W.measured}</h3>
      <div className="pc-lab">{W.measuredLab(view.runs)}</div>
      <dl className="pc-three">
        <Tile
          metric="steps"
          value={pc.countText(measured.steps)}
          unit={W.stepsLeft}
          {...(d ? { delta: { text: pc.signedCount(d.steps), ...tone(d.steps) } } : {})}
        />
        <Tile
          metric="people"
          value={pc.countText(measured.people)}
          unit={W.people}
          {...(d ? { delta: { text: pc.signedCount(d.people), ...tone(d.people) } } : {})}
        />
        <Tile
          metric="time"
          value={pc.timeText(measured.seconds)}
          unit={W.time}
          {...(d ? { delta: { text: pc.signedTime(d.seconds), ...tone(d.seconds) } } : {})}
        />
      </dl>
    </section>
  );
}

const TAG_CLASS: Readonly<Record<LedgerRow["tag"], string>> = {
  agent: "pl-tag-agent",
  physical: "pl-tag-physical",
  approve: "pl-tag-approve",
  handoff: "pl-tag-handoff",
};

const TAG_WORDS: Readonly<Record<LedgerRow["tag"], string>> = {
  agent: "에이전트",
  physical: "물리",
  approve: "승인",
  handoff: "넘기기",
};

function RowText({ row }: { readonly row: LedgerRow }) {
  if (row.tag !== "agent")
    return (
      <span>
        {row.text}
        {row.note && <span className="pl-note">{row.note}</span>}
      </span>
    );
  const rest = row.text.startsWith(AGENT_WHO) ? row.text.slice(AGENT_WHO.length) : row.text;
  return (
    <span className="pl-agent">
      <b>{AGENT_WHO}</b>
      {rest} — {W.tools(row.tools ?? 0)}
    </span>
  );
}

function Ledger({
  ledger,
  runs,
}: {
  readonly ledger: NonNullable<ProcessCompareView["ledger"]>;
  readonly runs: number;
}) {
  return (
    <>
      <h3 className="small muted" style={{ margin: "20px 0 8px" }}>
        {W.ledger} · {W.ledgerOf(ledger.index + 1, runs)}
      </h3>
      <div className="pt-card" style={{ padding: 0 }}>
        <ol className="pl-list" aria-label={W.ledger}>
          {ledger.rows.slice(0, MAX_LINES).map((r) => (
            <li className="pl-row" key={`${r.from}-${r.tag}-${r.who}`}>
              <span className="pl-t">
                {pc.clock(r.from)}–{pc.clock(r.to)}
              </span>
              <RowText row={r} />
              <span className={`pl-tag ${TAG_CLASS[r.tag]}`}>{TAG_WORDS[r.tag]}</span>
            </li>
          ))}
        </ol>
      </div>
      {ledger.rows.length > MAX_LINES && (
        <p className="pl-remain">
          앞의 {MAX_LINES}줄만 보여요. 나머지 {ledger.rows.length - MAX_LINES}줄은 실행 화면에서
          봐요.
        </p>
      )}
      <p className="pl-remain">{ledger.remaining}</p>
    </>
  );
}

/** The comparison of one experiment; `finished` makes it read again while runs are still coming in. */
export function ProcessCompare({
  experimentId,
  finished,
}: {
  readonly experimentId: string;
  readonly finished: number;
}) {
  const { api } = useApp();
  const data = useAsync(
    (signal) => api.call("experimentProcess", { params: { id: experimentId }, signal }),
    [experimentId, finished],
  );
  const view = data.data;
  if (!view) return null;
  const title = W.title(view.scenarioName);
  if (!view.measured || !view.ledger)
    return (
      <Section title={title}>
        <Empty title={W.noRuns} />
      </Section>
    );
  return (
    <Section title={title}>
      <p className="small muted" style={{ marginTop: -4 }}>
        {W.sub}
      </p>
      <div className="pc-cols" style={view.baseline ? undefined : { gridTemplateColumns: "1fr" }}>
        {view.baseline && <Written n={view.baseline} />}
        <Measured view={view} measured={view.measured} />
      </div>
      {!view.baseline && view.hasScenario && (
        <p className="small">
          <Go
            to={{ name: "scenarioProcess", id: view.scenarioId }}
            className="btn btn-small"
            data-moss-skip="다음 화면으로"
          >
            {W.write}
          </Go>{" "}
          <span className="muted">{W.writeHint}</span>
        </p>
      )}
      <Ledger ledger={view.ledger} runs={view.runs} />
    </Section>
  );
}

/** What the result page adds under the findings: the before/after comparison and what the world needs for E2E. */
export function ProcessSections({ view }: { readonly view: ExperimentView }) {
  const id = view.experiment.id;
  return (
    <>
      <ProcessCompare experimentId={id} finished={view.progress.finished} />
      <WorldOntology worldId={view.experiment.recipe.worldId} experimentId={id} />
    </>
  );
}
