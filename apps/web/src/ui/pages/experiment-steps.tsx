/**
 * The three questions of a new experiment (REQ-030, REQ-031): what to test it on (world, scenario),
 * who is tested (harness, agent), and how (tools, runs, time, product versions).
 */
import type { ScenarioRecord, WorldSummary } from "@terrarium/core/experiments";
import { MAX_SEEDS } from "@terrarium/core/experiments";
import { BUILTIN_PROFILES } from "@terrarium/core/profiles";
import { useEffect } from "react";
import { experiment } from "../../logic";
import { useApp, useAsync } from "../context";
import { Check, Note, NumberField, SelectField, TextField } from "../kit";

type Draft = experiment.Draft;
interface StepProps {
  readonly draft: Draft;
  readonly set: (change: Partial<Draft>) => void;
  readonly problems: readonly string[];
}

function StepHead({
  n,
  title,
  problems,
}: {
  readonly n: number;
  readonly title: string;
  readonly problems: readonly string[];
}) {
  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <h2>
        {n}. {title}
      </h2>
      {problems.length === 0 ? (
        <span className="status status-good">정해짐</span>
      ) : (
        <span className="tiny muted">{problems[0]}</span>
      )}
    </div>
  );
}

export function WhatStep({
  draft,
  set,
  problems,
  worlds,
}: StepProps & { readonly worlds: readonly WorldSummary[] }) {
  const { api } = useApp();
  const scenarios = useAsync(
    (signal) =>
      draft.worldId
        ? api.call("listScenarios", { query: { worldId: draft.worldId }, signal })
        : Promise.resolve([] as ScenarioRecord[]),
    [draft.worldId],
  );
  const list = scenarios.data ?? [];
  const first = list[0]?.id;
  const known = list.some((x) => x.id === draft.scenarioId);
  // A world with scenarios starts with the first one chosen, so the common case is one click fewer.
  useEffect(() => {
    if (!known && first) set({ scenarioId: first });
  }, [known, first, set]);
  return (
    <section className="wizard-step stack">
      <StepHead n={1} title="무엇으로 시험하나" problems={problems} />
      <SelectField
        label="세계"
        value={draft.worldId}
        options={worlds.map((w) => ({ value: w.id, label: w.name }))}
        onChange={(worldId) => {
          const { scenarioId: _drop, ...rest } = draft;
          set({ ...rest, worldId });
        }}
      />
      <SelectField
        label="시나리오"
        value={draft.scenarioId}
        options={list.map((s) => ({
          value: s.id,
          label: `${s.name} (채점 ${s.doc.expectations.length}항목)`,
        }))}
        onChange={(scenarioId) => set({ scenarioId })}
        {...(draft.worldId && scenarios.data && list.length === 0
          ? { help: "이 세계에는 시나리오가 아직 없다. 시나리오 화면에서 만든다." }
          : {})}
      />
    </section>
  );
}

export function WhoStep({ draft, set, problems }: StepProps) {
  const { meta } = useApp();
  const harnesses = meta?.harnesses ?? [];
  const harness = harnesses.find((h) => h.id === draft.harnessId);
  return (
    <section className="wizard-step stack">
      <StepHead n={2} title="누구를 시험하나" problems={problems} />
      <SelectField
        label="하네스"
        value={draft.harnessId}
        options={harnesses.map((h) => ({
          value: h.id,
          label: h.status === "ok" ? `${h.name} (${h.kind})` : `${h.name}: 지금 닿지 않는다`,
          disabled: h.status !== "ok",
        }))}
        onChange={(harnessId) => {
          const first = harnesses.find((h) => h.id === harnessId)?.agents[0]?.id;
          set({ harnessId, ...(first ? { agentId: first } : {}) });
        }}
        {...(harness ? { help: harness.description } : {})}
      />
      {harness && (
        <SelectField
          label="에이전트"
          value={draft.agentId}
          options={harness.agents.map((a) => ({
            value: a.id,
            label: a.model ? `${a.name} (${a.model})` : a.name,
          }))}
          onChange={(agentId) => set({ agentId })}
          {...(harness.agents.find((a) => a.id === draft.agentId)?.description
            ? { help: harness.agents.find((a) => a.id === draft.agentId)?.description }
            : {})}
        />
      )}
      {harness?.error && <Note tone="warn">{harness.error}</Note>}
    </section>
  );
}

