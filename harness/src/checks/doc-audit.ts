/**
 * Documents that were re-verified without their body changing are read again by another eye (ADR-0180).
 * `reverify` counts those in `unchanged_reverifies` (and remembers the body in `verified_body`); `audit` records
 * `last_audited` and clears the count; `audit-queue` lists docs with a non-zero count, longest unaudited first.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { joinFrontMatter, splitFrontMatter, today } from "../common";
import { bodyFingerprint } from "./doc-print";

/** Called by `reverify`: remember the body and count a verification that left it unchanged. */
export function noteVerification(data: Record<string, unknown>, body: string): void {
  const hash = bodyFingerprint(body);
  const unchanged = data.verified_body === hash;
  data.verified_body = hash;
  const before = typeof data.unchanged_reverifies === "number" ? data.unchanged_reverifies : 0;
  data.unchanged_reverifies = unchanged ? before + 1 : before;
}

export interface AuditEntry {
  readonly file: string;
  readonly lastAudited: string;
  readonly lastVerified: string;
  readonly unchanged: number;
}

/** `docs` are the non-ADR docs (repo-relative). */
export function auditQueue(root: string, docs: readonly string[]): AuditEntry[] {
  return docs
    .flatMap((file) => {
      const { data } = splitFrontMatter(readFileSync(path.join(root, file), "utf8"));
      const unchanged = Number(data?.unchanged_reverifies ?? 0);
      if (data === null || !(unchanged > 0)) return [];
      return [
        {
          file,
          lastAudited: typeof data.last_audited === "string" ? data.last_audited : "",
          lastVerified: String(data.last_verified ?? ""),
          unchanged,
        },
      ];
    })
    .sort(
      (a, b) =>
        a.lastAudited.localeCompare(b.lastAudited) ||
        a.lastVerified.localeCompare(b.lastVerified) ||
        a.file.localeCompare(b.file),
    );
}

export const formatQueue = (queue: readonly AuditEntry[]): string =>
  queue.length === 0
    ? "audit queue is empty"
    : queue
        .map(
          (e) =>
            `${e.file}  last_audited=${e.lastAudited || "never"}  last_verified=${e.lastVerified}  unchanged_reverifies=${e.unchanged}`,
        )
        .join("\n");

/** Record that another reader checked `file` against what it covers/follows. */
export function audit(root: string, file: string, note: string, now: string = today()): void {
  const full = path.join(root, file);
  const { data, body } = splitFrontMatter(readFileSync(full, "utf8"));
  if (data === null) throw new Error(`${file} has no front matter`);
  if (!note.trim()) throw new Error("--note is required: one line saying what the audit found");
  data.last_audited = now;
  data.unchanged_reverifies = 0;
  data.verified_body = bodyFingerprint(body);
  const log = Array.isArray(data.verification_log) ? data.verification_log.map(String) : [];
  data.verification_log = [...log, `${now}: 감사 — ${note.trim()}`].slice(-5);
  writeFileSync(full, joinFrontMatter(data, body), "utf8");
}
