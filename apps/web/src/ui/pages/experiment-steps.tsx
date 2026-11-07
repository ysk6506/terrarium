/**
 * The three questions of a new experiment (REQ-030, REQ-031): what to test it on (world, scenario),
 * who is tested (harness, agent), and how (tools, runs, time, product versions).
 */
import type { ScenarioRecord, WorldSummary } from "@terrarium/core/experiments";
import { MAX_SEEDS } from "@terrarium/core/experiments";
import { BUILTIN_PROFILES } from "@terrarium/core/profiles";
import { useEffect } from "react";
import { experiment, hiddenWarning, howWords, toolPicker } from "../../logic";
import { useApp } from "../context";
import { Button, Check, Note, NumberField, SelectField, TextField } from "../kit";
import { DomainScope } from "./experiment-domains";
import { McpGuide } from "./experiment-mcp";
import { KindChoice, OperationInstruction, OperationSetup } from "./experiment-operation";
import { ExperimentMetadata, NoHarness, VersionPreview } from "./experiment-subject";
import { HumanSettings } from "./human-settings";
import { ScenarioPick } from "./scenario-pick";
import { ToolPicker } from "./tool-picker";

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
  scenarios,
}: StepProps & {
  readonly worlds: readonly WorldSummary[];
  /** The scenarios of the chosen world; undefined while they load. */
  readonly scenarios: readonly ScenarioRecord[] | undefined;
}) {
  const list = scenarios ?? [];
  const choices = toolPicker.scenarioChoices(list, draft.tools, draft.faultScope);
  // A world with scenarios starts with the first one that can be chosen, so the common case is one click fewer.
  // A choice that the tools or the fault scope put out of reach moves to the first one that is not.
  const first = choices.find((c) => !c.out)?.id;
  const current = choices.find((c) => c.id === draft.scenarioId);
  const stale = !current || current.out;
  const operation = draft.operation !== undefined;
  useEffect(() => {
    if (!operation && stale && first && first !== draft.scenarioId) set({ scenarioId: first });
  }, [operation, stale, first, draft.scenarioId, set]);
  return (
    <section className="wizard-step stack">
      <StepHead n={1} title="무엇으로 시험할까요?" problems={problems} />
      <div data-moss-action="exp-pick-world">
        <SelectField
          label="세계"
          value={draft.worldId}
          options={worlds.map((w) => ({ value: w.id, label: w.name }))}
          onChange={(worldId) => {
            const { scenarioId: _drop, ...rest } = draft;
            set({ ...rest, worldId });
          }}
        />
      </div>
      <KindChoice draft={draft} set={set} />
      {operation ? (
        <OperationSetup draft={draft} set={set} scenarios={list} />
      ) : (
        <div data-moss-action="exp-pick-scenario">
          <ScenarioPick
            choices={choices}
            value={draft.scenarioId}
            onChange={(scenarioId) => set({ scenarioId })}
            {...(draft.worldId && scenarios && list.length === 0
              ? { empty: "이 세계에는 시나리오가 아직 없어요. 시나리오 화면에서 만들어 보세요." }
              : {})}
          />
        </div>
      )}
    </section>
  );
}

export function WhoStep({
  draft,
  set,
  problems,
  onRegistered,
}: StepProps & { readonly onRegistered?: () => void }) {
  const { meta } = useApp();
  const harnesses = meta?.harnesses ?? [];
  const harness = harnesses.find((h) => h.id === draft.harnessId);
  if (meta && harnesses.length === 0)
    return (
      <section className="wizard-step stack">
        <StepHead n={2} title="누구를 시험할까요?" problems={problems} />
        <NoHarness />
      </section>
    );
  return (
    <section className="wizard-step stack">
      <StepHead n={2} title="누구를 시험할까요?" problems={problems} />
      <SelectField
        label="하네스"
        value={draft.harnessId}
        options={harnesses.map((h) => ({
          value: h.id,
          label: h.status === "ok" ? `${h.name} (${h.kind})` : `${h.name}: 지금 연결되지 않아요`,
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
            label: `${a.model ? `${a.name} (${a.model})` : a.name}${a.hidden ? " · 숨겼던 에이전트" : ""}`,
          }))}
          onChange={(agentId) => set({ agentId })}
          {...(harness.agents.find((a) => a.id === draft.agentId)?.description
            ? { help: harness.agents.find((a) => a.id === draft.agentId)?.description }
            : {})}
        />
      )}
      {hiddenWarning(harness?.agents.find((a) => a.id === draft.agentId)) && (
        <Note tone="warn">
          {hiddenWarning(harness?.agents.find((a) => a.id === draft.agentId))}
        </Note>
      )}
      {harness?.error && <Note tone="warn">{harness.error}</Note>}
      {harness && <McpGuide harness={harness} onChange={() => onRegistered?.()} />}
      {harness && draft.agentId && (
        <VersionPreview harnessId={harness.id} agentId={draft.agentId} />
      )}
    </section>
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

