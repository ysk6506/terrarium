/**
 * Three settings of an experiment that are about what the agent is allowed and given (ADR-0087 items 4, 5 and 6):
 * how asking a person is answered, whether faults stay inside the given tools, and whether the agent gets the
 * scenario's runbook, is made to find it, or does not have it.
 */

import type { ScenarioRecord } from "@terrarium/core/experiments";
import type { EscalationMode, FaultScope, SopMode } from "@terrarium/core/session";
import { useId } from "react";
import { experiment, HUMAN_WORDS as W } from "../../logic";
import { Note, Segmented, TextField } from "../kit";

type Draft = experiment.Draft;

interface Props {
  readonly draft: Draft;
  readonly set: (change: Partial<Draft>) => void;
  /** The scenario chosen in step 1, for whether it has a runbook. */
  readonly scenario?: ScenarioRecord;
}

const ESCALATION: readonly { readonly value: EscalationMode; readonly label: string }[] = [
  { value: "wait", label: W.ESC_WAIT },
  { value: "auto", label: W.ESC_AUTO },
  { value: "fail", label: W.ESC_FAIL },
];

const SCOPE: readonly { readonly value: FaultScope; readonly label: string }[] = [
  { value: "inside", label: W.SCOPE_INSIDE },
  { value: "all", label: W.SCOPE_ALL },
];

const SOP: readonly { readonly value: SopMode; readonly label: string }[] = [
  { value: "none", label: W.SOP_NONE },
  { value: "given", label: W.SOP_GIVEN },
  { value: "search", label: W.SOP_SEARCH },
];

function Escalation({ draft, set }: Props) {
  const asks = draft.tools.includes("ask_human");
  const why = useId();
  return (
    <div className="stack human-setting" style={{ gap: 6 }}>
      <b>{W.ESC_TITLE}</b>
      <p id={why} className="small muted">
        {asks ? W.ESC_HELP : W.ESC_NEEDS_TOOL}
      </p>
      <div
        aria-disabled={!asks}
        aria-describedby={asks ? undefined : why}
        style={asks ? undefined : { opacity: 0.5, pointerEvents: "none" }}
      >
        <Segmented
          label={W.ESC_TITLE}
          value={draft.escalation.mode}
          options={ESCALATION}
          onChange={(mode) => set({ escalation: { ...draft.escalation, mode } })}
        />
      </div>
      {asks && draft.escalation.mode === "auto" && (
        <TextField
          label={W.ESC_REPLY}
          value={draft.escalation.reply ?? ""}
          multiline
          maxLength={1000}
          help={W.ESC_REPLY_HELP}
          onChange={(reply) => set({ escalation: { ...draft.escalation, reply } })}
        />
      )}
    </div>
  );
}

function Runbook({ draft, set, scenario }: Props) {
  const has = scenario?.doc.runbook !== undefined;
  return (
    <div className="stack human-setting" style={{ gap: 6 }}>
      <b>{W.SOP_TITLE}</b>
      <p className="small muted">{W.SOP_HELP}</p>
      <Segmented
        label={W.SOP_TITLE}
        value={draft.sop}
        options={SOP}
        onChange={(sop) => set(experiment.setSop(draft, sop))}
      />
      {!has && draft.sop !== "none" && <Note tone="warn">{W.SOP_NO_BOOK}</Note>}
      {draft.sop === "search" && <p className="tiny muted">{W.SOP_SEARCH_NOTE}</p>}
    </div>
  );
}

export function HumanSettings(props: Props) {
  const { draft, set } = props;
  return (
    <div className="stack human-settings" style={{ gap: 18 }} data-testid="human-settings">
      <Escalation {...props} />
      <div className="stack human-setting" style={{ gap: 6 }}>
        <b>{W.SCOPE_TITLE}</b>
        <p className="small muted">{W.SCOPE_HELP}</p>
        <Segmented
          label={W.SCOPE_TITLE}
          value={draft.faultScope}
          options={SCOPE}
          onChange={(faultScope) => set({ faultScope })}
        />
      </div>
      <Runbook {...props} />
    </div>
  );
}
