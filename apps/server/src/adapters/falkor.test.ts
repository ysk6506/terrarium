import { READ_QUERIES } from "@terrarium/core/sources/realimport";
import { describe, expect, test } from "vitest";
import { parseConfig } from "./config";
import { type FalkorClient, FalkorGraph, falkorSource } from "./falkordb";

const config = parseConfig({
  sources: [
    { kind: "falkordb", id: "kg", name: "운영 KG", url: "redis://kg.internal:6379", graph: "topo" },
  ],
}).sources[0] as NonNullable<ReturnType<typeof parseConfig>["sources"][number]>;

describe("the FalkorDB client is only asked read-only queries [REQ-010] [REQ-011]", () => {
  test("connects once, on first use, and runs RO_QUERY against the named graph", async () => {
    const seen: Array<{ graph: string; query: string; params: unknown }> = [];
    const options: unknown[] = [];
    let closed = 0;
    const client: FalkorClient = {
      selectGraph: (graph) => ({
        roQuery: async <T>(query: string, o: { params: unknown }) => {
          seen.push({ graph, query, params: o.params });
          return { data: [{ label: "Rack", count: 3 }] as T[] };
        },
      }),
      close: async () => {
        closed++;
      },
    };
    const graph = new FalkorGraph(config, { username: "ro", password: "pw" }, async (o) => {
      options.push(o);
      return client;
    });
    expect(await graph.roQuery(READ_QUERIES.labels())).toEqual([{ label: "Rack", count: 3 }]);
    await graph.roQuery(READ_QUERIES.nodes("Rack", 0, 10));
    expect(options).toEqual([{ url: "falkor://kg.internal:6379", username: "ro", password: "pw" }]);
    expect(seen.map((s) => s.graph)).toEqual(["topo", "topo"]);
    expect(seen[1]?.params).toEqual({ offset: 0, limit: 10 });
    await graph.close();
    await graph.close();
    expect(closed).toBe(1);
  });

  test("a failed connection is tried again next time, and an empty reply is no rows", async () => {
    let attempts = 0;
    const graph = new FalkorGraph(config, {}, async () => {
      attempts++;
      if (attempts === 1) throw new Error("ECONNREFUSED");
      return { selectGraph: () => ({ roQuery: async () => ({}) }), close: async () => {} };
    });
    await expect(graph.roQuery(READ_QUERIES.labels())).rejects.toThrow("ECONNREFUSED");
    expect(await graph.roQuery(READ_QUERIES.labels())).toEqual([]);
    expect(attempts).toBe(2);
  });

  test("the source names the graph without credentials", () => {
    const { source } = falkorSource(
      { ...config, url: "falkor://user:secret@kg.internal:6379" },
      {},
    );
    expect(source.name).toBe("falkordb://kg.internal:6379/topo");
  });
});
