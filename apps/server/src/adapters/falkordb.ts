/**
 * The knowledge graph as a reality source (REQ-010, REQ-011, ADR-0009). Every query comes from
 * READ_QUERIES (already checked as read-only) and runs through GRAPH.RO_QUERY, which the database
 * itself refuses to let write. Terrarium has no way to change the graph.
 */
import {
  assertReadOnly,
  type CypherQuery,
  type Page,
  READ_QUERIES,
  type RealitySource,
  type SourceNode,
  type SourceRelationship,
  type SourceSummary,
} from "@terrarium/core/sources/realimport";
import { FalkorDB } from "falkordb";
import type { FalkorSourceConfig } from "./config";

type Row = Record<string, unknown>;

/** The one thing this adapter needs from a graph database: read-only queries. */
export interface ReadOnlyGraph {
  roQuery(query: CypherQuery): Promise<readonly Row[]>;
}

const counts = (rows: readonly Row[], key: string) =>
  Object.fromEntries(rows.map((r) => [String(r[key]), Number(r.count)]));

export class GraphSource implements RealitySource {
  constructor(
    readonly name: string,
    private readonly graph: ReadOnlyGraph,
  ) {}

  private run(query: CypherQuery): Promise<readonly Row[]> {
    assertReadOnly(query.text);
    return this.graph.roQuery(query);
  }

  async summary(): Promise<SourceSummary> {
    const [labels, types] = await Promise.all([
      this.run(READ_QUERIES.labels()),
      this.run(READ_QUERIES.relationshipTypes()),
    ]);
    return { labels: counts(labels, "label"), relationships: counts(types, "type") };
  }

  async nodes(label: string, page: Page): Promise<readonly SourceNode[]> {
    const rows = await this.run(READ_QUERIES.nodes(label, page.offset, page.limit));
    return rows.map((r) => ({
      id: String(r.id),
      labels: (r.labels as string[] | undefined) ?? [label],
      props: (r.props as Record<string, unknown> | undefined) ?? {},
    }));
  }

  async relationships(type: string, page: Page): Promise<readonly SourceRelationship[]> {
    const rows = await this.run(READ_QUERIES.relationships(type, page.offset, page.limit));
    return rows.map((r) => ({
      type,
      from: String(r.from),
      to: String(r.to),
      props: (r.props as Record<string, unknown> | undefined) ?? {},
    }));
  }
}

/** The part of the FalkorDB client this adapter uses (so tests can stand in for the database). */
export interface FalkorClient {
  selectGraph(name: string): {
    roQuery<T>(
      query: string,
      options: { params: CypherQuery["params"]; TIMEOUT: number },
    ): Promise<{ data?: T[] }>;
  };
  close(): Promise<void>;
}

export type FalkorConnect = (
  options: Parameters<typeof FalkorDB.connect>[0],
) => Promise<FalkorClient>;

/** A FalkorDB graph, connected lazily on first use and reused afterwards. */
export class FalkorGraph implements ReadOnlyGraph {
  private client: Promise<FalkorClient> | undefined;

  constructor(
    private readonly config: FalkorSourceConfig,
    private readonly credentials: { readonly username?: string; readonly password?: string },
    private readonly connectTo: FalkorConnect = (o) => FalkorDB.connect(o),
  ) {}

  private connect(): Promise<FalkorClient> {
    this.client ??= this.connectTo({
      url: this.config.url.replace(/^redis/, "falkor"),
      ...(this.credentials.username ? { username: this.credentials.username } : {}),
      ...(this.credentials.password ? { password: this.credentials.password } : {}),
    }).catch((err: unknown) => {
      this.client = undefined;
      throw err;
    });
    return this.client;
  }

  async roQuery(query: CypherQuery): Promise<readonly Row[]> {
    const db = await this.connect();
    const reply = await db
      .selectGraph(this.config.graph)
      .roQuery<Row>(query.text, { params: query.params, TIMEOUT: 30_000 });
    return reply.data ?? [];
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (client) await (await client).close();
  }
}

export function falkorSource(
  config: FalkorSourceConfig,
  credentials: { username?: string; password?: string },
) {
  const graph = new FalkorGraph(config, credentials);
  const host = config.url.replace(/^[a-z]+:\/\/(?:[^@]*@)?/, "");
  return { source: new GraphSource(`falkordb://${host}/${config.graph}`, graph), graph };
}
