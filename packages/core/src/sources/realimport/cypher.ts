/**
 * Read-only Cypher for graph adapters (REQ-011, ADR-0009). Adapters build every query here and run it
 * through the database's read-only API (FalkorDB GRAPH.RO_QUERY); `assertReadOnly` is a second lock in
 * case a query is ever written by hand. Labels and types are checked as identifiers, values travel as
 * parameters, so nothing from the graph or a user becomes query text.
 */
import { InvalidValueError, ReadOnlyViolationError } from "@terrarium/core/kernel";

const WRITE_CLAUSES = [
  "CREATE",
  "MERGE",
  "SET",
  "DELETE",
  "DETACH",
  "REMOVE",
  "DROP",
  "LOAD CSV",
  "FOREACH",
];
const WRITE_PROCEDURES = /\bCALL\s+(db\.idx\.|db\.create|db\.drop|algo\.\w+\.write)/i;

/** The query with string literals, backtick names and comments blanked out, so their content cannot trip the check. */
function code(query: string): string {
  return query
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`[^`]*`/g, "''");
}

/** Throws unless the query only reads. */
export function assertReadOnly(query: string): void {
  const text = code(query).toUpperCase();
  for (const clause of WRITE_CLAUSES) {
    const pattern = new RegExp(`(^|[^A-Z0-9_.])${clause.replace(" ", "\\s+")}([^A-Z0-9_]|$)`);
    if (pattern.test(text))
      throw new ReadOnlyViolationError(
        `Terrarium only reads reality; refused a query containing ${clause}`,
      );
  }
  if (WRITE_PROCEDURES.test(text))
    throw new ReadOnlyViolationError(
      "Terrarium only reads reality; refused a writing procedure call",
    );
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function identifier(name: string): string {
  if (!IDENTIFIER.test(name))
    throw new InvalidValueError(`'${name}' is not a plain label or relationship type`);
  return name;
}

export interface CypherQuery {
  readonly text: string;
  readonly params: Readonly<Record<string, number | string>>;
}

const checked = (q: CypherQuery): CypherQuery => {
  assertReadOnly(q.text);
  return q;
};

export const READ_QUERIES = {
  labels: (): CypherQuery =>
    checked({
      text: "MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS count",
      params: {},
    }),
  relationshipTypes: (): CypherQuery =>
    checked({ text: "MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS count", params: {} }),
  nodes: (label: string, offset: number, limit: number): CypherQuery =>
    checked({
      text: `MATCH (n:${identifier(label)}) RETURN ID(n) AS id, labels(n) AS labels, properties(n) AS props ORDER BY ID(n) SKIP $offset LIMIT $limit`,
      params: { offset, limit },
    }),
  relationships: (type: string, offset: number, limit: number): CypherQuery =>
    checked({
      text: `MATCH (a)-[r:${identifier(type)}]->(b) RETURN ID(a) AS from, ID(b) AS to, properties(r) AS props ORDER BY ID(r) SKIP $offset LIMIT $limit`,
      params: { offset, limit },
    }),
};
