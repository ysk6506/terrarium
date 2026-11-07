/**
 * The scoring sheet as sentences (REQ-034, REQ-071, ADR-0016, beta feedback 21): "이 시나리오는 무엇을 보나". One
 * sentence per line, with the pass rule on top and the total in view. A number inside a sentence is a box to type in;
 * a word opens the form behind it. The answer line fills itself from the fault blocks, and the baseline agents' result
 * sits right under the sentences.
 */
import type { Expectation, ExpectationKind } from "@terrarium/core/scenario";
import { useState } from "react";
import { scenario } from "../../logic";
import { NumberField } from "../fields";
import { Button, MenuButton, Note } from "../kit";
import { Calibration } from "./Calibration";
import { Body } from "./SheetBodies";
import type { ScenarioEditor } from "./useScenario";

function NumberToken(props: {
  readonly t: Extract<scenario.Token, { kind: "number" }>;
  readonly set: (c: Partial<Expectation>) => void;
}) {
  const { t, set } = props;
  const apply = (n: number) => {
    const v = Math.min(t.max, Math.max(t.min, Math.round(n)));
    if (t.field === "minutes") set({ seconds: v * 60 } as Partial<Expectation>);
    else if (t.field === "maxCalls") set({ maxCalls: v } as Partial<Expectation>);
    else set({ [t.field]: v } as Partial<Expectation>);
  };
  return (
    <>
      <input
        className="sentence-num"
        type="number"
        inputMode="numeric"
        aria-label={t.label}
        min={t.min}
        max={t.max}
        value={t.value}
        onChange={(ev) => ev.target.value !== "" && apply(Number(ev.target.value))}
      />
      {t.unit}
    </>
  );
}

function Line(props: {
  readonly x: Expectation;
  readonly e: ScenarioEditor;
  readonly open: boolean;
  readonly toggle: () => void;
}) {
  const { x, e, open, toggle } = props;
  const s = scenario.sentenceOf(x, e.doc, e.index);
  const set = (change: Partial<Expectation>) =>
    e.change((d) => scenario.updateExpectation(d, x.id, change));
  const issues = e.issues.filter((i) => i.expectationId === x.id);
  const refill =
    x.kind === "diagnosis" && !s.source && scenario.answerFromFaults(e.doc).faultType.length > 0;
  return (
    <li className={`sentence sentence-${s.tone}`} aria-label={scenario.EXPECTATION_LABELS[x.kind]}>
      <div className="sentence-body">
        <div>
          {s.tokens.map((t, i) => {
            const key = `${x.id}-${i}`;
            if (t.kind === "text") return <span key={key}>{t.text}</span>;
            if (t.kind === "number") return <NumberToken key={key} t={t} set={set} />;
            return (
              <button
                key={key}
                type="button"
                className="sentence-word"
                aria-expanded={open}
                onClick={toggle}
              >
                {t.text}
              </button>
            );
          })}
        </div>
        {s.source && <div className="sentence-source">{s.source}</div>}
        {refill && (
          <Button
            kind="quiet"
            size="small"
            onClick={() => e.change((d) => scenario.fillAnswer(d, x.id))}
          >
            고장 블록에서 다시 채우기
          </Button>
        )}
        {open && (
          <div className="sentence-edit stack">
            <Body x={x} e={e} set={set} />
          </div>
        )}
        {issues.map((i) => (
          <p key={i.message} className="field-error">
            {i.message}
          </p>
        ))}
      </div>
      <Button
        size="small"
        kind="quiet"
        icon="trash"
        aria-label={`${scenario.EXPECTATION_LABELS[x.kind]} 줄 지우기`}
        onClick={() => e.change((d) => scenario.removeExpectation(d, x.id))}
      />
    </li>
  );
}

/** The recovery time a sheet with services expects of its world: the window of the time points (REQ-108, ADR-0131). */
function ExpectedRecovery({ e }: { readonly e: ScenarioEditor }) {
  if (e.doc.scoring !== "recovery") return null;
  const seconds = e.doc.expectedRecoveryS;
  return (
    <div className="stack" style={{ margin: "8px 0" }}>
      <NumberField
        label="기대 복구 시간"
        unit="분"
        min={1}
        max={scenario.MAX_EXPECTED_MINUTES}
        value={seconds === undefined ? 5 : Math.round(seconds / 60)}
        onChange={(v) =>
          e.change((d) =>
            scenario.setExpectedRecovery(d, v === undefined || v <= 5 ? undefined : v),
          )
        }
        help={scenario.EXPECTED_RECOVERY_NOTE}
      />
    </div>
  );
}

export function Sheet({
  e,
  openSheet,
}: {
  readonly e: ScenarioEditor;
  readonly openSheet: () => void;
}) {
  const total = scenario.sheetTotal(e.doc);
  const kinds = Object.keys(scenario.EXPECTATION_LABELS) as ExpectationKind[];
  const [openId, setOpenId] = useState<string>();
  const notes = scenario.scoringNotes(e.doc);
  return (
    <div className="workspace scroll">
      <div className="page" style={{ maxWidth: 760 }}>
        <div className="section-head">
          <div>
            <h2>이 시나리오는 무엇을 보나</h2>
            <p className="small muted">
              {scenario.passSentence()}. 문장 안의 숫자는 바로 고치고, 낱말을 누르면 자세히 고쳐요.
            </p>
          </div>
          <MenuButton
            label="줄 더하기"
            icon="plus"
            items={kinds.map((k) => ({
              label: scenario.SCORE_LABELS[k],
              onSelect: () => {
                const id = e.addScore(k);
                if (id) setOpenId(id);
              },
            }))}
          />
        </div>
        {notes.map((n) => (
          <Note key={n}>{n}</Note>
        ))}
        <ExpectedRecovery e={e} />
        <ul className="stack" style={{ gap: 0, margin: 0, padding: 0, listStyle: "none" }}>
          {e.doc.expectations.length === 0 && (
            <li className="muted">
              아직 보는 것이 없어요. 오른쪽 위 "줄 더하기"로 무엇을 볼지 정해 주세요.
            </li>
          )}
          {e.doc.expectations.map((x) => (
            <Line
              key={x.id}
              x={x}
              e={e}
              open={openId === x.id}
              toggle={() => setOpenId(openId === x.id ? undefined : x.id)}
            />
          ))}
        </ul>
        <p className="small" style={{ marginTop: 12 }}>
          {total.note ?? `모두 더해 ${total.points}점이에요.`}
        </p>
        <Calibration e={e} openSheet={openSheet} />
      </div>
    </div>
  );
}
