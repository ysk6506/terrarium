/**
 * 이끼의 화면 등록 계약 (REQ-103, ADR-0124): 화면마다 이름·한 줄 설명·읽기·동작을 등록한다. 동작은 버튼이 쓰는 핸들러와
 * 같은 것이다(DOM을 누르거나 좌표를 찍지 않는다). 이 파일은 모양만 있고, 정적 목록은 `registry.ts`에 있다.
 */
import type { Page, PageName } from "../logic";

/** `navigate`와 `read`는 바로 하고, `change`(세계·시나리오·실험을 바꾸거나 시작·삭제)는 "이렇게 할게요" 카드를 거친다. */
export type ActionKind = "navigate" | "read" | "change";

export type ActionArgs = Readonly<Record<string, string | number | boolean | undefined>>;

export interface ActionSpec {
  /** 화면 안에서 버튼의 `data-moss-action`과 같은 이름. */
  readonly id: string;
  /** 사람이 보는 이름이자, 짧은 글이 이 이름과 맞으면 바로 하는 말. */
  readonly label: string;
  readonly kind: ActionKind;
  /** 같은 뜻의 다른 말. 질문이 아니라 부탁("~해 줘")이 이 말을 담으면 이 동작이에요. */
  readonly aliases?: readonly string[];
  /** `change`의 카드에 쓰는 한 줄 ("이렇게 할게요" 밑). 값이 있으면 `{요약}`이 화면의 지금 상태로 바뀌어요. */
  readonly confirm?: string;
  /** `navigate`가 가는 화면. 고쳐 쓸 값이 있으면 `go`에 함수를 둔다. */
  readonly go?: Page | ((args: ActionArgs) => Page);
  /** 하는 동안 한 줄로 보여 주는 말 ("사다리로 갈게요"). */
  readonly saying?: string;
  /** 여러 단계 일: 차례대로 할 동작 id. 마지막 `change`만 카드를 거친다. */
  readonly steps?: readonly string[];
}

export interface ScreenSpec {
  readonly route: PageName;
  /** "이끼 · <화면 이름>"의 화면 이름. */
  readonly title: string;
  readonly oneLine: string;
  /** 출처 줄에서 화면 상태를 부르는 이름 ("이 실행의 사건 기록"). */
  readonly stateLabel: string;
  /** 처음 보이는 질문 칩 셋. */
  readonly questions: readonly [string, string, string];
  readonly actions: readonly ActionSpec[];
}

/** 화면이 켜져 있는 동안 화면 쪽에서 채우는 것: 지금 상태를 읽는 함수와, 동작 id마다 버튼의 핸들러. */
export interface ScreenBinding {
  /** 이 화면의 지금 상태. 동작만 더하는 안쪽 컴포넌트는 안 적어요. */
  read?(): unknown;
  readonly run: Readonly<Record<string, (args: ActionArgs) => unknown>>;
  /** `change`의 카드에 넣을 지금 상태의 한 줄 ("IAP 실험용 · 시나리오 12개 · 5번"). */
  summary?(actionId: string): string | undefined;
}
