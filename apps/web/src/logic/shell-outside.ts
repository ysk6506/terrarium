/**
 * "흉내 밖 명령" (ADR-0117 decision 6): how often the agent asked the fake shell for something it could not do, in the
 * words of a result. The list tells where the fake should grow next; it never touches the score. Pure text from the
 * result, so a test can read it.
 */
import type { ShellOutside } from "@terrarium/core/session";
import type { Figure } from "./recovery";

/** How many distinct items the one-line summary names before it says "외". */
const NAMED = 4;

/** `흉내 밖 명령 3번 (kubectl 2번, awk getline)`; `흉내 밖 명령 0번` when the shell did everything it was asked. */
export function outsideLine(outside: ShellOutside | undefined): string | undefined {
  if (!outside) return undefined;
  if (outside.count === 0) return "흉내 밖 명령 0번";
  const named = outside.items.slice(0, NAMED).map((i) => (i.n > 1 ? `${i.what} ${i.n}번` : i.what));
  const more = outside.items.length > NAMED ? ` 외 ${outside.items.length - NAMED}가지` : "";
  return `흉내 밖 명령 ${outside.count}번 (${named.join(", ")}${more})`;
}

/** The figures of the block on the result page. */
export function outsideFigures(outside: ShellOutside | undefined): readonly Figure[] {
  if (!outside) return [];
  return [
    {
      label: "흉내 밖 명령",
      value: `${outside.count}번`,
      hint:
        outside.count === 0
          ? `명령 ${outside.commands}번을 모두 흉내 안에서 처리했어요`
          : `명령 ${outside.commands}번 중 흉내가 못 한 것이에요. 점수에는 섞이지 않아요`,
    },
  ];
}
