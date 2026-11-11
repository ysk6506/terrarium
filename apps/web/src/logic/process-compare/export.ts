/** "Object · Link · Action 표로 내보내기" (REQ-112, ADR-0135): the needs and the use as one table, in CSV and in JSON. */
import { DOER_LABELS, type OntologyNeeds, type OntologyUse } from "@terrarium/core/analysis";

export type OntologyRowKind = "Object" | "Link" | "Action";

export interface OntologyRow {
  readonly type: OntologyRowKind;
  readonly id: string;
  readonly name: string;
  /** Object, Link: how many the world has. Action: how many times it was used (empty without an experiment). */
  readonly count: number | "";
  /** Action: the kinds it acts on. */
  readonly targets: string;
  /** Action: the faults it clears. */
  readonly faults: string;
  /** Action: who did it most in the chosen experiment. */
  readonly doer: string;
}

export const COLUMNS: readonly (keyof OntologyRow)[] = [
  "type",
  "id",
  "name",
  "count",
  "targets",
  "faults",
  "doer",
];

export function ontologyRows(needs: OntologyNeeds, use?: OntologyUse): OntologyRow[] {
  const used = new Map(use?.actions.map((a) => [a.id, a]));
  return [
    ...needs.objects.map(
      (o): OntologyRow => ({
        type: "Object",
        id: o.kind,
        name: o.label,
        count: o.count,
        targets: "",
        faults: "",
        doer: "",
      }),
    ),
    ...needs.links.map(
      (l): OntologyRow => ({
        type: "Link",
        id: l.kind,
        name: l.label,
        count: l.count,
        targets: "",
        faults: "",
        doer: "",
      }),
    ),
    ...needs.actions.map((a): OntologyRow => {
      const u = used.get(a.id);
      return {
        type: "Action",
        id: a.id,
        name: a.label,
        count: u ? u.total : "",
        targets: a.targets.map((t) => `${t.label} ${t.count}`).join(" · "),
        faults: a.faults.map((f) => f.label).join(" · "),
        doer: u ? DOER_LABELS[u.doer] : "",
      };
    }),
    ...(use?.actions ?? [])
      .filter((a) => !a.needed)
      .map(
        (a): OntologyRow => ({
          type: "Action",
          id: a.id,
          name: a.label,
          count: a.total,
          targets: "",
          faults: "",
          doer: DOER_LABELS[a.doer],
        }),
      ),
  ];
}

/** One CSV cell: quoted when it holds a comma, a quote or a line break, and safe to open in a spreadsheet. */
function cell(value: string | number): string {
  const text = String(value);
  // a leading = + - @ would be run as a formula by a spreadsheet
  const safe = /^[=+\-@]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** With a byte-order mark first, so a spreadsheet reads the Korean as UTF-8. */
export function toCsv(rows: readonly OntologyRow[]): string {
  const lines = [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function toJson(world: string, rows: readonly OntologyRow[]): string {
  const of = (type: OntologyRowKind) => rows.filter((r) => r.type === type);
  return `${JSON.stringify({ world, objects: of("Object"), links: of("Link"), actions: of("Action") }, null, 2)}\n`;
}

export const fileName = (world: string, ext: "csv" | "json"): string =>
  `${world.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "world"}-ontology.${ext}`;
