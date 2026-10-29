/**
 * The HTTP server (REQ-030, REQ-038): every route of the contract's table, parsed with its schemas,
 * answered with one error shape; live progress as server-sent events; per-run MCP endpoints for
 * harnesses; and the web app itself.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import {
  type ExperimentEvent,
  errorReply,
  invalidInput,
  type Produces,
  parseWith,
  ROUTES,
  type RouteName,
  type RouteSpec,
  toErrorReply,
} from "@terrarium/core/contract";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { McpGateway } from "../mcp";
import type { Platform } from "../runtime";
import { compressWeb } from "./compress";
import { HANDLERS, type HandlerInput } from "./handlers";
import { viewerOf } from "./viewer";

export interface AppOptions {
  readonly platform: Platform;
  readonly gateway?: McpGateway;
  /** Header set by a trusted SSO proxy with the signed-in user. */
  readonly identityHeader?: string;
  /** How people reach the server; derived from each request when absent. */
  readonly publicUrl?: string;
  /** Built web app to serve (apps/web/dist). */
  readonly webDist?: string;
  readonly logger?: boolean;
  /** Seconds between keep-alive comments on event streams. */
  readonly heartbeatSeconds?: number;
}

/** Big worlds are big: a 2000-rack blueprint is tens of megabytes of JSON. */
const BODY_LIMIT = 64 * 1024 * 1024;

const CONTENT_TYPES: Readonly<Record<Exclude<Produces, "json" | "sse">, string>> = {
  html: "text/html; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  text: "text/plain; charset=utf-8",
  jsonl: "application/x-ndjson; charset=utf-8",
};

const REPORT_TYPES: Readonly<Record<string, string>> = {
  html: CONTENT_TYPES.html,
  md: CONTENT_TYPES.markdown,
  text: CONTENT_TYPES.text,
};

function baseUrlOf(req: FastifyRequest, publicUrl: string | undefined): string {
  if (publicUrl) return publicUrl.replace(/\/$/, "");
  return `${req.protocol}://${req.headers.host ?? "localhost"}`;
}

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  const { status, body } = toErrorReply(err);
  if (status >= 500) reply.log.error(err);
  return reply.status(status).type("application/json; charset=utf-8").send(body);
}

/** Parse query and body with the route's schemas; undefined (and a 400 sent) when they are wrong. */
function parseInput(route: RouteSpec, req: FastifyRequest, reply: FastifyReply) {
  const query = route.query
    ? parseWith(route.query, req.query ?? {})
    : { ok: true as const, value: undefined };
  if (!query.ok) {
    const { status, body } = invalidInput(query.issues, "주소의 조건을 확인한다");
    void reply.status(status).send(body);
    return undefined;
  }
  const body = route.body
    ? parseWith(route.body, req.body ?? {})
    : { ok: true as const, value: undefined };
  if (!body.ok) {
    const { status, body: payload } = invalidInput(body.issues);
    void reply.status(status).send(payload);
    return undefined;
  }
  return { query: query.value, body: body.value };
}

function contentTypeFor(name: RouteName, route: RouteSpec, query: unknown): string | undefined {
  if (route.produces === "json" || route.produces === "sse") return undefined;
  if (name === "experimentReport" || name === "sharedReport")
    return REPORT_TYPES[(query as { format: string }).format] ?? CONTENT_TYPES.html;
  return CONTENT_TYPES[route.produces];
}

function registerRoute(
  app: FastifyInstance,
  name: Exclude<RouteName, "experimentEvents">,
  options: AppOptions,
): void {
  const route: RouteSpec = ROUTES[name];
  app.route({
    method: route.method,
    url: route.path,
    handler: async (req, reply) => {
      const parsed = parseInput(route, req, reply);
      if (!parsed) return reply;
      const input = {
        params: req.params as Record<string, string>,
        query: parsed.query,
        body: parsed.body,
        viewer: viewerOf(req.headers, options.identityHeader),
        baseUrl: baseUrlOf(req, options.publicUrl),
      } as HandlerInput<typeof name>;
      try {
        const result = await (HANDLERS[name] as (p: Platform, i: typeof input) => Promise<unknown>)(
          options.platform,
          input,
        );
        const type = contentTypeFor(name, route, parsed.query);
        if (type) reply.type(type);
        if (route.produces === "jsonl")
          reply.header(
            "content-disposition",
            `attachment; filename="${name === "twinDiagnoses" ? "terrarium" : input.params.id}-diagnoses.jsonl"`,
          );
        if (route.public)
          reply.header("cache-control", "private, max-age=60").header("x-robots-tag", "noindex");
        return reply.send(result);
      } catch (err) {
        return sendError(reply, err);
      }
    },
  });
}

