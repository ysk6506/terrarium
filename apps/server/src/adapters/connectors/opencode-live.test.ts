import { describe, expect, test } from "vitest";
import { FakeFetch, json } from "../test-support/fake-fetch";
import { runRequest } from "../test-support/run-request";
import { openCodeConnector } from "./opencode";

// What a real `opencode serve` 1.19.5 showed when the connector was run against it (docs/design-docs/harness-e2e.md).

function connect(fake: FakeFetch) {
  const parsed = openCodeConnector.schema.parse({
    kind: "opencode",
    id: "oc",
    name: "OpenCode",
    url: "http://oc.test:4096",
    pollSeconds: 0.05,
  });
  return openCodeConnector.connect(parsed, { env: {}, fetch: fake.fetch });
}

describe("an OpenCode server as it really answers [REQ-051]", () => {
  test("its hidden helper agents (title, summary, compaction) are not offered as agents", async () => {
    const fake = new FakeFetch().on("GET", /^\/agent$/, () =>
      json([
        { name: "build", mode: "primary", native: true },
        { name: "compaction", mode: "primary", hidden: true },
        { name: "title", mode: "primary", hidden: true },
        { name: "plan", mode: "primary" },
      ]),
    );
    expect((await connect(fake).agents()).map((a) => a.id)).toEqual(["build", "plan"]);
  });

  test("the run's MCP server is disconnected when the run ends, so later runs do not see its dead tools", async () => {
    const ok = new FakeFetch()
      .on("POST", /^\/mcp$/, () => json({}))
      .on("POST", /^\/session$/, () => json({ id: "ses-1" }))
      .on("POST", /\/prompt_async$/, () => new Response(null, { status: 204 }))
      .on("GET", /^\/session\/status$/, () => json({}))
      .on("GET", /^\/session\/ses-1\/message$/, () => json([]))
      .on("POST", /\/disconnect$/, () => json(true));
    await connect(ok).run(runRequest());
    expect(ok.requests.at(-1)).toMatchObject({
      method: "POST",
      url: expect.stringContaining("/mcp/terrarium-r1/disconnect"),
    });

    const broken = new FakeFetch()
      .on("POST", /^\/mcp$/, () => json({}))
      .on("POST", /^\/session$/, () => new Response("boom", { status: 500 }))
      .on("POST", /\/disconnect$/, () => json(true));
    const out = await connect(broken).run(runRequest());
    expect(out.status).toBe("error");
    expect(broken.requests.at(-1)?.url).toContain("/mcp/terrarium-r1/disconnect");
  });
});
