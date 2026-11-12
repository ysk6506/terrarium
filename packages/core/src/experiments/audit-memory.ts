/** The audit log in memory, for tests and for running without a database. Entries are copied in and out. */
import {
  type AuditEntry,
  type AuditFilter,
  type AuditPage,
  type AuditStore,
  auditMatches,
  type NewAuditEntry,
  pageOf,
} from "./audit";

export class MemoryAuditStore implements AuditStore {
  private readonly entries: AuditEntry[] = [];
  private next = 1;

  async append(at: string, entry: NewAuditEntry): Promise<AuditEntry> {
    const stored: AuditEntry = structuredClone({ ...entry, seq: this.next++, at });
    this.entries.push(stored);
    return structuredClone(stored);
  }

  async ready(): Promise<void> {}

  async query(filter: AuditFilter): Promise<AuditPage> {
    const matches: AuditEntry[] = [];
    // newest first; one more than the page asks for says whether another page follows
    for (let i = this.entries.length - 1; i >= 0 && matches.length <= filter.limit; i--) {
      const e = this.entries[i] as AuditEntry;
      if (auditMatches(e, filter)) matches.push(structuredClone(e));
    }
    return pageOf(matches, filter.limit);
  }

  async sweep(cutoff: string): Promise<number> {
    const kept = this.entries.filter((e) => e.at >= cutoff);
    const removed = this.entries.length - kept.length;
    this.entries.splice(0, this.entries.length, ...kept);
    return removed;
  }
}
