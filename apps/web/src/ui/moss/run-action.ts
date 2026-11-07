/**
 * 이끼가 동작 하나를 하는 방법 (REQ-103, ADR-0124): 등록된 핸들러를 부르거나 화면을 옮긴다. DOM을 누르지 않고 좌표도 쓰지 않는다.
 * 하는 동안 대상이 되는 요소(`data-moss-action`)에 1초 동안 이끼 초록 테두리를 둘러 보여 줘요.
 */
import type { Page } from "../../logic";
import {
  type ActionArgs,
  type ActionSpec,
  findHandler,
  summaryFor,
  waitForHandler,
} from "../../moss";

export const HIGHLIGHT_MS = 1000;

/** 대상 요소를 1초 동안 눈에 띄게. 없으면 아무 일도 없어요. */
export function highlight(actionId: string): void {
  const el = document.querySelector<HTMLElement>(`[data-moss-action="${actionId}"]`);
  if (!el) return;
  el.classList.add("moss-hl");
  setTimeout(() => el.classList.remove("moss-hl"), HIGHLIGHT_MS);
}

export interface Doing {
  readonly navigate: (page: Page) => void;
}

/** 동작을 한다. 핸들러가 글을 돌려주면(읽기, 고른 것의 이름) 그 글을 돌려줘요. */
export async function perform(
  spec: ActionSpec,
  args: ActionArgs,
  doing: Doing,
): Promise<string | undefined> {
  if (spec.go) {
    highlight(spec.id);
    doing.navigate(typeof spec.go === "function" ? spec.go(args) : spec.go);
    return undefined;
  }
  const handler = findHandler(spec.id) ?? (await waitForHandler(spec.id));
  if (!handler) throw new Error("이 화면에서는 아직 할 수 없어요");
  highlight(spec.id);
  const out = await handler(args);
  return typeof out === "string" ? out : undefined;
}

/** "이렇게 할게요" 카드의 한 줄: 등록부의 문장에 화면이 알려 준 지금 상태를 끼워 넣어요. */
export function confirmText(spec: ActionSpec): string {
  const summary = summaryFor(spec.id) ?? "";
  return (spec.confirm ?? `${spec.label}을(를) 할게요.`).replace("{요약}", summary).trim();
}
