/**
 * Arrange rectangles without overlap (rooms on a floor, buildings on a site) when no drawing exists.
 * Simple shelf packing in id order: deterministic, readable, good enough for a simulator.
 */
export interface SizedItem {
  readonly id: string;
  readonly w: number;
  readonly d: number;
}

export interface PackedItem {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
}

export function packShelves(
  items: readonly SizedItem[],
  maxWidth: number,
  gap: number,
): PackedItem[] {
  const ordered = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out: PackedItem[] = [];
  let x = gap;
  let y = gap;
  let shelfDepth = 0;
  for (const item of ordered) {
    if (x > gap && x + item.w + gap > maxWidth) {
      x = gap;
      y += shelfDepth + gap;
      shelfDepth = 0;
    }
    out.push({ id: item.id, x, y, w: item.w, d: item.d });
    x += item.w + gap;
    shelfDepth = Math.max(shelfDepth, item.d);
  }
  return out;
}
