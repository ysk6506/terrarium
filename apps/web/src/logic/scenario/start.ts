/**
 * Where a new scenario starts (REQ-071, ADR-0070): template cards in groups, a first usable card chosen for
 * you, an empty canvas as the last and quietest choice, and arrow keys that skip the cards that cannot be used.
 */
import type { ScenarioTemplate } from "@terrarium/core/scenario";
import type { BlueprintIndex } from "@terrarium/core/world";

export const EMPTY_START = "empty";

/** Below this width the canvas is not drawn: dragging blocks needs room (REQ-071). */
export const EDITOR_MIN_WIDTH = 900;

export interface StartCard {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly difficulty?: string;
  /** Why this one cannot be used in this world; the card shows it in place of the summary. */
  readonly unavailable?: string;
}

export interface StartGroup {
  readonly id: string;
  readonly label: string;
  readonly cards: readonly StartCard[];
}

interface TemplateGroup {
  readonly id: string;
  readonly label: string;
  readonly templates: readonly ScenarioTemplate[];
}

/** The groups of cards, then the empty canvas as a group of its own at the end. */
export function startGroups(
  groups: readonly TemplateGroup[],
  index: BlueprintIndex | undefined,
): StartGroup[] {
  const cards = groups.map((g) => ({
    id: g.id,
    label: g.label,
    cards: g.templates.map((t): StartCard => {
      const why = index ? t.unavailable(index) : undefined;
      return {
        id: t.id,
        name: t.name,
        summary: t.summary,
        difficulty: t.difficulty,
        ...(why ? { unavailable: why } : {}),
      };
    }),
  }));
  const empty: StartCard = {
    id: EMPTY_START,
    name: "빈 캔버스에서 시작",
    summary: "시작 블록만 있는 빈 시나리오에서 직접 만들어요.",
  };
  return [...cards, { id: EMPTY_START, label: "", cards: [empty] }];
}

const usable = (groups: readonly StartGroup[]): StartCard[] =>
  groups.flatMap((g) => g.cards).filter((c) => !c.unavailable);

/** What is chosen: the person's pick while it can still be used, else the first usable card, else the empty canvas. */
export function chosenStart(groups: readonly StartGroup[], picked: string | undefined): string {
  const cards = usable(groups);
  if (picked && cards.some((c) => c.id === picked)) return picked;
  return cards[0]?.id ?? EMPTY_START;
}

/** The next usable card in the given direction, wrapping around: what an arrow key moves to. */
export function stepStart(groups: readonly StartGroup[], current: string, step: 1 | -1): string {
  const cards = usable(groups);
  if (cards.length === 0) return current;
  const at = cards.findIndex((c) => c.id === current);
  const next = (at + step + cards.length) % cards.length;
  return cards[next]?.id ?? current;
}
