/**
 * Two blocks of a run's result that stand apart from the score (ADR-0087 items 4 and 6): how often the agent asked a
 * person, how long it waited and what people did for it; and how closely it followed the team's runbook. Neither is
 * mixed into the total, so the recovery-first score reads as it always did.
 */
import type { RunResult } from "@terrarium/core/session";
import { humanTalk, toolPicker } from "../../logic";
import { Figures, Section } from "../kit";

export function HumanBlock({ result }: { readonly result: RunResult | undefined }) {
  const figures = humanTalk.escalationFigures(result?.human);
  if (figures.length === 0) return null;
  return (
    <Section
      title="사람에게 넘긴 것"
      aside={<span className="tiny muted">점수에는 섞이지 않아요</span>}
    >
      <div data-testid="human-block">
        <Figures items={figures} />
      </div>
    </Section>
  );
}

export function SopBlock({ result }: { readonly result: RunResult | undefined }) {
  const sop = result?.sop;
  const figures = humanTalk.sopFigures(sop);
  if (!sop || figures.length === 0) return null;
  return (
    <Section
      title="절차서 준수"
      aside={<span className="tiny muted">복구 우선 점수와 따로 봐요</span>}
    >
      <div className="stack" data-testid="sop-block">
        <Figures items={figures} />
        <ol className="sop-steps list-plain small" aria-label="단계별 결과">
          {sop.steps.map((step) => {
            const state = humanTalk.stepState(step);
            return (
              <li key={step.id} className={`sop-step sop-${state}`}>
                <span
                  className={`status status-${state === "done" ? "good" : state === "thought" ? "neutral" : "warn"}`}
                >
                  {humanTalk.STEP_LABELS[state]}
                </span>{" "}
                {step.todo}
              </li>
            );
          })}
        </ol>
        {sop.extra.length > 0 && (
          <p className="small muted">
            절차서에 없는 조치를 했어요: {sop.extra.map(toolPicker.titleOf).join(", ")}. 감점은
            없어요
          </p>
        )}
      </div>
    </Section>
  );
}
