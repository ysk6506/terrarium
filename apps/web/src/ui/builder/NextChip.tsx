/**
 * The 다음 할 일 chip (REQ-077, ADR-0083): one line over the 3D view that says what to do next and goes there when
 * pressed. In the 둘러보기 it points at five places in turn instead; the first small site of a browser asks once
 * whether to do the tour. What the chip says is a function of the world (logic.nextStep); this only follows it.
 */
import { useState } from "react";
import {
  type Aim,
  advanceTour,
  answerTour,
  nextStep,
  readTour,
  TOUR_STEPS,
  tourLabel,
  tourMode,
} from "../../logic";
import { browserStore } from "../browser-store";
import { useApp } from "../context";
import { Icon } from "../icons";
import { Button } from "../kit";
import type { Builder } from "./useBuilder";

/** Take the person where an aim points: to a place, with something in hand or picked; or do the act. */
export function follow(b: Builder, aim: Aim, onScenarios: () => void): void {
  if (aim.kind === "run") {
    if (!b.state.preview) b.runPreview();
    return;
  }
  if (aim.kind === "scenarios") {
    onScenarios();
    return;
  }
  b.go(aim.level);
  // `go` clears the pick and the tool, so what the aim hands over is set after it.
  setTimeout(() => {
    if (aim.select) b.setSelected(aim.select);
    if (aim.tool) b.setTool(aim.tool);
  }, 0);
}

function AskTour({ onAnswer }: { readonly onAnswer: (yes: boolean) => void }) {
  return (
    <section className="tour-ask" aria-label="둘러보기">
      <div>
        <b>둘러보기 할까요?</b>
        <p className="small muted">사업장에서 돌려 보기까지 다섯 걸음을 하나씩 알려 드려요.</p>
      </div>
      <div className="row">
        <Button size="small" onClick={() => onAnswer(true)}>
          둘러보기 시작
        </Button>
        <Button size="small" kind="quiet" onClick={() => onAnswer(false)}>
          그냥 쓸게요
        </Button>
      </div>
    </section>
  );
}

export function NextChip({ b, worldId }: { readonly b: Builder; readonly worldId: string }) {
  const { navigate } = useApp();
  const [tour, setTour] = useState(() => readTour(browserStore()));
  const { index, ran } = b.state;
  const mode = tourMode(tour, worldId);
  const step = nextStep(index, ran);
  const touring = mode === "run" && tour.step !== undefined ? TOUR_STEPS[tour.step] : undefined;
  const label = touring && tour.step !== undefined ? tourLabel(tour.step) : step.label;
  const press = () => {
    const toScenarios = () => navigate({ name: "scenarios", worldId });
    if (touring) {
      follow(b, touring.aim(index), toScenarios);
      setTour(advanceTour(browserStore(), tour));
    } else follow(b, step.aim, toScenarios);
  };
  return (
    <>
      {mode === "ask" && (
        <AskTour onAnswer={(yes) => setTour(answerTour(browserStore(), worldId, yes))} />
      )}
      <button
        type="button"
        className="next-chip"
        data-step={touring ? "tour" : step.id}
        onClick={press}
      >
        <span>{label}</span>
        <Icon name="forward" size={16} />
      </button>
    </>
  );
}
