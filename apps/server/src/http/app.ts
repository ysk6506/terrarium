/**
 * The HTTP server (REQ-030, REQ-038): every route of the contract's table, parsed with its schemas,
 * answered with one error shape; live progress as server-sent events; per-run MCP endpoints for
 * harnesses; and the web app itself.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import {
  type ActivityEvent,
  type ExperimentEvent,
  errorReply,
  InvalidInputError,
  invalidInput,
  type Produces,
  parseWith,
  ROUTES,
  type RouteName,
  type RouteSpec,
  toErrorReply,
  UnauthenticatedError,
} from "@terrarium/core/contract";
import { randomToken } from "@terrarium/core/kernel";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { McpGateway } from "../mcp";
import { allow, isSignedIn, NOBODY, type Platform, type Viewer } from "../runtime";
import { type AuditedCall, auditCall } from "./audit-http";
import { compressWeb } from "./compress";
import { HANDLERS, type HandlerInput, type StreamRoute } from "./handlers";
import { type Authenticator, headerAuthenticator, modeOf } from "./identity";
import { SELF_ONLY } from "./viewer";

export interface AppOptions {
  readonly platform: Platform;
  readonly gateway?: McpGateway;
  /** Who is asking (ADR-0044). Left out: people type their own names, for one person on their own machine. */
  readonly authenticator?: Authenticator;
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
    const { status, body } = invalidInput(query.issues, "주소의 조건을 확인해 주세요");
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

/**
 * Who is asking, and whether the route's policy lets them in (ADR-0174), in two steps (`identify`, `admit`) so that a refusal
 * of a known person is written as theirs. Said before the request body is looked at, so a caller the server does not know
 * learns nothing from an answer about a field. `{ action }` policies are decided by the handler once it knows what the
 * request is about; here they need only a signed-in person.
 */
async function identify(
  route: RouteSpec,
  req: FastifyRequest,
  auth: Authenticator,
): Promise<Viewer> {
  // A link with its secret in the address is open to people with no sign-in (REQ-038).
  if (route.public) return NOBODY;
  const viewer = await auth.authenticate(req);
  if (route.policy === "open") return viewer;
  if (!isSignedIn(viewer)) throw new UnauthenticatedError("로그인이 필요해요");
  return viewer;
}

/** The policy of the route, for a person who is known: an admin-only route stops everyone else here. */
function admit(route: RouteSpec, viewer: Viewer): void {
  if (route.policy === "admin") allow(viewer, "administer");
}

/** The name a downloaded JSON Lines file gets. */
function jsonlName(name: RouteName, params: Readonly<Record<string, string>>): string {
  if (name === "exportAudit") return "terrarium-audit.jsonl";
  return `${name === "twinDiagnoses" ? "terrarium" : params.id}-diagnoses.jsonl`;
}

function registerRoute(
  app: FastifyInstance,
  name: Exclude<RouteName, StreamRoute>,
  options: AppOptions,
  auth: Authenticator,
): void {
  const route: RouteSpec = ROUTES[name];
  app.route({
    method: route.method,
    url: route.path,
    handler: async (req, reply) => {
      const call = auditCall(options.platform.audit, name, req);
      reply.header("x-request-id", call.requestId);
      return call.within(() => handle(call, name, options, auth, req, reply));
    },
  });
}

