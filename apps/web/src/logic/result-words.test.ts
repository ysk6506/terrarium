import type { ExperimentAnalysis } from "@terrarium/core/analysis";
import type { Progress } from "@terrarium/core/experiments";
import { PASS_MARK } from "@terrarium/core/oracle";
import { describe, expect, test } from "vitest";
import {
  PASS_TAIL,
  passLine,
  pendingLine,
  pointsText,
  progressLine,
  quietLine,
  scoreLine,
  stoppedLine,
} from "./result-words";

const summary = (mean: number, ci95: number, n = 5) => ({
  n,
  mean,
  median: mean,
  stdev: 0,
  min: mean,
  max: mean,
  ci95,
});

const analysis = (parts: Partial<ExperimentAnalysis>): ExperimentAnalysis =>
  parts as ExperimentAnalysis;

const progress = (p: Partial<Progress>): Progress => ({
  total: 15,
  finished: 15,
  completed: 15,
  passed: 7,
  failed: 0,
  cancelled: 0,
  running: 0,
  ...p,
});

describe("the sentences at the head of a result [REQ-037]", () => {
  test("[REQ-037] the verdict counts runs with 번 and says what went on before any run is done", () => {
    expect(passLine(15, 7)).toBe("15번 중 7번 합격했어요");
    expect(passLine(0, 0)).toBe("아직 끝난 실행이 없어요");
    expect(passLine(0, 0, 3)).toBe("실행 3번이 모두 실패했어요");
    expect(
      [passLine(15, 7), stoppedLine(progress({ total: 20, completed: 1 }))].join(""),
    ).not.toMatch(/회|횟수/);
  });

  test("[REQ-118] the average comes with the situation-level interval, and without one the 오차 part is left out", () => {
    expect(scoreLine(summary(70.5, 19.7))).toBe(`평균 70.5점, 오차 ±19.7점. ${PASS_TAIL}`);
    expect(scoreLine(summary(70.5, 0, 1))).toBe(`평균 70.5점. ${PASS_TAIL}`);
    expect(scoreLine(summary(70.5, 4, 1))).not.toContain("오차");
    expect(scoreLine(undefined)).toBe(PASS_TAIL);
    expect(PASS_TAIL).toContain(`${PASS_MARK}점 이상`);
  });

  test("[REQ-037] the quiet line has only what has a value", () => {
    expect(
      quietLine(
        analysis({
          timeToDiagnosis: summary(30, 0),
          calls: summary(1, 0),
          tokens: summary(1204, 0),
        }),
      ),
    ).toBe("진단까지 30초 · 툴 1번 사용 · 토큰 1,204");
    expect(quietLine(analysis({ calls: summary(2.46, 0) }))).toBe("툴 2.5번 사용");
    expect(quietLine(analysis({}))).toBeUndefined();
  });

  test("[REQ-037] a stopped experiment says what it planned beside what ended; one that goes says how far", () => {
    const p = progress({ total: 20, finished: 1, completed: 1 });
    expect(progressLine("cancelled", p)).toBe("20번 중 1번 끝");
    expect(progressLine("running", p)).toBe("1/20번 끝");
    expect(pendingLine(p, "running")).toBe("아직 19번이 남았어요. 끝나는 대로 이 화면이 바뀌어요.");
    expect(pendingLine(p, "cancelled")).toContain("멈춘 실험");
    expect(pendingLine(progress({}), "completed")).toBeUndefined();
  });

  test("[REQ-037] a number loses its trailing zero", () => {
    expect(pointsText(70)).toBe("70");
    expect(pointsText(19.74)).toBe("19.7");
  });
});
