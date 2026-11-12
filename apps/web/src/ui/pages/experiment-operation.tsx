/**
 * The operation half of the experiment form (REQ-090, ADR-0094): what kind of experiment (one incident or an
 * operation), how long, how time moves, where the faults come from, and what the agent is told to do over the shift.
 */

import type { ScenarioRecord } from "@terrarium/core/experiments";
import type { OperationConfig } from "@terrarium/core/session";
import { templatesOf } from "@terrarium/core/session";
import { experiment, operationWords as op } from "../../logic";
import { useApp } from "../context";
import { Button, Check, NumberField, Segmented, TextField } from "../kit";
import { PresetBar } from "../presets";

type Draft = experiment.Draft;
interface Props {
  readonly draft: Draft;
  readonly set: (change: Partial<Draft>) => void;
}

/** Replace the operation of the draft with a changed copy. */
const change = (draft: Draft, set: Props["set"], patch: Partial<OperationConfig>) =>
  draft.operation && set({ operation: { ...draft.operation, ...patch } });

/** One incident or an operation: the first question of the form. */
export function KindChoice({ draft, set }: Props) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="field-label">실험 종류</span>
      <Segmented
        label="실험 종류"
        value={draft.operation ? "operation" : "incident"}
        options={[
          { value: "incident", label: "사건 하나" },
          { value: "operation", label: "운영" },
        ]}
        onChange={(v) => set(experiment.setKind(draft, v === "operation"))}
      />
      <p className="small muted">
        {draft.operation
          ? "정해진 시간 동안 고장이 무작위로 나고, 에이전트가 계속 지켜보며 대응해요. 진단 제출로 끝나지 않고 시간이 다 되거나 사람이 멈출 때 끝나요."
          : "시나리오 하나를 풀고 진단을 내면 끝나요."}
      </p>
    </div>
  );
}

function HoursField({
  config,
  patch,
}: {
  config: OperationConfig;
  patch: (p: Partial<OperationConfig>) => void;
}) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {op.HOUR_CHOICES.map((h) => (
          <Button
            data-moss-skip="세부 조절"
            key={h}
            size="small"
            kind="quiet"
            chosen={config.hours === h}
            onClick={() => patch({ hours: h })}
          >
            {h}시간
          </Button>
        ))}
      </div>
      <NumberField
        label="운영 시간"
        value={config.hours}
        min={1}
        max={96}
        step={1}
        unit="시간"
        onChange={(hours) => hours !== undefined && patch({ hours })}
        help="세계에서 흐르는 시간이에요. 실시간이면 실제로 이만큼 걸려요."
      />
    </div>
  );
}

function PaceFields({
  config,
  patch,
}: {
  config: OperationConfig;
  patch: (p: Partial<OperationConfig>) => void;
}) {
  const fast = config.pace.mode === "fast";
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="field-label">시간</span>
      <Segmented
        label="시간"
        value={config.pace.mode}
        options={[
          { value: "realtime", label: op.PACE_TEXT.realtime.label },
          { value: "fast", label: op.PACE_TEXT.fast.label },
        ]}
        onChange={(mode) => patch({ pace: mode === "realtime" ? { mode } : { mode, speed: 30 } })}
      />
      <p className="small muted">{fast ? op.PACE_TEXT.fast.hint : op.PACE_TEXT.realtime.hint}</p>
      {config.pace.mode === "fast" && (
        <NumberField
          label="조용할 때의 속도"
          value={config.pace.speed}
          min={op.FAST_SPEED_MIN}
          max={op.FAST_SPEED_MAX}
          step={5}
          unit="배"
          onChange={(speed) => speed !== undefined && patch({ pace: { mode: "fast", speed } })}
          help="알람이 나면 1배로 돌아와요."
        />
      )}
    </div>
  );
}

