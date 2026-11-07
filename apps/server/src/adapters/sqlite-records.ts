/** A table of JSON records keyed by id and ordered by creation time: put, get, list, delete (service cards, REQ-104). */
import type { StatementSync } from "node:sqlite";

interface Row {
  record: string;
}

export class RecordTable<T extends { readonly id: string; readonly createdAt: string }> {
  constructor(
    private readonly sql: (text: string) => StatementSync,
    private readonly table: string,
  ) {}

  put(item: T): void {
    this.sql(`INSERT OR REPLACE INTO ${this.table} (id, created_at, record) VALUES (?, ?, ?)`).run(
      item.id,
      item.createdAt,
      JSON.stringify(item),
    );
  }

  get(id: string): T | undefined {
    const row = this.sql(`SELECT record FROM ${this.table} WHERE id = ?`).get(id) as
      | Row
      | undefined;
    return row && (JSON.parse(row.record) as T);
  }

  list(): T[] {
    const rows = this.sql(
      `SELECT record FROM ${this.table} ORDER BY created_at, id`,
    ).all() as unknown as Row[];
    return rows.map((r) => JSON.parse(r.record) as T);
  }

  delete(id: string): boolean {
    return Number(this.sql(`DELETE FROM ${this.table} WHERE id = ?`).run(id).changes) > 0;
  }
}
