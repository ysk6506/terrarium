/** The structure card's lists stay short (REQ-102): the first few items, then "외 n가지" for the rest. */
export const CARD_LIST_MAX = 3;

/** A " · " list cut to `max` items; what is left over becomes "외 n가지". */
export function capList(list: string, max = CARD_LIST_MAX): string {
  const items = list.split(" · ");
  if (items.length <= max) return list;
  return `${items.slice(0, max).join(" · ")} · 외 ${items.length - max}가지`;
}
