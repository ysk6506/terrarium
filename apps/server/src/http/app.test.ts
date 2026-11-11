import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { ROUTES, type RouteSpec } from "@terrarium/core/contract";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import type { FastifyInstance } from "fastify";
import { afterAll, describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { ANONYMOUS } from "../runtime";
import { person, testPlatform, until } from "../runtime/test-support/platform";
import { buildApp } from "./app";
import { proxyViewer, SELF_ONLY, selfViewer } from "./viewer";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function app(options: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const t = testPlatform();
  return {
    ...t,
    app: buildApp({ platform: t.platform, publicUrl: "https://terrarium.internal", ...options }),
  };
}

const as = (name: string) => ({ "x-terrarium-user": encodeURIComponent(name) });

async function json(
  a: FastifyInstance,
  method: string,
  url: string,
  payload?: unknown,
  user = "연수",
) {
  const r = await a.inject({
    method: method as "GET",
    url,
    headers: as(user),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return {
    status: r.statusCode,
    body: r.json() as Record<string, unknown> & { error?: { code: string } },
    raw: r,
  };
}

describe("every route of the contract is served [REQ-030]", () => {
  test("the app answers each method and path in the route table", () => {
    const { app: a } = app();
    for (const [name, route] of Object.entries(ROUTES) as [string, RouteSpec][])
      expect(a.hasRoute({ method: route.method, url: route.path }), name).toBe(true);
    expect(a.hasRoute({ method: "GET", url: "/healthz" })).toBe(true);
  });
});

describe("an experiment over HTTP [REQ-030] [REQ-038]", () => {
  test("world, scenario, experiment, result, report and a share link that opens without the app", async () => {
    const { app: a } = app();
    const world = await json(a, "POST", "/api/worlds", {
      name: "홀",
      blueprint: sampleBlueprint(),
    });
    expect(world.status).toBe(200);
    const worldId = (world.body.world as { id: string }).id;
    const scenario = await json(a, "POST", "/api/scenarios", {
      worldId,
      templateId: "cooling-failure",
    });
    const scenarioId = (scenario.body.scenario as { id: string }).id;
    const created = await json(a, "POST", "/api/experiments", {
      name: "HTTP로 만든 실험",
      recipe: {
        worldId,
        scenarioId,
        harnessId: "builtin",
        agentId: "triage",
        tools: DEFAULT_TOOLSET,
        runs: 2,
      },
    });
    expect(created.status).toBe(200);
    const id = (created.body.experiment as { id: string; owner: string }).id;
    expect((created.body.experiment as { owner: string }).owner).toBe("연수");
    await until(
      async () => (await json(a, "GET", `/api/experiments/${id}`)).body.status === "completed",
    );
    const view = await json(a, "GET", `/api/experiments/${id}`);
    expect(view.body).toMatchObject({ passRate: 1, canCancel: false });
    const runId = (view.body.runs as { id: string }[])[0]?.id as string;
    expect((await json(a, "GET", `/api/runs/${runId}`)).body).toMatchObject({
      run: { status: "completed" },
    });

    const html = await a.inject({ url: `/api/experiments/${id}/report` });
    expect(html.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(html.body).toContain("https://terrarium.internal/experiments/");
    const md = await a.inject({ url: `/api/experiments/${id}/report?format=md` });
    expect(md.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    const text = await a.inject({ url: `/api/experiments/${id}/report?format=text` });
    expect(text.body.startsWith("[테라리움] HTTP로 만든 실험")).toBe(true);
    const jsonl = await a.inject({ url: `/api/experiments/${id}/diagnoses` });
    expect(jsonl.headers["content-disposition"]).toBe(
      `attachment; filename="${id}-diagnoses.jsonl"`,
    );
    expect(jsonl.body.trim().split("\n")).toHaveLength(2);

    const share = await json(a, "POST", `/api/experiments/${id}/shares`, {});
    const url = String(share.body.url);
    expect(url.startsWith("https://terrarium.internal/r/")).toBe(true);
    const opened = await a.inject({ url: new URL(url).pathname });
    expect(opened.statusCode).toBe(200);
    expect(opened.headers["x-robots-tag"]).toBe("noindex");
    expect(opened.body).toContain("<title>HTTP로 만든 실험 — 테라리움</title>");
    const deleted = await json(a, "DELETE", `/api/shares/${share.body.token}`);
    expect(deleted.body).toEqual({ deleted: true });
    expect((await a.inject({ url: new URL(url).pathname })).statusCode).toBe(404);

    const boards = await json(a, "GET", "/api/leaderboards?minRuns=1");
    expect(boards.raw.json()).toHaveLength(1);
    expect((await a.inject({ url: "/api/twin/brief" })).headers["content-type"]).toBe(
      "text/markdown; charset=utf-8",
    );
    expect((await a.inject({ url: "/api/twin/diagnoses" })).headers["content-disposition"]).toBe(
      'attachment; filename="terrarium-diagnoses.jsonl"',
    );
    const list = await json(a, "GET", "/api/experiments?owner=%EC%97%B0%EC%88%98&limit=5");
    expect(list.raw.json()).toHaveLength(1);
  });

  test("bad input is answered field by field, in Korean, with one error shape", async () => {
    const { app: a } = app();
    const missing = await json(a, "POST", "/api/experiments", { name: "" });
    expect(missing).toMatchObject({
      status: 400,
      body: {
        error: {
          code: "invalid_input",
          issues: [
            { path: "name", message: "비어 있으면 안 돼요" },
            { path: "recipe", message: "필요한 값이 없어요" },
          ],
        },
      },
    });
    const query = await json(a, "GET", "/api/experiments?limit=0");
    expect(query.body.error).toMatchObject({
      code: "invalid_input",
      message: "주소의 조건을 확인해 주세요",
    });
    const broken = await a.inject({
      method: "POST",
      url: "/api/worlds",
      headers: { "content-type": "application/json" },
      payload: "{bad",
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json()).toEqual({
      error: { code: "invalid_json", message: "본문이 올바른 JSON이 아니에요" },
    });
    const xml = await a.inject({
      method: "POST",
      url: "/api/worlds",
      headers: { "content-type": "application/xml" },
      payload: "<a/>",
    });
    expect(xml.statusCode).toBe(415);
    expect((await json(a, "GET", "/api/worlds/w-404")).body.error).toEqual({
      code: "not_found",
      message: "세계 w-404를 찾을 수 없어요",
    });
    expect((await json(a, "GET", "/api/nothing")).status).toBe(404);
    expect((await a.inject({ url: "/mcp/runs/r/t", method: "POST" })).statusCode).toBe(404);
  });

  test("changing someone else's things is refused; a server fault hides its internals", async () => {
    const { app: a, platform } = app();
    const world = await json(
      a,
      "POST",
      "/api/worlds",
      { name: "홀", blueprint: sampleBlueprint() },
      "연수",
    );
    const w = world.body.world as { id: string; digest: string };
    const other = await json(
      a,
      "PUT",
      `/api/worlds/${w.id}`,
      { baseDigest: w.digest, name: "남의 것" },
      "지민",
    );
    expect(other).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
    platform.worlds.list = async () => {
      throw new Error("SQLITE_IOERR /var/lib/terrarium.db");
    };
    const fault = await json(a, "GET", "/api/worlds");
    expect(fault.status).toBe(500);
    expect(JSON.stringify(fault.body)).not.toContain("SQLITE");
  });
});

describe("live progress as server-sent events [REQ-030]", () => {
  test("a summary first, then runs and tool calls as they happen", async () => {
    const { app: a, platform } = app({ heartbeatSeconds: 0.05 });
    const world = await platform.worlds.create(person("연수"), {
      name: "홀",
      blueprint: sampleBlueprint(),
    });
    const { scenario } = await platform.scenarios.create(person("연수"), {
      worldId: world.world.id,
      templateId: "cooling-failure",
    });
    await a.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${(a.server.address() as AddressInfo).port}`;
    try {
      const created = await platform.experiments.create(person("연수"), {
        name: "실시간",
        recipe: {
          worldId: world.world.id,
          scenarioId: scenario.id,
          harnessId: "builtin",
          agentId: "idle",
          tools: [...DEFAULT_TOOLSET],
          seeds: [1],
        },
      });
      const controller = new AbortController();
      const res = await fetch(`${base}/api/experiments/${created.experiment.id}/events`, {
        signal: controller.signal,
      });
      expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      let text = "";
      const decoder = new TextDecoder();
      while (!text.includes("event: experiment") || !text.includes(": ping")) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
      controller.abort();
      expect(text.startsWith("event: experiment\ndata: ")).toBe(true);
      const missing = await fetch(`${base}/api/experiments/e-404/events`);
      expect(missing.status).toBe(404);
    } finally {
      await a.close();
    }
  });
});

describe("the web app is served from the same place [REQ-006]", () => {
  test("files, and every other page is the app (it routes in the browser)", async () => {
    const dist = mkdtempSync(path.join(tmpdir(), "terrarium-web-"));
    dirs.push(dist);
    mkdirSync(path.join(dist, "assets"));
    writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>테라리움</title>");
    writeFileSync(path.join(dist, "assets", "app.js"), "console.log(1)");
    const { app: a } = app({ webDist: dist });
    expect((await a.inject({ url: "/" })).body).toContain("<title>테라리움</title>");
    expect((await a.inject({ url: "/assets/app.js" })).body).toBe("console.log(1)");
    const deep = await a.inject({ url: "/experiments/e-1?tab=runs" });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain("<title>테라리움</title>");
    expect((await a.inject({ url: "/api/unknown" })).json()).toEqual({
      error: { code: "not_found", message: "그런 주소는 없어요" },
    });
    const { app: bare } = app();
    expect((await bare.inject({ url: "/" })).statusCode).toBe(404);
  });
});

describe("who is asking [REQ-033]", () => {
  const proxy = { ...SELF_ONLY, header: "x-forwarded-user", secret: "test-secret-0001" };
  const sealed = { "x-terrarium-proxy-secret": "test-secret-0001" };

  test("the SSO proxy's header wins and cannot be faked; otherwise the name people typed", () => {
    expect(
      proxyViewer(
        { ...sealed, "x-forwarded-user": "yeonsu.kim", "x-terrarium-user": "admin" },
        proxy,
      ),
    ).toEqual({
      id: "yeonsu.kim",
      name: "yeonsu.kim",
      groups: [],
      roles: ["user"],
      source: "proxy",
    });
    expect(proxyViewer({ ...sealed, "x-terrarium-user": "admin" }, proxy)).toBeUndefined();
    expect(selfViewer({ "x-terrarium-user": encodeURIComponent(" 김연수 ") }, SELF_ONLY)).toEqual(
      person("김연수"),
    );
    expect(selfViewer({ "x-terrarium-user": "%E0%A4%A" }, SELF_ONLY)).toMatchObject({
      source: "anonymous",
    });
    expect(selfViewer({ "x-terrarium-user": "a\u0000b" }, SELF_ONLY)).toMatchObject({
      source: "anonymous",
    });
    expect(selfViewer({ "x-terrarium-user": "x".repeat(41) }, SELF_ONLY)).toMatchObject({
      source: "anonymous",
    });
    expect(selfViewer({ "x-terrarium-user": ["첫째", "둘째"] }, SELF_ONLY)).toEqual(person("첫째"));
    expect(selfViewer({}, SELF_ONLY)).toEqual(ANONYMOUS);
  });
});