/** One request of a route, from sign-in to answer. The audit log hears of it through `call`, and of nothing else. */
async function handle(
  call: AuditedCall,
  name: Exclude<RouteName, StreamRoute>,
  options: AppOptions,
  auth: Authenticator,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const route: RouteSpec = ROUTES[name];
  const params = req.params as Record<string, string>;
  let viewer: Viewer = NOBODY;
  try {
    viewer = await identify(route, req, auth);
    admit(route, viewer);
    // a change is not begun when the log could not record it (permissions.md section 6)
    await call.ready();
  } catch (err) {
    await call.refused(viewer, err, { params }, true);
    return sendError(reply, err);
  }
  const parsed = parseInput(route, req, reply);
  if (!parsed) {
    await call.refused(viewer, new InvalidInputError("입력값을 확인해 주세요", []), { params });
    return reply;
  }
  const ended = { params, query: parsed.query, body: parsed.body };
  try {
    const input = {
      params,
      query: parsed.query,
      body: parsed.body,
      viewer,
      baseUrl: baseUrlOf(req, options.publicUrl),
      identityMode: modeOf(auth),
    } as HandlerInput<typeof name>;
    const result = await (HANDLERS[name] as (p: Platform, i: typeof input) => Promise<unknown>)(
      options.platform,
      input,
    );
    await call.succeeded(viewer, { ...ended, response: result });
    const type = contentTypeFor(name, route, parsed.query);
    if (type) reply.type(type);
    if (route.produces === "jsonl")
      reply.header("content-disposition", `attachment; filename="${jsonlName(name, params)}"`);
    if (route.public)
      reply.header("cache-control", "private, max-age=60").header("x-robots-tag", "noindex");
    return reply.send(result);
  } catch (err) {
    await call.refused(viewer, err, ended);
    return sendError(reply, err);
  }
}

/** Open a server-sent-event stream on a reply; `write` sends one event, `close` stops the heartbeat. */
function openStream<E extends { readonly type: string }>(
  req: FastifyRequest,
  reply: FastifyReply,
  options: AppOptions,
  onClose: () => void,
): (e: E) => void {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const beat = setInterval(() => raw.write(": ping\n\n"), (options.heartbeatSeconds ?? 15) * 1000);
  req.raw.on("close", () => {
    clearInterval(beat);
    onClose();
  });
  return (e) => raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
}

/** Live progress of one experiment: a summary now, then every change as it happens. */
function registerEvents(app: FastifyInstance, options: AppOptions, auth: Authenticator): void {
  app.get(ROUTES.experimentEvents.path, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const call = auditCall(options.platform.audit, "experimentEvents", req);
    let viewer: Viewer = NOBODY;
    let first: ExperimentEvent;
    try {
      first = await call.within(async () => {
        viewer = await identify(ROUTES.experimentEvents, req, auth);
        const view = await options.platform.experiments.view(viewer, id);
        await call.succeeded(viewer, { params: { id } });
        return {
          type: "experiment",
          summary: {
            experiment: view.experiment,
            status: view.status,
            progress: view.progress,
            passRate: view.passRate,
          },
        };
      });
    } catch (err) {
      await call.refused(viewer, err, { params: { id } }, viewer === NOBODY);
      return sendError(reply, err);
    }
    let off = () => {};
    const write = openStream<ExperimentEvent>(req, reply, options, () => off());
    write(first);
    // the scope can be narrowed while the stream is open: the person is asked again every few events
    const platform = options.platform;
    const still = rechecked(() => platform.gate.canSeeExperiment(viewer, id));
    off = platform.events.subscribe(
      id,
      inOrder((e) => still().then((ok) => ok && write(e))),
    );
  });
}

/** How many events pass between two looks at whether the person may still see what they are following. */
const RECHECK_EVERY = 25;

/** The answer to `ask`, asked again every `RECHECK_EVERY` calls. */
function rechecked(ask: () => Promise<boolean>): () => Promise<boolean> {
  let calls = 0;
  let last = true;
  return async () => {
    if (calls++ % RECHECK_EVERY === 0) last = await ask().catch(() => false);
    return last;
  };
}

/** Events handled one after the other, in the order they came, though each handling waits for an answer. */
function inOrder<E>(handle: (e: E) => Promise<unknown>): (e: E) => void {
  let chain: Promise<unknown> = Promise.resolve();
  return (e) => {
    chain = chain.then(() => handle(e)).catch(() => undefined);
  };
}

