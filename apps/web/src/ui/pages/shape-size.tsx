/**
 * 서비스부터 ③ (REQ-109, ADR-0132): three numbers — 서버룸 몇 곳, 룸당 랙 몇 대, 랙당 서버 몇 대. They start from what the
 * services carry (rooms and racks computed to fit the servers those numbers need); what the chosen shape adds on top (a
 * second site, GPU racks) is said in one line under the total. The right column is the quiet summary of the whole shape
 * that used to sit on the ladders. Racks, switches, PDUs, cooling units and kW are counted from all of it.
 */
import {
  askTotal,
  loadOf,
  type ServiceDraft,
  type ShapePlan,
  SIZE_LIMITS,
  type SizeAsk,
  serversForLoad,
  sizeTotals,
  sizingNotes,
} from "@terrarium/core/sources/worldgen";
import { useEffect, useState } from "react";
import { count, type ShapeView } from "../../logic";
import { Button } from "../kit";
import { ShapePanel } from "./shape-panel";

type Key = keyof SizeAsk;

const ROWS: ReadonlyArray<{
  readonly key: Key;
  readonly name: string;
  readonly unit: string;
}> = [
  { key: "rooms", name: "서버룸", unit: "곳" },
  { key: "racksPerRoom", name: "룸당 랙", unit: "대" },
  { key: "perRack", name: "랙당 서버", unit: "대" },
];

/** One number with a minus and a plus: typing is allowed, and what is typed is kept inside the limits when the box is left. */
function Stepper(props: {
  readonly name: string;
  readonly unit: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly typed: boolean;
  readonly onChange: (n: number) => void;
}) {
  const { value, min, max } = props;
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const set = (n: number) => props.onChange(Math.min(max, Math.max(min, Math.round(n))));
  return (
    <div className="we-step-row">
      <span className="we-step-name">
        {props.name}
        {props.typed && <small> · 고친 값</small>}
      </span>
      <div className="we-stepper">
        <button
          type="button"
          data-moss-skip="세계 폼 안의 입력"
          aria-label={`${props.name} 줄이기`}
          disabled={value <= min}
          onClick={() => set(value - 1)}
        >
          −
        </button>
        <input
          inputMode="numeric"
          aria-label={`${props.name} 몇 ${props.unit}`}
          value={text}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, "");
            setText(digits);
            if (digits !== "") set(Number(digits));
          }}
          onBlur={() => setText(String(value))}
        />
        <button
          type="button"
          data-moss-skip="세계 폼 안의 입력"
          aria-label={`${props.name} 늘리기`}
          disabled={value >= max}
          onClick={() => set(value + 1)}
        >
          +
        </button>
        <small>{props.unit}</small>
      </div>
    </div>
  );
}

/** "서비스가 쓰는 서버는 약 30대예요. 배경까지 120대로 시작해요." */
function startLine(services: readonly ServiceDraft[], start: SizeAsk): string {
  const need = services.reduce((n, s) => n + serversForLoad(loadOf(s)), 0);
  return `서비스가 필요로 하는 서버는 모두 ${count(need)}대쯤이에요. 찾을 곳이 되도록 배경 서버를 더해 ${count(askTotal(start))}대로 시작해요.`;
}

export function SizeStep(props: {
  readonly services: readonly ServiceDraft[];
  readonly plan: ShapePlan;
  readonly size: SizeAsk;
  readonly start: SizeAsk;
  readonly typed: Readonly<Partial<SizeAsk>>;
  readonly view: ShapeView;
  readonly onSize: (patch: Partial<SizeAsk>) => void;
  readonly onReset: () => void;
  readonly problem: string | undefined;
}) {
  const { plan, size } = props;
  const total = sizeTotals(plan);
  const notes = sizingNotes(size, plan);
  const touched = Object.keys(props.typed).length > 0;
  return (
    <>
      <div className="we-qhead">
        <h1>서버는 어떻게 놓을까요?</h1>
        <span className="we-step">3 / 3</span>
      </div>
      <p className="we-sub">{startLine(props.services, props.start)}</p>
      <div className="we-two">
        <section className="we-panel" aria-label="서버 놓기">
          {ROWS.map((r) => (
            <Stepper
              key={r.key}
              name={r.name}
              unit={r.unit}
              value={size[r.key]}
              min={SIZE_LIMITS[r.key].min}
              max={SIZE_LIMITS[r.key].max}
              typed={props.typed[r.key] !== undefined}
              onChange={(n) => props.onSize({ [r.key]: n })}
            />
          ))}
          <p className="we-total" data-testid="size-total">
            서버 <b>{count(total.servers)}대</b> · 랙 <b>{count(total.racks)}대</b> · 서버룸{" "}
            <b>{count(total.rooms)}곳</b>
          </p>
          {notes.length > 0 && (
            <p className="we-note" data-testid="size-notes">
              {notes.join(" · ")}
            </p>
          )}
          {props.problem && (
            <p className="we-note" role="alert">
              {props.problem}
            </p>
          )}
          <p className="we-note">
            스위치 {count(plan.switches)}대 · PDU {count(plan.pdus)}대 · 냉방기{" "}
            {count(plan.coolers)}대 · {count(plan.kw)} kW는 이 모양에 맞춰 세요. 토폴로지는 접어서
            보여 줘요.
          </p>
          {touched && (
            <Button
              data-moss-skip="세계 폼 안의 입력"
              kind="quiet"
              size="small"
              onClick={props.onReset}
            >
              서비스가 필요한 값으로 되돌리기
            </Button>
          )}
        </section>
        <div className="we-rcol quiet">
          <ShapePanel view={props.view} />
        </div>
      </div>
    </>
  );
}
