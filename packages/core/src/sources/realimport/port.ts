/**
 * The window onto reality (REQ-010, REQ-011, ADR-0009). It can only read: there is no method that
 * writes, so nothing built on it can change a real system. Adapters (FalkorDB on the server, a JSON
 * dump in memory) implement it; the importer only ever calls these three methods.
 */

export interface SourceNode {
  /** Stable id within the source (a graph node id). */
  readonly id: string;
  readonly labels: readonly string[];
  readonly props: Readonly<Record<string, unknown>>;
}

export interface SourceRelationship {
  readonly type: string;
  /** Source node id the relationship starts at. */
  readonly from: string;
  readonly to: string;
  readonly props: Readonly<Record<string, unknown>>;
}

export interface SourceSummary {
  /** Node count per label. */
  readonly labels: Readonly<Record<string, number>>;
  /** Relationship count per type. */
  readonly relationships: Readonly<Record<string, number>>;
}

export interface Page {
  readonly offset: number;
  readonly limit: number;
}

export interface RealitySource {
  /** For reports, e.g. "falkordb://kg.internal/cloud_topology" or "file: export.json". */
  readonly name: string;
  summary(): Promise<SourceSummary>;
  nodes(label: string, page: Page): Promise<readonly SourceNode[]>;
  relationships(type: string, page: Page): Promise<readonly SourceRelationship[]>;
}

/** A source over records held in memory: a JSON export of a graph, a test fixture. */
export class MemorySource implements RealitySource {
  constructor(
    readonly name: string,
    private readonly data: {
      readonly nodes: readonly SourceNode[];
      readonly relationships: readonly SourceRelationship[];
    },
  ) {}

  async summary(): Promise<SourceSummary> {
    const labels: Record<string, number> = {};
    for (const n of this.data.nodes) for (const l of n.labels) labels[l] = (labels[l] ?? 0) + 1;
    const relationships: Record<string, number> = {};
    for (const r of this.data.relationships)
      relationships[r.type] = (relationships[r.type] ?? 0) + 1;
    return { labels, relationships };
  }

  async nodes(label: string, page: Page): Promise<readonly SourceNode[]> {
    return this.data.nodes
      .filter((n) => n.labels.includes(label))
      .slice(page.offset, page.offset + page.limit);
  }

  async relationships(type: string, page: Page): Promise<readonly SourceRelationship[]> {
    return this.data.relationships
      .filter((r) => r.type === type)
      .slice(page.offset, page.offset + page.limit);
  }
}

/** Read every page of a listing. */
export async function readAll<T>(
  fetch: (page: Page) => Promise<readonly T[]>,
  pageSize: number,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetch({ offset, limit: pageSize });
    out.push(...page);
    if (page.length < pageSize) return out;
  }
}