function FaultFields({
  config,
  patch,
  scenarios,
}: {
  config: OperationConfig;
  patch: (p: Partial<OperationConfig>) => void;
  scenarios: readonly ScenarioRecord[];
}) {
  const preset = config.source.kind === "preset" ? config.source.preset : undefined;
  const faults = config.source.kind === "set" ? config.source.faults.length : 0;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="field-label">고장은 어디서 와요?</span>
      <Segmented
        label="고장은 어디서 와요?"
        value={config.source.kind}
        options={[
          { value: "preset", label: "고장률 표" },
          { value: "set", label: "시나리오 세트" },
        ]}
        onChange={(kind) =>
          patch({
            source:
              kind === "preset"
                ? { kind, preset: "normal" }
                : { kind, faults: scenarios.flatMap((s) => templatesOf(s.doc.nodes)) },
          })
        }
      />
      {preset !== undefined && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="field-label">바쁨 정도</span>
          <Segmented
            label="바쁨 정도"
            value={preset}
            options={op.PRESETS.map((p) => ({ value: p.id, label: p.label }))}
            onChange={(next) => patch({ source: { kind: "preset", preset: next } })}
          />
          <p className="small muted">
            {op.PRESETS.find((p) => p.id === preset)?.hint}. 장비 종류마다 고장률이 다르고, 낮에 더
            자주 나요.
          </p>
        </div>
      )}
      {preset === undefined && (
        <p className="small muted">
          이 세계의 시나리오 {scenarios.length}개에서 고장 {faults}개를 가져와 정해진 시간 안에
          무작위 순서로 한 번씩 내요. 시나리오의 고장 주입 블록만 쓰고 나머지 흐름은 쓰지 않아요.
        </p>
      )}
      <div className="grid-2">
        <NumberField
          label="연쇄 고장 확률"
          value={Math.round(config.cascadeChance * 100)}
          min={0}
          max={100}
          step={5}
          unit="%"
          onChange={(v) => v !== undefined && patch({ cascadeChance: v / 100 })}
          help="한 장비가 고장 나면 가까운 장비가 이어서 고장 날 확률이에요."
        />
        <NumberField
          label="동시 고장 확률"
          value={Math.round(config.simultaneousChance * 100)}
          min={0}
          max={100}
          step={5}
          unit="%"
          onChange={(v) => v !== undefined && patch({ simultaneousChance: v / 100 })}
          help="고장이 날 때 다른 장비도 같은 순간에 고장 날 확률이에요."
        />
      </div>
    </div>
  );
}

/** Step 1 when the experiment is an operation: how long, how time moves, where the faults come from. */
export function OperationSetup({
  draft,
  set,
  scenarios,
}: Props & { readonly scenarios: readonly ScenarioRecord[] }) {
  const config = draft.operation;
  if (!config) return null;
  const patch = (p: Partial<OperationConfig>) => change(draft, set, p);
  return (
    <div className="stack" style={{ gap: 18 }} data-testid="operation-setup">
      <HoursField config={config} patch={patch} />
      <PaceFields config={config} patch={patch} />
      <FaultFields config={config} patch={patch} scenarios={scenarios} />
    </div>
  );
}

/** The recommended instruction's lines, each with why it is there. */
function Reasons() {
  return (
    <details className="fold detail-fold">
      <summary>권장안의 줄마다 이유</summary>
      <ul className="list-plain small" style={{ marginTop: 8 }}>
        {op.RECOMMENDED_LINES.map((l) => (
          <li key={l.text}>
            <b>{l.text}</b>
            <br />
            <span className="muted">왜 이렇게 쓰나: {l.why}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Step 3 when the experiment is an operation: what the agent is told, why each line is there, and the wake switch. */
export function OperationInstruction({ draft, set }: Props) {
  const { meta } = useApp();
  const config = draft.operation;
  const harness = meta?.harnesses.find((h) => h.id === draft.harnessId);
  if (!config) return null;
  const patch = (p: Partial<OperationConfig>) => change(draft, set, p);
  const why = op.wakeReason(harness?.wakeable);
  return (
    <div className="stack" style={{ gap: 12 }} data-testid="operation-instruction">
      <TextField
        label="에이전트에게 주는 지시문"
        value={config.instruction}
        multiline
        maxLength={4000}
        onChange={(instruction) => patch({ instruction })}
        help="운영 안내 다음에 덧붙여 에이전트에게 가요. 비워 두면 안내만 가요."
      />
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Button
          data-moss-skip="세부 조절"
          size="small"
          kind="quiet"
          onClick={() => patch({ instruction: op.recommendedInstruction() })}
        >
          권장안 넣기
        </Button>
      </div>
      <Reasons />
      <ul className="list-plain small muted">
        {op.harnessNotes(harness?.kind).map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <PresetBar<"instruction">
        kind="instruction"
        current={config.instruction}
        onLoad={(instruction) => patch({ instruction })}
      />
      <div className="stack" style={{ gap: 4 }}>
        <Check
          label="알람마다 깨우기"
          checked={config.wakeOnAlarm}
          disabled={why !== undefined}
          onChange={(wakeOnAlarm) => patch({ wakeOnAlarm })}
        />
        <p className="tiny muted">{why ?? op.WAKE_HINT}</p>
      </div>
      <NumberField
        label="툴 호출 상한 (선택)"
        value={config.budget?.maxToolCalls}
        min={1}
        max={100000}
        step={100}
        unit="번"
        onChange={(n) =>
          patch({
            budget: n === undefined ? {} : { ...config.budget, maxToolCalls: Math.round(n) },
          })
        }
        help="넘으면 실행이 멈추고 그 사실이 기록돼요. 비워 두면 5,000번이에요."
      />
    </div>
  );
}