/** Live progress of one experiment: a summary now, then every change as it happens. */
function registerEvents(app: FastifyInstance, options: AppOptions): void {
  app.get(ROUTES.experimentEvents.path, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const viewer = viewerOf(req.headers, options.identityHeader);
    let first: ExperimentEvent;
    try {
      const view = await options.platform.experiments.view(viewer, id);
      first = {
        type: "experiment",
        summary: {
          experiment: view.experiment,
          status: view.status,
          progress: view.progress,
          passRate: view.passRate,
        },
      };
    } catch (err) {
      return sendError(reply, err);
    }
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const write = (e: ExperimentEvent) =>
      raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    write(first);
    const off = options.platform.events.subscribe(id, write);
    const beat = setInterval(
      () => raw.write(": ping\n\n"),
      (options.heartbeatSeconds ?? 15) * 1000,
    );
    req.raw.on("close", () => {
      clearInterval(beat);
      off();
    });
  });
}

function registerMcp(app: FastifyInstance, gateway: McpGateway): void {
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp/runs/:runId/:token",
    handler: async (req, reply) => {
      const { runId, token } = req.params as { runId: string; token: string };
      if (!gateway.has(runId, token))
        return reply
          .status(404)
          .send(
            errorReply(404, "not_found", "이 실행의 툴 엔드포인트가 없거나 실행이 끝났다").body,
          );
      reply.hijack();
      await gateway.handle(runId, token, req.raw, reply.raw, req.body);
      return reply;
    },
  });
}

/** Paths that belong to machines: when they are missing the answer is a 404, never the web app. */
const API_PREFIXES = ["/api/", "/mcp/", "/cluster/", "/node/"];

function registerWeb(app: FastifyInstance, webDist: string | undefined): void {
  const index = webDist ? path.join(webDist, "index.html") : undefined;
  const hasWeb = index !== undefined && existsSync(index);
  // Files are looked up per request, so a rebuilt web app is served without restarting the server.
  if (hasWeb) {
    compressWeb(app);
    void app.register(fastifyStatic, { root: webDist as string });
  }
  app.setNotFoundHandler((req, reply) => {
    const url = req.url.split("?")[0] ?? "";
    if (
      API_PREFIXES.some((p) => url.startsWith(p)) ||
      url === "/metrics" ||
      !hasWeb ||
      req.method !== "GET"
    )
      return reply.status(404).send(errorReply(404, "not_found", "그런 주소는 없다").body);
    // A missing file is a 404, not the app: a script that answers with HTML only hides the real problem.
    if (/\.[A-Za-z0-9]{1,8}$/.test(url))
      return reply.status(404).send(errorReply(404, "not_found", "그런 파일은 없다").body);
    // The web app routes in the browser: every other page is the app.
    return reply.type("text/html; charset=utf-8").sendFile("index.html");
  });
}

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: BODY_LIMIT });
  app.setErrorHandler((err: { statusCode?: number; code?: string }, _req, reply) => {
    if (err.code === "FST_ERR_CTP_INVALID_JSON_BODY" || err.code === "FST_ERR_CTP_EMPTY_JSON_BODY")
      return reply
        .status(400)
        .send(errorReply(400, "invalid_json", "본문이 올바른 JSON이 아니다").body);
    if (err.statusCode === 413) return reply.status(413).send(errorReply(413, "too_large").body);
    if (err.statusCode === 415)
      return reply
        .status(415)
        .send(errorReply(415, "unsupported_media", "본문은 JSON이어야 한다").body);
    return sendError(reply, err);
  });
  app.get("/healthz", async () => ({ ok: true }));
  for (const name of Object.keys(ROUTES) as RouteName[])
    if (name !== "experimentEvents") registerRoute(app, name, options);
  registerEvents(app, options);
  if (options.gateway) registerMcp(app, options.gateway);
  registerWeb(app, options.webDist);
  return app;
}
