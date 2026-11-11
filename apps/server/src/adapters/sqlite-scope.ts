/**
 * Who can see a stored record, in SQL (ADR-0174). Worlds, scenarios and experiments keep their owner, scope and group in
 * columns beside the JSON record, so a list asks the database for what a person may see instead of loading everything and
 * filtering after. The rule is `seen` of core, written once more as a WHERE clause; a test compares the two row by row.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Scope, Sight } from "@terrarium/core/experiments";

type Row = Record<string, unknown>;

/** Version 3 (permissions step 나) gave worlds, scenarios and experiments an owner, scope and group column. */
const SCOPED_TABLES = ["worlds", "scenarios", "experiments"] as const;

/**
 * A file of version 2 or older: add the columns, and fill the owner from the record. A record stored before scopes has no
 * scope (NULL), which reads as `everyone`: it was visible to every signed-in person, and changing that silently would
 * break running setups.
 */
export function addScopeColumns(db: DatabaseSync): void {
  for (const table of SCOPED_TABLES) {
    const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((c) =>
      String(c.name),
    );
    if (columns.length === 0) continue; // a new file: the schema makes the table with its columns
    if (!columns.includes("scope")) db.exec(`ALTER TABLE ${table} ADD COLUMN scope TEXT`);
    if (!columns.includes("grp")) db.exec(`ALTER TABLE ${table} ADD COLUMN grp TEXT`);
    if (!columns.includes("owner")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN owner TEXT`);
      db.exec(`UPDATE ${table} SET owner = json_extract(record, '$.owner')`);
    }
  }
}

/** The values the scope columns hold for a record: NULL for a record that has no scope. */
export function scopeColumns(record: {
  readonly scope?: Scope;
  readonly group?: string;
}): [string | null, string | null] {
  return [record.scope ?? null, record.group ?? null];
}

/** The WHERE condition (and its values) for what a person may see; nothing to add for an admin or when nobody asks. */
export function visibleSql(
  sight: Sight | undefined,
): { sql: string; params: string[] } | undefined {
  if (sight === undefined || sight.admin) return undefined;
  const groups = [...sight.groups];
  const inGroups =
    groups.length > 0
      ? ` OR (scope = 'group' AND grp IN (${groups.map(() => "?").join(", ")}))`
      : "";
  return {
    sql: `(COALESCE(scope, 'everyone') = 'everyone' OR (owner IS NOT NULL AND owner = ?)${inGroups})`,
    params: [sight.id, ...groups],
  };
}
