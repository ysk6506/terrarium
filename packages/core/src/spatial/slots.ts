import type { LocationHint } from "./hints";

export interface Slot {
  readonly row: number;
  readonly column: number;
  readonly inferred: boolean;
}

type Key = `${number},${number}`;
const key = (row: number, column: number): Key => `${row},${column}`;

function candidates(
  hint: Pick<LocationHint, "row" | "column">,
  rows: readonly number[],
  width: number,
): Array<[number, number]> {
  const columns = Array.from({ length: width }, (_, i) => i + 1);
  if (hint.row !== undefined) return columns.map((c) => [hint.row as number, c]);
  if (hint.column !== undefined) return rows.map((r) => [r, hint.column as number]);
  return rows.flatMap((r) => columns.map((c) => [r, c] as [number, number]));
}

function firstFree(
  taken: ReadonlyMap<Key, string>,
  hint: Pick<LocationHint, "row" | "column">,
  width: number,
): Slot {
  const rows = [...new Set([...taken.keys()].map((k) => Number(k.split(",")[0])))].sort(
    (a, b) => a - b,
  );
  const usedRows = rows.length > 0 ? rows : [1];
  for (const [row, column] of candidates(hint, usedRows, width)) {
    if (!taken.has(key(row, column))) return { row, column, inferred: true };
  }
  if (hint.row !== undefined) {
    let column = width + 1;
    while (taken.has(key(hint.row, column))) column++;
    return { row: hint.row, column, inferred: true };
  }
  return { row: Math.max(...usedRows) + 1, column: hint.column ?? 1, inferred: true };
}

/**
 * A (row, column) slot for every rack of one room, in id order so the result never depends on input
 * order. Racks stating a free slot keep it; the rest go to the first free slot consistent with what
 * they do state, marked `inferred` so the UI can show a guess as a guess.
 */
export function assignSlots(
  racks: ReadonlyArray<readonly [string, LocationHint]>,
  racksPerRow: number,
  notes: string[],
): Map<string, Slot> {
  const ordered = [...racks].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const taken = new Map<Key, string>();
  const result = new Map<string, Slot>();
  const pending: Array<[string, Pick<LocationHint, "row" | "column">]> = [];
  for (const [id, hint] of ordered) {
    const hasSlot = hint.row !== undefined && hint.column !== undefined;
    const k = key(hint.row ?? 0, hint.column ?? 0);
    if (hasSlot && !taken.has(k)) {
      taken.set(k, id);
      result.set(id, { row: hint.row as number, column: hint.column as number, inferred: false });
      continue;
    }
    if (hasSlot)
      notes.push(
        `${id}: slot (${hint.row}, ${hint.column}) already used by ${taken.get(k)}; moved`,
      );
    pending.push([
      id,
      {
        ...(hint.row !== undefined ? { row: hint.row } : {}),
        ...(hint.column !== undefined ? { column: hint.column } : {}),
      },
    ]);
  }
  const width = Math.max(racksPerRow, ...[...taken.keys()].map((k) => Number(k.split(",")[1])));
  for (const [id, hint] of pending) {
    const slot = firstFree(taken, hint, width);
    taken.set(key(slot.row, slot.column), id);
    result.set(id, slot);
    notes.push(`${id}: no usable position, placed at row ${slot.row} col ${slot.column}`);
  }
  return result;
}
