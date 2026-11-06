/**
 * "내 도메인" and the "SLA·예비 부품·팀" card of a new experiment (REQ-093, ADR-0098, ADR-0100, lead-times.md). The
 * first says which part of the operation the agent looks after: its tools come on, and everything else is handed to
 * the team that owns it. The second says how long those teams take. Left alone, the defaults of the table apply, and
 * the result says which settings the run had.
 */
import { DOMAINS, SLA_LABELS, SPARE_LABELS, START_LABELS } from "@terrarium/core/world";
import { experiment } from "../../logic";
import { Button, Check, SelectField } from "../kit";

type Draft = experiment.Draft;

interface Props {
  readonly draft: Draft;
  readonly set: (change: Partial<Draft>) => void;
}

const options = <K extends string>(labels: Readonly<Record<K, string>>) =>
  (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));

export const DOMAIN_WORDS = {
  title: "내 도메인",
  help: "에이전트가 맡을 도메인을 골라요. 고른 도메인의 툴이 켜지고, 나머지는 그 도메인 팀에 넘기는 툴로만 풀 수 있어요. 고르지 않으면 모든 도메인이 내 것이에요.",
  none: "모든 도메인",
  card: "SLA·예비 부품·팀",
  cardHelp: "넘긴 고장이 사라지기까지 걸리는 시간을 정해요. 건드리지 않으면 기본값이에요.",
  changed: "바꿨어요",
  reset: "기본값으로 되돌리기",
  sla: "벤더 SLA",
  slaHelp: "벤더가 부품과 엔지니어를 보내 주겠다고 약속한 시간이에요.",
  spares: "예비 부품",
  sparesHelp: "있으면 현장에서 바로 바꿔요. 없으면 벤더가 부품을 보내 줄 때까지 기다려요.",
  start: "일을 맡는 때",
  startHelp: "야간과 주말에는 현장 작업이 느려져요.",
  afterHours: "야간·주말에는 현장 작업이 1.5배 걸려요",
} as const;

const W = DOMAIN_WORDS;

function Mark({ on }: { readonly on: boolean }) {
  return on ? <span className="tag">{W.changed}</span> : null;
}

function LeadCard({ draft, set }: Props) {
  const lead = (change: Parameters<typeof experiment.setLeadTimes>[1]) =>
    set(experiment.setLeadTimes(draft, change));
  const value = { ...draft.leadTimes };
  return (
    <details
      className="fold detail-fold"
      data-testid="lead-card"
      open={draft.leadTimes !== undefined}
    >
      <summary>
        {W.card} <Mark on={draft.leadTimes !== undefined} />
      </summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <p className="small muted">{W.cardHelp}</p>
        <div className="grid-2">
          <SelectField
            label={W.sla}
            value={value.vendorSla ?? "nbd"}
            options={options(SLA_LABELS)}
            help={W.slaHelp}
            onChange={(vendorSla) => lead({ vendorSla: vendorSla as never })}
          />
          <SelectField
            label={W.spares}
            value={value.spares ?? "default"}
            options={options(SPARE_LABELS)}
            help={W.sparesHelp}
            onChange={(spares) => lead({ spares: spares as never })}
          />
          <SelectField
            label={W.start}
            value={value.start ?? "weekday_day"}
            options={options(START_LABELS)}
            help={W.startHelp}
            onChange={(start) => lead({ start: start as never })}
          />
        </div>
        <Check
          label={W.afterHours}
          checked={value.afterHours ?? true}
          onChange={(afterHours) => lead({ afterHours })}
        />
        {draft.leadTimes && (
          <div>
            <Button
              size="small"
              kind="quiet"
              onClick={() => set(experiment.setLeadTimes(draft, undefined))}
            >
              {W.reset}
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}

export function DomainScope({ draft, set }: Props) {
  const mine = draft.domains;
  const toggle = (id: (typeof DOMAINS)[number]["id"], on: boolean) =>
    set(experiment.setDomains(draft, on ? [...mine, id] : mine.filter((d) => d !== id)));
  return (
    <div className="stack how-domains" style={{ gap: 10 }}>
      <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600 }}>{W.title}</legend>
        <p className="small muted">{W.help}</p>
        <div className="tool-list">
          {DOMAINS.map((d) => (
            <Check
              key={d.id}
              label={d.label}
              hint={d.covers}
              checked={mine.includes(d.id)}
              onChange={(on) => toggle(d.id, on)}
            />
          ))}
        </div>
        {mine.length === 0 && <p className="tiny muted">{W.none}가 내 것이에요</p>}
      </fieldset>
      {mine.length > 0 && <LeadCard draft={draft} set={set} />}
    </div>
  );
}
