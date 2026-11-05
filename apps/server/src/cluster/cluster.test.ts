import { InvalidValueError } from "@terrarium/core/kernel";
import { emptyScenario, SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import fastify from "fastify";
import { afterEach, describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { InProcessHost, type PlainSessionConfig } from "../runtime";
import { ClusterHost } from "./cluster-host";
import { loadOf, metricsText, registerControl } from "./control-routes";
import { Heartbeat } from "./heartbeat";
import { NodeServer } from "./node-server";
import { NodeRegistry } from "./registry";
import { type Fetch, NodeRefused, NodeUnreachable, RemoteNode } from "./remote-host";

const TOKEN = "t".repeat(24);

const config = (seed = 5): PlainSessionConfig => {
  const blueprint = sampleBlueprint();
  const template = SCENARIO_TEMPLATES.find((t) => t.id === "cooling-failure");
  if (!template) throw new Error("template");
  return {
    blueprint,
    scenario: template.build(new BlueprintIndex(blueprint), "sample"),
    tools: DEFAULT_TOOLSET,
    seed,
  };
};

const diagnosis = {
  rootCause: "crah-1",
  faultType: "cooling_unit_failure",
  summary: "정지",
};

const started: NodeServer[] = [];
const servers: Array<{ close(): Promise<unknown> }> = [];

async function startNode(
  id: string,
  slots = 2,
  extra: Partial<ConstructorParameters<typeof NodeServer>[0]> = {},
) {
  const node = new NodeServer({
    host: new InProcessHost(),
    token: TOKEN,
    id,
    url: "http://127.0.0.1:1",
    slots,
    version: "test",
    ...extra,
  });
  await node.app.listen({ port: 0, host: "127.0.0.1" });
  started.push(node);
  const address = node.app.server.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return { node, url };
}

afterEach(async () => {
  await Promise.all(started.splice(0).map((n) => n.close()));
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function play(open: () => Promise<Awaited<ReturnType<InProcessHost["open"]>>>) {
  const s = await open();
  await s.call("list_alarms", {});
  const done = await s.call("submit_diagnosis", diagnosis);
  expect(done.ended).toBe("diagnosed");
  const result = await s.finish();
  s.dispose();
  return result;
}

describe("a worker node runs the same session as a local host [REQ-042] [REQ-001]", () => {
  test("over HTTP the result is identical to in-process", async () => {
    const { url } = await startNode("n1");
    const remote = new RemoteNode({ id: "n1", url, token: TOKEN });
    const here = await play(() => new InProcessHost().open(config()));
    const there = await play(() => remote.open(config()));
    // The wire is JSON, so compare what survives JSON (it has no -0).
    expect(there).toEqual(JSON.parse(JSON.stringify(here)));
    expect((await remote.status()).open).toBe(0);
  }, 60_000);

  test("a world travels once per node; a node that forgot it asks again", async () => {
    let current = await startNode("n1");
    const bodies: string[] = [];
    const via: Fetch = (u, init) => {
      bodies.push(String(init.body ?? ""));
      return fetch(u.replace(/^http:\/\/[^/]+/, current.url), init);
    };
    const remote = new RemoteNode({ id: "n1", url: current.url, token: TOKEN, fetch: via });
    (await remote.open(config(1))).dispose();
    (await remote.open(config(2))).dispose();
    const opens = bodies.filter((b) => b.includes('"digest"'));
    expect(opens[0]).toContain('"blueprint"');
    expect(opens[1]).not.toContain('"blueprint"');
    // The node restarts and has an empty cache: the client resends the world instead of failing.
    await current.node.close();
    current = await startNode("n1");
    const again = await remote.open(config(3));
    expect(again.task).toBeDefined();
    again.dispose();
    expect(bodies.filter((b) => b.includes('"blueprint"')).length).toBe(2);
  }, 60_000);

  test("a wrong token is refused; a world that does not match its digest is refused", async () => {
    const { url } = await startNode("n1");
    const stranger = new RemoteNode({ id: "n1", url, token: "x".repeat(24) });
    await expect(stranger.status()).rejects.toMatchObject({ code: "unauthorized" });
    const lying = await fetch(`${url}/node/v1/sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ config: {}, digest: "0".repeat(64), blueprint: config().blueprint }),
    });
    expect(lying.status).toBe(400);
  });

  test("a full node and a draining node refuse new sessions; running ones finish", async () => {
    const { url, node } = await startNode("n1", 1);
    const remote = new RemoteNode({ id: "n1", url, token: TOKEN });
    const first = await remote.open(config());
    await expect(remote.open(config())).rejects.toBeInstanceOf(NodeRefused);
    first.dispose();
    await new Promise((r) => setTimeout(r, 50));
    node.drain();
    await expect(remote.open(config())).rejects.toMatchObject({ code: "node_draining" });
    expect(node.report().draining).toBe(true);
  });

  test("errors keep their kind across the network", async () => {
    const { url } = await startNode("n1");
    const remote = new RemoteNode({ id: "n1", url, token: TOKEN });
    const bad = { ...config(), scenario: emptyScenario("s-empty", "sample") };
    await expect(remote.open(bad)).rejects.toBeInstanceOf(InvalidValueError);
  });

  test("a node that goes away fails the session in words an operator can act on", async () => {
    const { url, node } = await startNode("n1");
    const remote = new RemoteNode({ id: "n1", url, token: TOKEN, timeoutMs: 2000 });
    const s = await remote.open(config());
    await node.close();
    await expect(s.call("list_alarms", {})).rejects.toBeInstanceOf(NodeUnreachable);
    await expect(s.call("list_alarms", {})).rejects.toThrow("세션을 돌리던 노드 n1가 멈췄어요");
    s.dispose();
  });

  test("sessions nobody touches are abandoned, so a dead control plane cannot hold slots", async () => {
    const { node, url } = await startNode("n1", 2, { idleMs: 0 });
    const remote = new RemoteNode({ id: "n1", url, token: TOKEN });
    await remote.open(config());
    await new Promise((r) => setTimeout(r, 10));
    expect(node.reap()).toBe(1);
    expect(node.report().open).toBe(0);
  });
});

describe("the control plane places sessions on nodes [REQ-042]", () => {
  const clock = { t: 1_000 };
  const registry = () => new NodeRegistry(20_000, {}, () => clock.t);
  const beat = (reg: NodeRegistry, id: string, url: string, slots: number, draining = false) =>
    reg.beat({ id, url, slots, open: 0, draining, version: "test" });

  test("least busy first, spill over when full, capacity follows the nodes", async () => {
    const a = await startNode("a", 2);
    const b = await startNode("b", 2);
    const reg = registry();
    beat(reg, "a", a.url, 2);
    beat(reg, "b", b.url, 2);
    const host = new ClusterHost({ registry: reg, token: TOKEN });
    expect(host.capacity).toBe(4);
    const opened = [];
    for (let i = 0; i < 4; i++) opened.push(await host.open(config(i)));
    expect(host.placedOn("a")).toBe(2);
    expect(host.placedOn("b")).toBe(2);
    expect(host.openCount).toBe(4);
    await expect(host.open(config())).rejects.toThrow("세션을 돌릴 자리가 없어요");
    opened[0]?.dispose();
    opened[0]?.dispose();
    expect(host.openCount).toBe(3);
    for (const s of opened) s.dispose();
    expect(host.openCount).toBe(0);
  }, 60_000);

  test("a draining or silent node gets nothing new; a local host counts too", async () => {
    const a = await startNode("a", 2);
    const b = await startNode("b", 2);
    const reg = registry();
    beat(reg, "a", a.url, 2, true);
    beat(reg, "b", b.url, 2);
    const host = new ClusterHost({
      registry: reg,
      token: TOKEN,
      local: { host: new InProcessHost(), slots: 1 },
    });
    expect(host.capacity).toBe(3);
    const one = await host.open(config());
    const two = await host.open(config());
    expect(host.placedOn("a")).toBe(0);
    clock.t += 30_000;
    reg.sweep();
    expect(host.capacity).toBe(1);
    one.dispose();
    two.dispose();
  }, 60_000);

  test("a node that vanished between heartbeat and open is skipped", async () => {
    const a = await startNode("a", 2);
    const b = await startNode("b", 2);
    const reg = registry();
    beat(reg, "a", a.url, 2);
    beat(reg, "b", b.url, 2);
    await a.node.close();
    started.splice(started.indexOf(a.node), 1);
    const host = new ClusterHost({ registry: reg, token: TOKEN, timeoutMs: 1000 });
    const s = await host.open(config());
    expect(host.placedOn("b")).toBe(1);
    s.dispose();
  }, 60_000);

  test("registry: join, change, leave and silence are reported", () => {
    const events: string[] = [];
    const reg = new NodeRegistry(
      10_000,
      {
        joined: (n) => events.push(`+${n.id}:${n.slots}`),
        lost: (n, why) => events.push(`-${n.id}:${why}`),
      },
      () => clock.t,
    );
    beat(reg, "a", "http://10.0.0.1:8080", 4);
    beat(reg, "a", "http://10.0.0.1:8080", 4);
    beat(reg, "a", "http://10.0.0.1:8080", 8);
    beat(reg, "b", "http://10.0.0.2:8080", 4);
    reg.leave("b");
    clock.t += 11_000;
    expect(reg.list()).toEqual([]);
    reg.sweep();
    expect(events).toEqual(["+a:4", "+a:8", "+b:4", "-b:left", "-a:silent"]);
    expect(beat(reg, "c", "ftp://x", 1)).toBe(false);
    expect(beat(reg, "c", "http://user:pw@x:1", 1)).toBe(false);
  });
});

describe("autoscalers and node heartbeats [REQ-042]", () => {
  async function control() {
    const reg = new NodeRegistry(20_000);
    const counts = { running: 0, queued: 0 };
    const app = fastify();
    registerControl(app, {
      registry: reg,
      token: TOKEN,
      counts: () => counts,
      localSlots: 0,
      slotsPerWorker: () => 16,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    servers.push(app);
    const address = app.server.address();
    const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    return { reg, counts, url };
  }

  test("nodes appear by heartbeat and leave by goodbye", async () => {
    const { reg, url } = await control();
    const report = {
      id: "w1",
      url: "http://10.1.1.1:8081",
      slots: 16,
      open: 0,
      draining: false,
      version: "t",
    };
    const heartbeat = new Heartbeat({
      controlUrl: url,
      token: TOKEN,
      report: () => report,
      everyMs: 50,
    });
    expect(await heartbeat.beat()).toBe(true);
    expect(reg.capacity).toBe(16);
    await heartbeat.stop();
    expect(reg.list()).toEqual([]);
  });

  test("a bad token or report is refused; trouble is reported once per streak", async () => {
    const { url } = await control();
    const trouble: Array<string | undefined> = [];
    const stranger = new Heartbeat({
      controlUrl: url,
      token: "z".repeat(24),
      report: () => ({
        id: "w",
        url: "http://h:1",
        slots: 1,
        open: 0,
        draining: false,
        version: "t",
      }),
      everyMs: 50,
      onTrouble: (m) => trouble.push(m),
    });
    expect(await stranger.beat()).toBe(false);
    expect(await stranger.beat()).toBe(false);
    expect(trouble).toHaveLength(1);
    const garbage = await fetch(`${url}/cluster/v1/heartbeat`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ id: "../x", slots: -1 }),
    });
    expect(garbage.status).toBe(400);
  });

  test("metrics tell an autoscaler how many nodes the waiting work needs", async () => {
    const { reg, counts, url } = await control();
    reg.beat({ id: "w1", url: "http://h:1", slots: 16, open: 16, draining: false, version: "t" });
    counts.running = 16;
    counts.queued = 1000;
    const res = await fetch(`${url}/metrics`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const text = await res.text();
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(text).toContain("terrarium_runs_queued 1000");
    expect(text).toContain("terrarium_session_capacity 16");
    expect(text).toContain("terrarium_nodes_wanted 64");
    expect((await fetch(`${url}/metrics`)).status).toBe(401);
  });

  test("load math: no capacity with work waiting reads as full; idle reads as empty", () => {
    const reg = new NodeRegistry(1000);
    const base = { registry: reg, token: TOKEN, localSlots: 0, slotsPerWorker: () => 10 };
    const busy = loadOf({ ...base, counts: () => ({ running: 0, queued: 5 }) });
    expect(busy).toMatchObject({ utilization: 1, nodesWanted: 1, capacity: 0 });
    const idle = loadOf({ ...base, counts: () => ({ running: 0, queued: 0 }) });
    expect(idle).toMatchObject({ utilization: 0, nodesWanted: 0 });
    expect(metricsText(idle)).toContain("# TYPE terrarium_nodes gauge");
  });
});