function RunsField({ draft, set }: Pick<StepProps, "draft" | "set">) {
  return (
    <div className="stack how-runs" style={{ gap: 6 }} data-moss-action="exp-set-runs">
      <NumberField
        label={howWords.RUNS_LABEL}
        error={draft.runs < 1 || draft.runs > MAX_SEEDS ? howWords.runsRange(MAX_SEEDS) : undefined}
        value={draft.runs}
        min={1}
        max={MAX_SEEDS}
        step={1}
        unit="번"
        onChange={(runs) => runs !== undefined && set({ runs: Math.round(runs) })}
        help={howWords.RUNS_HELP}
      />
      <div className="row" style={{ gap: 8 }}>
        <span className="tag tag-recommend">{howWords.RUNS_RECOMMEND}</span>
        {draft.runs !== howWords.RECOMMENDED_RUNS && (
          <Button
            data-moss-action="exp-set-runs"
            size="small"
            kind="quiet"
            onClick={() => set({ runs: howWords.RECOMMENDED_RUNS })}
          >
            {howWords.RECOMMENDED_RUNS}번으로 맞추기
          </Button>
        )}
      </div>
    </div>
  );
}

function TimeFields({ draft, set }: Pick<StepProps, "draft" | "set">) {
  const lockstep = draft.time.kind === "lockstep";
  return (
    <>
      <NumberField
        label={lockstep ? howWords.LOCKSTEP_LABEL : howWords.SPEED_LABEL}
        value={
          lockstep
            ? (draft.time as { secondsPerCall: number }).secondsPerCall
            : (draft.time as { speed: number }).speed
        }
        min={1}
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
        help={lockstep ? howWords.LOCKSTEP_HELP : howWords.SPEED_HELP}
      />
      <div className="stack" style={{ gap: 4 }}>
        <Check
          label={howWords.REALTIME_LABEL}
          checked={!lockstep}
          onChange={(on) =>
            set({
              time: on ? { kind: "realtime", speed: 10 } : { kind: "lockstep", secondsPerCall: 30 },
            })
          }
        />
        <p className="tiny muted">{howWords.REALTIME_HELP}</p>
      </div>
    </>
  );
}

/** What only an expert changes: how time flows and which API versions the agent meets. */
function Advanced({ draft, set }: Pick<StepProps, "draft" | "set">) {
  return (
    <details className="fold detail-fold" data-testid="how-advanced">
      <summary>{howWords.ADVANCED_TITLE}</summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <p className="small muted">{howWords.ADVANCED_HELP}</p>
        <div className="grid-2">
          <TimeFields draft={draft} set={set} />
          <SelectField
            label="vCenter 버전"
            value={draft.profiles.vcenter ?? ""}
            options={profileOptions("vcenter")}
            help={howWords.VERSION_HELP}
            onChange={(k) => set(setProfile(draft, "vcenter", k))}
          />
          <SelectField
            label="vROps 버전"
            value={draft.profiles.vrops ?? ""}
            options={profileOptions("vrops")}
            help={howWords.VERSION_HELP}
            onChange={(k) => set(setProfile(draft, "vrops", k))}
          />
        </div>
      </div>
    </details>
  );
}

export function HowStep({
  draft,
  set,
  problems,
  scenario,
}: StepProps & { readonly scenario?: ScenarioRecord }) {
  return (
    <section className="wizard-step stack">
      <StepHead n={3} title="어떻게 시험할까요?" problems={problems} />
      <RunsField draft={draft} set={set} />
      <OperationInstruction draft={draft} set={set} />
      <DomainScope draft={draft} set={set} />
      <div data-moss-action="exp-pick-tools">
        <ToolPicker
          selected={draft.tools}
          onChange={(tools) => set(experiment.withTools(draft, tools))}
          {...(scenario ? { scenario: scenario.doc } : {})}
        />
      </div>
      <HumanSettings draft={draft} set={set} {...(scenario ? { scenario } : {})} />
      {!draft.operation && <Advanced draft={draft} set={set} />}
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
        help="무엇을 알아보려는 실험인지 적어 두면 비교할 때 쉬워요."
      />
      <ExperimentMetadata draft={draft} set={set} />
    </section>
  );
}
