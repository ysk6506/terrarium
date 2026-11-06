/**
 * 서비스부터 ②-b (ADR-0107 item 3b): the work the service is asked to do. What kind of work, how much, when, and which
 * resource it leans on. Every field starts on a guess with its reason; "이 일감이면" says which of the shape's faults hurt
 * this work most and least, and how the scenarios fall between day and night.
 */

import type { ServiceDraft } from "@terrarium/core/sources/worldgen";
import {
  DAY_PATTERN_LABELS,
  DAY_PATTERNS,
  heaviest,
  RESOURCE_LABELS,
  RESOURCES,
  type Resource,
  WORKLOAD_KIND_LABELS,
  WORKLOAD_KINDS,
  type WorkloadProfile,
} from "@terrarium/core/world";
import { useState } from "react";
import { guessWorkload, type ShapeView, workloadView } from "../../logic";
import { NumberField, Segmented } from "../kit";

type Field = "kind" | "rate" | "pattern" | "shares";

/** Shares that put `lean` first: half on it and the rest spread evenly. */
const sharesLeaning = (lean: Resource): WorkloadProfile["shares"] =>
  Object.fromEntries(
    RESOURCES.map((r) => [r, r === lean ? 0.5 : 0.5 / (RESOURCES.length - 1)]),
  ) as WorkloadProfile["shares"];

function Why({ text, touched }: { readonly text: string; readonly touched: boolean }) {
  return <p className="we-why">{touched ? "직접 정했어요" : text}</p>;
}

function WorkloadForm({
  draft,
  onChange,
}: {
  readonly draft: ServiceDraft;
  readonly onChange: (next: ServiceDraft) => void;
}) {
  const [touched, setTouched] = useState<ReadonlySet<Field>>(new Set());
  const guess = guessWorkload(draft);
  const w = draft.workload;
  const set = (field: Field, next: Partial<WorkloadProfile>) => {
    setTouched((t) => new Set(t).add(field));
    onChange({ ...draft, workload: { ...w, ...next } });
  };
  const has = (f: Field) => touched.has(f);
  return (
    <div className="we-work">
      <div className="we-work-row">
        <h4>무슨 일인가요</h4>
        <div>
          <Segmented
            label="일의 종류"
            value={w.kind}
            options={WORKLOAD_KINDS.map((k) => ({ value: k, label: WORKLOAD_KIND_LABELS[k] }))}
            onChange={(kind) => set("kind", { kind })}
          />
          <Why text={guess.why.kind} touched={has("kind")} />
        </div>
      </div>
      <div className="we-work-row">
        <h4>얼마나 하나요</h4>
        <div>
          <NumberField
            label="가장 바쁜 때의 분당 요청"
            value={w.perMinute}
            min={1}
            unit="건/분"
            onChange={(v) => v !== undefined && v >= 1 && set("rate", { perMinute: Math.round(v) })}
          />
          <Why text={guess.why.rate} touched={has("rate")} />
        </div>
      </div>
      <div className="we-work-row">
        <h4>언제 하나요</h4>
        <div>
          <Segmented
            label="하루 패턴"
            value={w.pattern}
            options={DAY_PATTERNS.map((p) => ({ value: p, label: DAY_PATTERN_LABELS[p] }))}
            onChange={(pattern) => set("pattern", { pattern })}
          />
          <Why text={guess.why.pattern} touched={has("pattern")} />
        </div>
      </div>
      <div className="we-work-row">
        <h4>무엇을 많이 쓰나요</h4>
        <div>
          <Segmented
            label="가장 많이 쓰는 자원"
            value={heaviest(w.shares)}
            options={RESOURCES.map((r) => ({ value: r, label: RESOURCE_LABELS[r] }))}
            onChange={(lean) => set("shares", { shares: sharesLeaning(lean) })}
          />
          <Why text={guess.why.shares} touched={has("shares")} />
        </div>
      </div>
    </div>
  );
}

function WorkloadCard({ draft, view }: { readonly draft: ServiceDraft; readonly view: ShapeView }) {
  const v = workloadView(draft.workload, view.problems, view.scenarios);
  return (
    <section className="we-shape" aria-label="이 일감이면" aria-live="polite">
      <h3>이 일감이면</h3>
      <div className="we-sh bad">
        <b>가장 아픈 고장</b>
        {v.hardest.length > 0
          ? v.hardest.join(" · ")
          : "이 모양에는 이 일감이 유난히 아파하는 고장이 없어요"}
      </div>
      <div className="we-sh good">
        <b>덜 아픈 고장</b>
        {v.easiest.length > 0 ? v.easiest.join(" · ") : "구분할 만한 고장이 없어요"}
      </div>
      <div className="we-shape-n">
        <div>
          <b>{v.day}</b>
          <small>낮 시나리오</small>
        </div>
        <div>
          <b>{v.night}</b>
          <small>밤 시나리오</small>
        </div>
      </div>
      <p className="we-shape-foot">
        낮은 오전 7시부터 오후 7시까지예요. 고장이 시작되는 시각은 이 일감이 바쁜 때에 더 자주
        걸려요.
      </p>
    </section>
  );
}

export function WorkloadStep({
  services,
  view,
  onChange,
}: {
  readonly services: readonly ServiceDraft[];
  readonly view: ShapeView;
  readonly onChange: (next: readonly ServiceDraft[]) => void;
}) {
  return (
    <>
      <div className="we-qhead">
        <h1>어떤 일을 시키나요?</h1>
        <span className="we-step">2 / 3</span>
      </div>
      <p className="we-sub">전부 알아서 채워 두었어요. 맞지 않는 칸만 바꿔요.</p>
      {services.map((s, i) => (
        <div key={s.key} className="we-layers" style={{ marginBottom: 14 }}>
          <section className="we-panel">
            <h3>{s.name}</h3>
            <WorkloadForm
              draft={s}
              onChange={(next) => onChange(services.map((x, k) => (k === i ? next : x)))}
            />
          </section>
          <WorkloadCard draft={s} view={view} />
        </div>
      ))}
    </>
  );
}
