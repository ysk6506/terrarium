/**
 * The audit log's counters in the Prometheus text format, with the same naming as the cluster's (`terrarium_…`, ADR-0032).
 * The labels are an action and an outcome, both from closed lists, so a label can never carry anything a person typed.
 */
import type { AuditCounts } from "./audit";

export function auditMetricsText(counts: AuditCounts): string {
  const lines = [
    "# HELP terrarium_audit_entries_total Audit entries written, by action and outcome.",
    "# TYPE terrarium_audit_entries_total counter",
  ];
  for (const [key, n] of [...counts.entries].sort(([a], [b]) => a.localeCompare(b))) {
    const [action, outcome] = key.split("|");
    lines.push(`terrarium_audit_entries_total{action="${action}",outcome="${outcome}"} ${n}`);
  }
  lines.push(
    "# HELP terrarium_audit_suppressed_total Failures before sign-in that got no line of their own, by reason.",
    "# TYPE terrarium_audit_suppressed_total counter",
  );
  for (const [reason, n] of [...counts.suppressed].sort(([a], [b]) => a.localeCompare(b)))
    lines.push(`terrarium_audit_suppressed_total{reason="${reason}"} ${n}`);
  lines.push(
    "# HELP terrarium_audit_write_failures_total Audit entries that could not be written.",
    "# TYPE terrarium_audit_write_failures_total counter",
    `terrarium_audit_write_failures_total ${counts.failures}`,
  );
  return `${lines.join("\n")}\n`;
}
