/**
 * The short way from the entrance to a running experiment (REQ-104, ADR-0127): three questions and "실험 시작". The
 * moves are pure so a test can press them and count: the entrance door, 다음 on ①, 다음 on ②, then 실험 시작 on ③,
 * which builds the world and starts the experiment in one press. A service added besides the first one adds a pass
 * through ② (its own ladders or "같은 모양"), one press each.
 */
import { costText, type ShapeView } from "./shape-view";

export type Step = "services" | "ladders" | "size";
export const STEPS: readonly Step[] = ["services", "ladders", "size"];

/** The recommended experiment the world card promises, in the numbers the server uses (`experiments-quick.ts`). */
export const QUICK = { runs: 5, hours: 1 } as const;

export interface Place {
  readonly step: Step;
  /** Which service's ladders ② shows. */
  readonly ladder: number;
}

export const START: Place = { step: "services", ladder: 0 };

/** The place after 다음, or "make" when there is none (③: build and start). */
export function advance(at: Place, services: number): Place | "make" {
  if (at.step === "services") return { step: "ladders", ladder: 0 };
  if (at.step === "ladders")
    return at.ladder < services - 1
      ? { step: "ladders", ladder: at.ladder + 1 }
      : { step: "size", ladder: at.ladder };
  return "make";
}

/** The place after 이전, or "leave" when there is none. */
export function retreat(at: Place, services: number): Place | "leave" {
  if (at.step === "size") return { step: "ladders", ladder: Math.max(0, services - 1) };
  if (at.step === "ladders")
    return at.ladder > 0
      ? { step: "ladders", ladder: at.ladder - 1 }
      : { step: "services", ladder: 0 };
  return "leave";
}

/** Presses from the entrance to a started experiment: the door, every 다음, and 실험 시작. */
export function pressesToExperiment(services: number): number {
  let presses = 1; // the door on the entrance
  let at: Place = START;
  for (let guard = 0; guard < 100; guard += 1) {
    presses += 1; // 다음, or 실험 시작 on the last screen
    const next = advance(at, services);
    if (next === "make") return presses;
    at = next;
  }
  throw new Error("the flow does not end");
}

/** "IAP 실험용 · 호스트 3 · VM 9 · 스위치 2 · 5.3억 원" */
export const builtFact = (name: string, view: ShapeView): string =>
  `${name} · 호스트 ${view.hosts} · VM ${view.vms} · 스위치 ${view.switches} · ${costText(view.costM)}`;

/** "이 세계에 맞는 시나리오 23개 · 기본 툴 묶음 · 5번 · 한 번에 약 1시간" */
export const recommendLine = (scenarios: number): string =>
  `이 세계에 맞는 시나리오 ${scenarios}개 · 기본 툴 묶음 · ${QUICK.runs}번 · 한 번에 약 ${QUICK.hours}시간`;
