/**
 * 이끼의 화면 등록부 (REQ-103, ADR-0124): 라우트마다 한 칸. 이름·한 줄 설명·처음 질문 셋·동작이 있고 화면 컴포넌트는
 * `useMossScreen`으로 읽기와 핸들러를 붙인다. 순수한 데이터라 `moss` 검사가 읽고, 칸이 없는 라우트는 MOSS001이 막는다.
 * 칸은 영역별 파일에 적는다(`registry-*.ts`, 한 파일이 500줄을 넘지 않게): 이 파일은 그것을 라우트 순서대로 모으고
 * 찾는 함수를 낸다. 검사는 이 파일들을 모두 읽는다(ADR-0141).
 */
import type { PageName } from "../logic";
import { EXPERIMENT_SCREENS } from "./registry-experiment";
import { GLOBAL_ACTIONS } from "./registry-global";
import { OTHER_SCREENS } from "./registry-other";
import { SCENARIO_SCREENS } from "./registry-scenario";
import { WORLD_SCREENS } from "./registry-world";
import type { ActionSpec, ScreenSpec } from "./types";

export { GLOBAL_ACTIONS };

export const SCREENS: Readonly<Record<PageName, ScreenSpec>> = {
  ...WORLD_SCREENS,
  ...SCENARIO_SCREENS,
  ...EXPERIMENT_SCREENS,
  ...OTHER_SCREENS,
};

export const SCREEN_LIST: readonly ScreenSpec[] = Object.values(SCREENS);

/** 한 화면에서 쓸 수 있는 동작: 그 화면 것 먼저, 그다음 어디서나 쓰는 것. */
export function actionsOf(route: PageName): readonly ActionSpec[] {
  const own = SCREENS[route].actions;
  return [...own, ...GLOBAL_ACTIONS.filter((g) => !own.some((o) => o.id === g.id))];
}

/** 어느 화면에 있든 등록된 모든 동작. */
export const ALL_ACTIONS: readonly ActionSpec[] = [
  ...GLOBAL_ACTIONS,
  ...SCREEN_LIST.flatMap((s) => s.actions),
];

/** 아이디는 등록부 전체에서 하나라서, 어느 화면 것인지 몰라도 찾아요(여러 단계 일이 화면을 넘나들 때). */
export function actionById(id: string): ActionSpec | undefined {
  return ALL_ACTIONS.find((a) => a.id === id);
}

export function findAction(route: PageName, id: string): ActionSpec | undefined {
  return actionsOf(route).find((a) => a.id === id);
}

/** 검사기가 JSON으로 읽어 가는 모양 (`harness/src/checks/moss.ts`). */
const dumped = (a: ActionSpec) => ({ id: a.id, kind: a.kind, static: Boolean(a.go || a.steps) });

export function registryDump() {
  return {
    screens: SCREEN_LIST.map((s) => ({
      route: s.route,
      title: s.title,
      oneLine: s.oneLine,
      questions: s.questions,
      actions: s.actions.map(dumped),
    })),
    global: GLOBAL_ACTIONS.map(dumped),
  };
}