function ToolPicker({ draft, set }: Pick<StepProps, "draft" | "set">) {
  return (
    <div className="stack" style={{ gap: 14 }}>
      {experiment.toolGroups().map((g) => (
        <fieldset
          key={g.category}
          className="stack"
          style={{ gap: 6, border: 0, padding: 0, margin: 0 }}
        >
          <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
            {g.label}
          </legend>
          <div className="tool-list">
            {g.tools.map((t) => (
              <Check
                key={t.name}
                label={t.title}
                hint={t.description}
                checked={t.name === "submit_diagnosis" || draft.tools.includes(t.name)}
                disabled={t.name === "submit_diagnosis"}
                onChange={(on) => set({ tools: experiment.toggleTool(draft, t.name, on).tools })}
              />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

const profileOptions = (protocol: "vcenter" | "vrops") => [
  { value: "", label: "기본" },
  ...BUILTIN_PROFILES.filter((p) => p.protocol === protocol).map((p) => ({
    value: p.key,
    label: `${p.product} ${p.version}`,
  })),
];

function setProfile(draft: Draft, protocol: "vcenter" | "vrops", key: string): Partial<Draft> {
  const { [protocol]: _old, ...rest } = draft.profiles;
  return { profiles: key ? { ...rest, [protocol]: key } : rest };
}

export function HowStep({ draft, set, problems }: StepProps) {
  const lockstep = draft.time.kind === "lockstep";
  return (
    <section className="wizard-step stack">
      <StepHead n={3} title="어떻게 시험하나" problems={problems} />
      <ToolPicker draft={draft} set={set} />
      <div className="grid-2">
        <NumberField
          label="실행 횟수"
          error={
            draft.runs < 1 || draft.runs > MAX_SEEDS
              ? `실행 횟수는 1~${MAX_SEEDS}번이다`
              : undefined
          }
          value={draft.runs}
          min={1}
          max={MAX_SEEDS}
          step={1}
          unit="회"
          onChange={(runs) => runs !== undefined && set({ runs: Math.round(runs) })}
          help="시드 1부터 차례로 쓴다. 3회 이상이어야 벤치마크 순위에 오른다."
        />
        <NumberField
          label={lockstep ? "툴 호출 한 번에 흐르는 시간" : "시간 배속"}
          value={
            lockstep
              ? (draft.time as { secondsPerCall: number }).secondsPerCall
              : (draft.time as { speed: number }).speed
          }
          min={lockstep ? 1 : 1}
          max={lockstep ? 600 : 120}
          unit={lockstep ? "초" : "배"}
          onChange={(v) =>
            v !== undefined &&
            set({
              time: lockstep
                ? { kind: "lockstep", secondsPerCall: v }
                : { kind: "realtime", speed: v },
            })
          }
          help={
            lockstep
              ? "기본. 툴을 부를 때만 시간이 흘러 결과가 늘 같다."
              : "벽시계를 따라 시간이 흐른다."
          }
        />
        <SelectField
          label="vCenter 버전"
          value={draft.profiles.vcenter ?? ""}
          options={profileOptions("vcenter")}
          onChange={(k) => set(setProfile(draft, "vcenter", k))}
        />
        <SelectField
          label="vROps 버전"
          value={draft.profiles.vrops ?? ""}
          options={profileOptions("vrops")}
          onChange={(k) => set(setProfile(draft, "vrops", k))}
        />
      </div>
      <Check
        label="벽시계 시간으로 돌린다 (재현되지 않는다)"
        checked={!lockstep}
        onChange={(on) =>
          set({
            time: on ? { kind: "realtime", speed: 10 } : { kind: "lockstep", secondsPerCall: 30 },
          })
        }
      />
    </section>
  );
}

export function NameStep({
  draft,
  set,
  placeholder,
}: Pick<StepProps, "draft" | "set"> & { readonly placeholder: string }) {
  return (
    <section className="wizard-step stack">
      <TextField
        label="실험 이름"
        value={draft.name}
        placeholder={placeholder}
        maxLength={80}
        onChange={(name) => set({ name })}
      />
      <TextField
        label="메모 (선택)"
        value={draft.note}
        multiline
        maxLength={2000}
        onChange={(note) => set({ note })}
        help="무엇을 알아보려는 실험인지 적어 두면 비교할 때 쉽다."
      />
    </section>
  );
}
