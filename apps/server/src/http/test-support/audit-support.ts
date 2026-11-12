/** What the tests of the audit log share: reading the entries a call wrote, and a server whose log can be made to fail. */
import {
  type AuditEntry,
  type AuditFilter,
  type AuditPage,
  type AuditStore,
  MemoryAuditStore,
  type NewAuditEntry,
} from "@terrarium/core/experiments";
import type { AuditedApp } from "./audited-app";
import type { Person } from "./scoped-app";

/** Every entry written, oldest first. */
export async function allEntries(audit: AuditStore): Promise<AuditEntry[]> {
  const page = await audit.query({ limit: 100_000 });
  return [...page.entries].reverse();
}

/** The entries written after `seq`, oldest first. */
export async function since(audit: AuditStore, seq: number): Promise<AuditEntry[]> {
  return (await allEntries(audit)).filter((e) => e.seq > seq);
}

export async function lastSeq(audit: AuditStore): Promise<number> {
  return (await allEntries(audit)).at(-1)?.seq ?? 0;
}

/** Run one call and return its answer with the entries it wrote. */
export async function traced(
  s: AuditedApp,
  who: Person,
  method: string,
  url: string,
  payload?: object,
) {
  const mark = await lastSeq(s.audit);
  const res = await s.send(who, method, url, payload);
  return { res, entries: await since(s.audit, mark) };
}

/** A store that works until told not to; reads still work, as a log that cannot be written but can be read would. */
export class FlakyAuditStore implements AuditStore {
  readonly inner = new MemoryAuditStore();
  failing = false;
  /** Only the write fails: the check ahead of a change passes, as when the disk fills up between the two. */
  appendFailing = false;

  append(at: string, entry: NewAuditEntry): Promise<AuditEntry> {
    if (this.failing || this.appendFailing)
      return Promise.reject(new Error("disk full: secret-path-in-error"));
    return this.inner.append(at, entry);
  }

  async ready(): Promise<void> {
    if (this.failing) throw new Error("read-only file");
  }

  query(filter: AuditFilter): Promise<AuditPage> {
    return this.inner.query(filter);
  }

  sweep(cutoff: string): Promise<number> {
    return this.inner.sweep(cutoff);
  }
}
