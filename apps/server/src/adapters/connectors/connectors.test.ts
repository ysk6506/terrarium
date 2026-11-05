import { describe, expect, test } from "vitest";
import { FakeFetch, json } from "../test-support/fake-fetch";
import { CONNECTORS, connectorOf } from "./index";

/** The smallest settings that each connector accepts. */
const MINIMAL: Record<string, Record<string, unknown>> = {
  langgraph: { url: "http://h.test" },
  opencode: { url: "http://h.test" },
  openclaw: { url: "http://h.test" },
  goclaw: { url: "http://h.test" },
  hermes: { url: "http://h.test" },
  "http-template": { url: "http://h.test" },
  a2a: { url: "http://h.test" },
  "mcp-agent": { url: "http://h.test/mcp" },
  command: { command: ["agent.sh"] },
  http: { url: "http://h.test" },
  scripted: {},
};

describe("what every connector must be, so the screen and the server need not know it [REQ-051]", () => {
  test("each kind is unique and the order is: harness products, generic, own protocol, built in", () => {
    const kinds = CONNECTORS.map((c) => c.spec.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toEqual(Object.keys(MINIMAL));
    expect(connectorOf("a2a")?.spec.label).toContain("A2A");
    expect(connectorOf("gopher")).toBeUndefined();
  });

  test.each(CONNECTORS.map((c) => [c.spec.kind, c] as const))(
    "%s describes itself in words and its fields are a form",
    (_, c) => {
      expect(c.spec.label.length).toBeGreaterThan(2);
      expect(c.spec.description.length).toBeGreaterThan(20);
      expect(["harness", "agent"]).toContain(c.spec.scope);
      const keys = c.spec.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const f of c.spec.fields) {
        expect(f.label.length).toBeGreaterThan(0);
        if (f.type === "select") expect((f.options ?? []).length).toBeGreaterThan(1);
        if (f.type !== "select") expect(f.options).toBeUndefined();
      }
    },
  );

  test.each(CONNECTORS.map((c) => [c.spec.kind, c] as const))(
    "%s takes its minimal settings, refuses unknown ones, and builds a port that names itself",
    (kind, c) => {
      const flat = { kind, id: "x", name: "이름", ...MINIMAL[kind] };
      const parsed = c.schema.safeParse(flat);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(c.schema.safeParse({ ...flat, surprise: 1 }).success).toBe(false);
      expect(c.schema.safeParse({ ...flat, kind: "other" }).success).toBe(false);
      expect(c.schema.safeParse({ ...flat, id: "has space" }).success).toBe(false);
      const port = c.connect(parsed.data, { env: {}, fetch: new FakeFetch().fetch });
      expect(port.info).toMatchObject({
        id: "x",
        kind: c.spec.kind,
        toolTransport: c.spec.toolTransport,
      });
    },
  );

  test("every required field of the form is something the connector really cannot do without", () => {
    for (const c of CONNECTORS) {
      for (const f of c.spec.fields.filter((x) => x.required)) {
        const settings = { kind: c.spec.kind, id: "x", name: "n", ...MINIMAL[c.spec.kind] };
        delete (settings as Record<string, unknown>)[f.key];
        expect(c.schema.safeParse(settings).success, `${c.spec.kind}.${f.key}`).toBe(false);
      }
    }
  });

  test("only the ones that run programs on the server, or are built in, stay off the screen", () => {
    expect(CONNECTORS.filter((c) => !c.spec.fromScreen).map((c) => c.spec.kind)).toEqual([
      "command",
      "scripted",
    ]);
  });

  test("a harness that speaks Terrarium's own protocol lists its agents from /agents", async () => {
    const fake = new FakeFetch().on("GET", /^\/agents$/, () =>
      json({ agents: [{ id: "a", name: "에이전트" }] }),
    );
    const c = connectorOf("http");
    const port = c?.connect(
      c.schema.parse({
        kind: "http",
        id: "own",
        name: "직접 만든",
        url: "http://h.test",
        tokenEnv: "T",
      }),
      { env: { T: "t" }, fetch: fake.fetch },
    );
    expect(await port?.agents()).toEqual([{ id: "a", name: "에이전트" }]);
    expect(fake.requests[0]?.headers.authorization).toBe("Bearer t");
    expect(c?.spec.label).toContain("직접 만든");
  });

  test("the built-in agents need nothing", async () => {
    const c = connectorOf("scripted");
    const port = c?.connect(c.schema.parse({ kind: "scripted", id: "builtin" }), {
      env: {},
      fetch: new FakeFetch().fetch,
    });
    expect((await port?.agents())?.length).toBeGreaterThan(0);
    expect(c?.spec.fields).toEqual([]);
  });
});
