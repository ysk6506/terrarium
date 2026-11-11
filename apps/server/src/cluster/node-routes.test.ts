import { SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import { afterEach, describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { InProcessHost } from "../runtime";
import { NodeServer } from "./node-server";
import { RemoteNode } from "./remote-host";

const TOKEN = "t".repeat(24);
const started: NodeServer[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((n) => n.close()));
});

async function node() {
  const server = new NodeServer({
    host: new InProcessHost(),
    token: TOKEN,
    id: "n1",
    url: "http://127.0.0.1:1",
    slots: 2,
    version: "test",
  });
  await server.app.listen({ port: 0, host: "127.0.0.1" });
  started.push(server);
  const address = server.app.server.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return { url, remote: new RemoteNode({ id: "n1", url, token: TOKEN }) };
}

function config() {
  const blueprint = sampleBlueprint();
  const template = SCENARIO_TEMPLATES.find((t) => t.id === "cooling-failure");
  if (!template) throw new Error("template");
  return {
    blueprint,
    scenario: template.build(new BlueprintIndex(blueprint), "sample"),
    tools: DEFAULT_TOOLSET,
    seed: 5,
  };
}

const call = (url: string, method: string, path: string, body?: unknown) =>
  fetch(`${url}/node/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe("a worker node answers for sessions it does not hold and for calls that fail [REQ-042]", () => {
  test("every session route says 404 not_found for an id the node never opened", async () => {
    const { url } = await node();
    for (const [method, path, body] of [
      ["GET", "/sessions/none", undefined],
      ["POST", "/sessions/none/call", { tool: "list_alarms", args: {} }],
      ["POST", "/sessions/none/human", { kind: "act", tool: "x", args: {} }],
      ["POST", "/sessions/none/finish", {}],
    ] as const) {
      const res = await call(url, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
    }
    expect((await call(url, "DELETE", "/sessions/none")).status).toBe(204);
  });

  test("a call to a tool the session does not have is refused with the error the session gave", async () => {
    const { remote } = await node();
    const s = await remote.open(config());
    const refused = await s.call("no_such_tool", {});
    expect(refused.ok).toBe(false);
    expect((await remote.status()).open).toBe(1);
    s.dispose();
  }, 30_000);

  test("a person's answer to a run that waits for nobody is refused, and the run can still be finished", async () => {
    const { remote } = await node();
    const s = await remote.open(config());
    const errors: unknown[] = [];
    await s.resolveHuman({ kind: "reply", text: "x" }).catch((e) => errors.push(e));
    await s.humanAct("no_such_tool", {}).catch((e) => errors.push(e));
    expect(errors.map((e) => (e as { code: string }).code)).toEqual(["conflict", "conflict"]);
    const result = await s.finish("agent_finished");
    expect(result.endReason).toBe("agent_finished");
    s.dispose();
  }, 30_000);

  test("a node refuses a wrong token before it looks at the route", async () => {
    const { url } = await node();
    const res = await fetch(`${url}/node/v1/status`, { headers: { authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
    const bad = new RemoteNode({ id: "n1", url, token: "x".repeat(24) });
    await expect(bad.status()).rejects.toMatchObject({ code: "unauthorized" });
  });
});
