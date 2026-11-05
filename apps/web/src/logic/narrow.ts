/**
 * A pick list that is too long to scroll (every server of a campus, tens of thousands) shows a search box and
 * only the first few matches, so the page stays light and a person finds the thing by typing part of its name
 * (REQ-034, REQ-041).
 */
export interface Narrowable {
  readonly value: string;
  readonly label: string;
  readonly group?: string | undefined;
}

/** Above this many choices the list gets a search box. */
export const NARROW_ABOVE = 120;
/** The most choices shown at once. */
export const NARROW_LIMIT = 100;

export interface Narrowed<T> {
  /** What to draw: the matches (the first few), with the chosen one kept in front so it never disappears. */
  readonly shown: readonly T[];
  /** How many choices match the search. */
  readonly matching: number;
  readonly total: number;
}

const words = (text: string): string[] => text.toLowerCase().split(/\s+/).filter(Boolean);

/** Every word of the search must appear in the choice's name or its group, in any order ("17라인 3층 서버"). */
export function narrowOptions<T extends Narrowable>(
  options: readonly T[],
  query: string,
  selected?: string,
): Narrowed<T> {
  const needles = words(query);
  const matches =
    needles.length === 0
      ? options
      : options.filter((o) => {
          const hay = `${o.group ?? ""} ${o.label}`.toLowerCase();
          return needles.every((n) => hay.includes(n));
        });
  const shown = matches.slice(0, NARROW_LIMIT);
  const chosen = selected ? options.find((o) => o.value === selected) : undefined;
  return {
    shown: chosen && !shown.includes(chosen) ? [chosen, ...shown] : shown,
    matching: matches.length,
    total: options.length,
  };
}

/** What to tell the person under the list when it is cut short; nothing when everything is shown. */
export function narrowNote(n: Narrowed<unknown>, searching: boolean): string | undefined {
  if (n.matching === 0) return `찾는 이름이 없어요. 총 ${n.total}개 가운데 맞는 것이 없어요.`;
  if (n.matching <= NARROW_LIMIT) return searching ? `${n.matching}개를 찾았어요.` : undefined;
  return searching
    ? `${n.matching}개 가운데 ${NARROW_LIMIT}개만 보여요. 이름을 더 적어 좁혀 보세요.`
    : `${n.total}개 가운데 ${NARROW_LIMIT}개만 보여요. 이름을 적어 찾아보세요.`;
}
