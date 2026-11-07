/**
 * 서비스부터 ① (ADR-0108 item 1): a screen to confirm, not to choose. IAP is already picked and every name and number
 * on its card is pressed to be changed. "서비스 더하기" takes a name, what it gives, and what happens when it stops.
 */
import {
  customService,
  recount,
  type ServiceDraft,
  type ServicePart,
} from "@terrarium/core/sources/worldgen";
import { useState } from "react";
import { Button, TextField } from "../kit";
import { Editable } from "./shape-edit";

const TIERS: ReadonlyArray<{ tier: 0 | 1 | 2; label: string }> = [
  { tier: 0, label: "위" },
  { tier: 1, label: "가운데" },
  { tier: 2, label: "아래" },
];

function Parts({
  parts,
  tier,
  onChange,
}: {
  readonly parts: readonly ServicePart[];
  readonly tier: 0 | 1 | 2;
  readonly onChange: (index: number, part: ServicePart) => void;
}) {
  return (
    <span className="we-parts">
      {parts.map((p, i) =>
        (p.tier ?? 1) !== tier ? null : (
          <span key={`${p.label}-${i}`}>
            <Editable
              label="부분 이름"
              value={p.label}
              onCommit={(v) => onChange(i, { ...p, label: String(v) })}
            />
            {p.count !== undefined && (
              <>
                {" "}
                <Editable
                  numeric
                  min={1}
                  max={60}
                  label={`${p.label} 수`}
                  value={p.count}
                  onCommit={(v) => onChange(i, { ...p, count: Number(v) })}
                />
              </>
            )}
            {" · "}
          </span>
        ),
      )}
    </span>
  );
}

function StopRows({
  draft,
  onChange,
}: {
  readonly draft: ServiceDraft;
  readonly onChange: (next: ServiceDraft) => void;
}) {
  const setStop = (i: number, change: Partial<ServiceDraft["stops"][number]>) =>
    onChange({ ...draft, stops: draft.stops.map((s, k) => (k === i ? { ...s, ...change } : s)) });
  return (
    <>
      <span className="we-col-title">멈추면</span>
      {draft.stops.map((row, i) => (
        <div key={`${row.what}-${i}`} className={`we-dmg${row.bad ? " bad" : ""}`}>
          <span className="we-dmg-k">
            <Editable
              label="멈추는 곳"
              value={row.what}
              onCommit={(v) => setStop(i, { what: String(v) })}
            />
          </span>
          <span>
            <Editable
              label="멈추면 생기는 일"
              value={row.result}
              onCommit={(v) => setStop(i, { result: String(v) })}
            />
          </span>
        </div>
      ))}
    </>
  );
}

