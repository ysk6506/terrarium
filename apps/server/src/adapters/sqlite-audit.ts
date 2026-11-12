/**
 * The audit log on SQLite (ADR-0193): one table in the same file, written only through `append` and cleared only by
 * `sweep`. The columns beside the JSON entry are what a listing filters and sorts on; the entry is stored as it was written.
 */
import type { StatementSync } from "node:sqlite";
import type {
  AuditEntry,
  AuditFilter,
  AuditPage,
  AuditStore,
  NewAuditEntry,
} from "@terrarium/core/experiments";
import { pageOf } from "@terrarium/core/experiments";

type Row = Record<string, unknown>;

/** Version 4 (permissions step 다) added the table. A file of an older version gets it when the schema runs; nothing else changes. */
export const AUDIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, request_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL,
  resource_kind TEXT NOT NULL, resource_id TEXT, owner TEXT, record TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_by_time ON audit_log (at);
CREATE INDEX IF NOT EXISTS audit_by_subject ON audit_log (subject_id, at);
CREATE INDEX IF NOT EXISTS audit_by_resource ON audit_log (resource_kind, resource_id, at);
CREATE INDEX IF NOT EXISTS audit_by_owner ON audit_log (owner, at);
`;

/** The WHERE clause of a filter: the same rule as `auditMatches`, written for the columns. */
function whereOf(f: AuditFilter): { readonly sql: string; readonly params: (string | number)[] } {
  const terms: string[] = [];
  const params: (string | number)[] = [];
  const add = (sql: string, value: string | number | undefined) => {
    if (value === undefined) return;
    terms.push(sql);
    params.push(value);
  };
  add("at >= ?", f.from);
  add("at < ?", f.to);
  add("subject_id = ?", f.subject);
  add("action = ?", f.action);
  add("resource_kind = ?", f.resourceKind);
  add("resource_id = ?", f.resourceId);
  add("outcome = ?", f.outcome);
  add("owner = ?", f.owner);
  add("seq < ?", f.before);
  return { sql: terms.length > 0 ? ` WHERE ${terms.join(" AND ")}` : "", params };
}

export class AuditTables implements AuditStore {
  constructor(
    private readonly sql: (text: string) => StatementSync,
    private readonly exec: (text: string) => void,
  ) {}

  async append(at: string, entry: NewAuditEntry): Promise<AuditEntry> {
    const result = this.sql(
      "INSERT INTO audit_log (at, request_id, subject_kind, subject_id, action, outcome, resource_kind, resource_id, owner, record) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      at,
      entry.requestId,
      entry.subject.kind,
      entry.subject.id,
      entry.action,
      entry.outcome,
      entry.resource.kind,
      entry.resource.id ?? null,
      entry.resource.owner ?? null,
      JSON.stringify({ ...entry, at }),
    );
    return { ...entry, at, seq: Number(result.lastInsertRowid) };
  }

  /** Taking the write lock and giving it back fails the way a write would: a file that is read-only, locked or gone. */
  async ready(): Promise<void> {
    this.exec("BEGIN IMMEDIATE");
    this.exec("ROLLBACK");
  }

  async query(filter: AuditFilter): Promise<AuditPage> {
    const where = whereOf(filter);
    const rows = this.sql(
      `SELECT seq, record FROM audit_log${where.sql} ORDER BY seq DESC LIMIT ${filter.limit + 1}`,
    ).all(...where.params) as Row[];
    const entries = rows.map(
      (r) => ({ ...(JSON.parse(String(r.record)) as object), seq: Number(r.seq) }) as AuditEntry,
    );
    return pageOf(entries, filter.limit);
  }

  async sweep(cutoff: string): Promise<number> {
    return Number(this.sql("DELETE FROM audit_log WHERE at < ?").run(cutoff).changes);
  }
}