/** Who is working in one world now (REQ-050): the runs already going, then every call as it happens. */
function registerActivity(app: FastifyInstance, options: AppOptions, auth: Authenticator): void {
  app.get(ROUTES.worldActivity.path, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const call = auditCall(options.platform.audit, "worldActivity", req);
    let viewer: Viewer = NOBODY;
    try {
      await call.within(async () => {
        viewer = await identify(ROUTES.worldActivity, req, auth);
        // the activity of a world follows the world's scope: one the person cannot see is a 404
        await options.platform.gate.world(viewer, id);
        await call.succeeded(viewer, { params: { id } });
      });
    } catch (err) {
      await call.refused(viewer, err, { params: { id } }, viewer === NOBODY);
      return sendError(reply, err);
    }
    let off = () => {};
    const write = openStream<ActivityEvent>(req, reply, options, () => off());
    // every run in the world is shown only if its experiment is one the person may see
    const { platform } = options;
    const stills = new Map<string, () => Promise<boolean>>();
    const send = inOrder<ActivityEvent>(async (e) => {
      const still =
        stills.get(e.runId) ??
        rechecked(() =>
          platform.gate.run(viewer, e.runId).then(
            () => true,
            () => false,
          ),
        );
      stills.set(e.runId, still);
      if (await still()) write(e);
      if (e.type === "end") stills.delete(e.runId);
    });
    for (const e of platform.events.workingIn(id)) send(e);
    off = platform.events.subscribeWorld(id, send);
  });
}

function registerMcp(app: FastifyInstance, gateway: McpGateway): void {
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp/slots/:slot/:token",
    handler: async (req, reply) => {
      const { slot, token } = req.params as { slot: string; token: string };
      if (!gateway.hasSlot(slot, token))
        return reply
          .status(404)
          .send(errorReply(404, "not_found", "이 연결의 고정 툴 주소가 아니에요").body);
      reply.hijack();
      await gateway.handleSlot(slot, token, req.raw, reply.raw, req.body);
      return reply;
    },
  });
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp/runs/:runId/:token",
    handler: async (req, reply) => {
      const { runId, token } = req.params as { runId: string; token: string };
      if (!gateway.has(runId, token))
        return reply
          .status(404)
          .send(
            errorReply(404, "not_found", "이 실행의 툴 엔드포인트가 없거나 실행이 끝났어요").body,
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
      return reply.status(404).send(errorReply(404, "not_found", "그런 주소는 없어요").body);
    // A missing file is a 404, not the app: a script that answers with HTML only hides the real problem.
    if (/\.[A-Za-z0-9]{1,8}$/.test(url))
      return reply.status(404).send(errorReply(404, "not_found", "그런 파일은 없어요").body);
    // The web app routes in the browser: every other page is the app.
    return reply.type("text/html; charset=utf-8").sendFile("index.html");
  });
}

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: BODY_LIMIT,
    // ties together the entries one request writes to the audit log; unlike a counter, it does not repeat after a restart
    genReqId: () => randomToken(9),
  });
  app.setErrorHandler((err: { statusCode?: number; code?: string }, _req, reply) => {
    if (err.code === "FST_ERR_CTP_INVALID_JSON_BODY" || err.code === "FST_ERR_CTP_EMPTY_JSON_BODY")
      return reply
        .status(400)
        .send(errorReply(400, "invalid_json", "본문이 올바른 JSON이 아니에요").body);
    if (err.statusCode === 413) return reply.status(413).send(errorReply(413, "too_large").body);
    if (err.statusCode === 415)
      return reply
        .status(415)
        .send(errorReply(415, "unsupported_media", "본문은 JSON이어야 해요").body);
    return sendError(reply, err);
  });
  app.get("/healthz", async () => ({ ok: true }));
  const auth = options.authenticator ?? headerAuthenticator(SELF_ONLY);
  auth.mount?.(app);
  for (const name of Object.keys(ROUTES) as RouteName[])
    if (name !== "experimentEvents" && name !== "worldActivity")
      registerRoute(app, name, options, auth);
  registerEvents(app, options, auth);
  registerActivity(app, options, auth);
  if (options.gateway) registerMcp(app, options.gateway);
  registerWeb(app, options.webDist);
  return app;
}