export function ServiceCard({
  draft,
  first,
  onChange,
  onRemove,
}: {
  readonly draft: ServiceDraft;
  readonly first: boolean;
  readonly onChange: (next: ServiceDraft) => void;
  readonly onRemove?: () => void;
}) {
  const setPart = (index: number, part: ServicePart) =>
    onChange(recount({ ...draft, parts: draft.parts.map((p, i) => (i === index ? part : p)) }));
  return (
    <article className="we-iap" aria-label={draft.name}>
      <div className="we-iap-head">
        <div>
          <h2>
            <Editable
              label="서비스 이름"
              value={draft.name}
              onCommit={(v) => onChange({ ...draft, name: String(v) })}
            />
            {first && <small className="muted"> IT Infra Agent Platform</small>}
          </h2>
          <p>
            <Editable
              label="서비스 설명"
              value={draft.gives}
              onCommit={(v) => onChange({ ...draft, gives: String(v) })}
            />
          </p>
        </div>
        <span className="we-badge">고름</span>
      </div>
      <div className="we-iap-grid">
        <div>
          <span className="we-col-title">이렇게 생겼어요</span>
          <div className="we-tiers">
            {TIERS.map((t) => (
              <div key={t.tier} className="we-tier">
                <span className="we-tier-k">{t.label}</span>
                <Parts parts={draft.parts} tier={t.tier} onChange={setPart} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <StopRows draft={draft} onChange={onChange} />
        </div>
      </div>
      <p className="we-note">
        예시예요 · 눌러서 바꿔요
        {onRemove && (
          <>
            {" · "}
            <Button size="small" kind="quiet" onClick={onRemove}>
              이 서비스 빼기
            </Button>
          </>
        )}
      </p>
    </article>
  );
}

/** "이 서비스가 부르는 서비스": the services already on the screen, one box each (REQ-100). */
function CallsLine({
  others,
  picked,
  onToggle,
}: {
  readonly others: readonly ServiceDraft[];
  readonly picked: readonly string[];
  readonly onToggle: (key: string) => void;
}) {
  if (others.length === 0) return null;
  return (
    <fieldset className="we-calls">
      <legend>이 서비스가 부르는 서비스 (없으면 비워 둬요)</legend>
      {others.map((o) => (
        <label key={o.key} className="we-call">
          <input
            type="checkbox"
            checked={picked.includes(o.key)}
            onChange={() => onToggle(o.key)}
          />{" "}
          {o.name}
        </label>
      ))}
    </fieldset>
  );
}

function AddService({
  n,
  others,
  onAdd,
}: {
  readonly n: number;
  readonly others: readonly ServiceDraft[];
  readonly onAdd: (s: ServiceDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState<readonly string[]>([]);
  const [name, setName] = useState("");
  const [gives, setGives] = useState("");
  const [stops, setStops] = useState("");
  if (!open)
    return (
      <div className="we-chips" style={{ marginTop: 14 }}>
        <button type="button" className="we-chip" onClick={() => setOpen(true)}>
          + 서비스 더하기<small>이름 · 무엇을 주나 · 멈추면 어떻게 되나</small>
        </button>
      </div>
    );
  const ready = name.trim() !== "";
  return (
    <form
      className="we-add stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onAdd(
          customService(n, {
            name: name.trim(),
            gives: gives.trim(),
            stopsText: stops.trim(),
            calls,
          }),
        );
        setOpen(false);
        setCalls([]);
        setName("");
        setGives("");
        setStops("");
      }}
    >
      <TextField label="이름" value={name} onChange={setName} />
      <TextField label="무엇을 주나" value={gives} onChange={setGives} />
      <TextField label="멈추면 어떻게 되나" value={stops} onChange={setStops} />
      <CallsLine
        others={others}
        picked={calls}
        onToggle={(key) =>
          setCalls((now) => (now.includes(key) ? now.filter((k) => k !== key) : [...now, key]))
        }
      />
      <div className="row">
        <Button kind="primary" type="submit" disabled={!ready} why="이름을 적어 주세요">
          서비스 더하기
        </Button>
        <Button kind="quiet" type="button" onClick={() => setOpen(false)}>
          그만두기
        </Button>
      </div>
    </form>
  );
}

/** The list without service `i`, and without the calls that led to it. */
function without(list: readonly ServiceDraft[], i: number): ServiceDraft[] {
  const gone = list[i]?.key;
  return list
    .filter((_, k) => k !== i)
    .map((s) => {
      if (!s.calls?.includes(gone as string)) return s;
      const { calls, ...rest } = s;
      const kept = calls.filter((c) => c !== gone);
      return kept.length > 0 ? { ...rest, calls: kept } : rest;
    });
}

export function ServicesStep({
  services,
  scenarios,
  onChange,
}: {
  readonly services: readonly ServiceDraft[];
  readonly scenarios: number;
  readonly onChange: (next: readonly ServiceDraft[]) => void;
}) {
  const change = (i: number, next: ServiceDraft) =>
    onChange(services.map((s, k) => (k === i ? next : s)));
  return (
    <>
      <div className="we-qhead">
        <h1>무엇을 떠받치는 세계인가요?</h1>
        <span className="we-step">1 / 3</span>
      </div>
      <p className="we-sub">
        클로즈 베타에는 IAP 하나가 들어 있어요. 다른 서비스는 아래에서 더하면 돼요.
      </p>
      {services.map((s, i) => (
        <ServiceCard
          key={s.key}
          draft={s}
          first={i === 0}
          onChange={(next) => change(i, next)}
          {...(services.length > 1 ? { onRemove: () => onChange(without(services, i)) } : {})}
        />
      ))}
      <p className="we-foot">
        시나리오 <b>{scenarios}개</b>가 따라와요 · 멈추면 시간당 피해는 3단계에서 적어요
      </p>
      <AddService
        n={services.length + 1}
        others={services}
        onAdd={(s) => onChange([...services, s])}
      />
    </>
  );
}
