import type { DatabaseSync } from "node:sqlite";
import type { RunRecord } from "@terrarium/core/experiments";

type Row = Record<string, unknown>;

/** Version 2 (ADR-0158) gave runs a repeat number; the runs of a version-1 file are the first run of their seed. */
export function addRepeatColumn(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(runs)").all() as Row[];
  if (!columns.some((c) => c.name === "repeat_no"))
    db.exec("ALTER TABLE runs ADD COLUMN repeat_no INTEGER NOT NULL DEFAULT 1");
}

/** A run as stored: the record, with its repeat number from the column (a run saved before repeats existed is the first). */
export const runOf = (row: Row): RunRecord => ({
  ...(JSON.parse(String(row.record)) as RunRecord),
  repeat: Number(row.repeat_no ?? 1),
});
