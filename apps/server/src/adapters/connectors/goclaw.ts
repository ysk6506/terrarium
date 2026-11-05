/**
 * A GoClaw gateway (REQ-051, ADR-0055). GoClaw lists its agents at `GET /v1/agents`, runs one turn per
 * `POST /v1/chat/completions` (model `goclaw:<agent>`), and takes tools only as MCP servers that an admin
 * registers (`POST /v1/mcp/servers`) and grants to an agent (`POST /v1/mcp/servers/{id}/grants/agent`).
 *
 * So one run is: register this run's MCP address, grant it to the agent, ask, then take both back. The chat
 * request *is* the run: GoClaw hands the request's context to the agent loop, so dropping the connection
 * stops it (there is no HTTP call to stop one; `chat.abort` exists only on the WebSocket).
 *
 * Grants belong to the agent, not to a request, so two runs of one agent at once would each see the other's
 * tools. The connector therefore lets one run of an agent go at a time and queues the rest.
 *
 * All of this is read from GoClaw's source and docs (internal/http/mcp.go, mcp_grants.go, chat_completions.go,
 * docs/18-http-api.md); it has not been run against a live GoClaw yet.
 */
import type {
  AgentInfo,
  AgentInventory,
  AgentRunOutcome,
  AgentRunRequest,
  HarnessInfo,
  HarnessPort,
  TalkReply,
  TalkRequest,
} from "@terrarium/core/experiments";
import { z } from "zod";
import type { FetchLike } from "../fetch";
import { credential, credentialFields } from "./credential";
import { base, EnvName, Url } from "./fields";
import { Rest } from "./rest";
import { chatTalk } from "./talk";
import { defineConnector } from "./types";
import { KeyedQueue, traceHeaders } from "./util";

/** Names of tools reach the agent as `mcp_<prefix>_<tool>`; the prompt says so, or the agent looks for bare names. */
const TOOL_PREFIX = "mcp_terrarium";

const schema = z
  .object({
    ...base("goclaw"),
    url: Url,
    tokenEnv: EnvName.optional(),
    /** Whose agents these are: GoClaw scopes agents to a user (header X-GoClaw-User-Id). */
    userId: z.string().min(1).max(100).default("terrarium"),
    requestTimeoutSeconds: z.number().min(10).max(7200).default(1800),
    /** Put the agents the gateway marks as not active in the list too (each marked with why). */
    showHidden: z.boolean().default(false),
  })
  .strict();

export type GoClawConfig = z.output<typeof schema>;

interface AgentRow {
  readonly id?: string;
  readonly agent_key?: string;
  readonly display_name?: string;
  readonly frontmatter?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly status?: string;
  readonly agent_type?: string;
}
/** What a gateway might say to mean "more follows": a cursor, a flag, or a total bigger than what came. */
function nextPage(body: unknown, got: number): string | undefined {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return undefined;
  const o = body as Record<string, unknown>;
  const cursor = [o.next_cursor, o.nextCursor, o.next].find(
    (c): c is string => typeof c === "string" && c !== "",
  );
  if (cursor) return `cursor=${encodeURIComponent(cursor)}`;
  const more = o.has_more === true || (typeof o.total === "number" && got < o.total);
  return more ? `offset=${got}` : undefined;
}

const MAX_PAGES = 50;

/** The phrase that says why an agent is left out of the list. */
const hiddenWhy = (status: string): string => `status ${status}`;

interface Completion {
  readonly model?: string;
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
}

/** A name GoClaw accepts for an MCP server: lower-case letters, digits and hyphens. */
export const serverName = (runId: string): string =>
  `terrarium-${runId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.replace(/-+$/g, "").slice(0, 60);

const taskText = (prompt: string): string =>
  [
    prompt,
    "",
    `Terrarium의 툴은 이름이 ${TOOL_PREFIX}_ 로 시작해요(예: ${TOOL_PREFIX}_list_alarms). 이 툴들만 이 세계를 보고 바꿀 수 있어요.`,
    `원인과 고장 종류를 찾은 뒤 ${TOOL_PREFIX}_submit_diagnosis 를 한 번만 불러 답해요. 보기 전에 짐작하지 않아요.`,
  ].join("\n");

export class GoClawHarness implements HarnessPort {
  readonly info: HarnessInfo;
  private readonly rest: Rest;
  private readonly queue = new KeyedQueue();
  private readonly uuids = new Map<string, string>();

  constructor(
    private readonly config: GoClawConfig,
    token: string | undefined,
    fetchImpl: FetchLike,
  ) {
    this.info = {
      id: config.id,
      name: config.name,
      kind: "goclaw",
      description:
        config.description || "GoClaw 게이트웨이. 게이트웨이의 에이전트를 고를 수 있어요.",
      toolTransport: "mcp",
      telemetry: "none",
    };
    this.rest = new Rest(
      config.url,
      {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "x-goclaw-user-id": config.userId,
      },
      fetchImpl,
    );
  }

  /**
   * Every row the gateway lists. GoClaw answers `GET /v1/agents` with one `{"agents": [...]}` and no paging
   * (read from internal/http/agents.go), but a gateway that adds a cursor or `total`+`offset` is followed to the end.
   */
  private async listAll(): Promise<{ rows: AgentRow[]; missing?: string }> {
    const rows: AgentRow[] = [];
    const seen = new Set<string>();
    let query: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await this.rest.json<unknown>(
        "에이전트 목록",
        "GET",
        query ? `/v1/agents?${query}` : "/v1/agents",
        AbortSignal.timeout(10_000),
      );
      const list = Array.isArray(body) ? body : (body as { agents?: unknown } | undefined)?.agents;
      if (!Array.isArray(list))
        return {
          rows,
          missing: `응답에 agents 배열이 없어요(받은 것: ${Object.keys((body ?? {}) as object).join(", ") || "빈 응답"})`,
        };
      const fresh = (list as AgentRow[]).filter((a) => !seen.has(a.agent_key ?? a.id ?? ""));
      for (const a of fresh) seen.add(a.agent_key ?? a.id ?? "");
      rows.push(...fresh);
      query = fresh.length === 0 ? undefined : nextPage(body, rows.length);
      if (!query) break;
    }
    return { rows };
  }

  private infoOf(a: AgentRow, key: string, hidden?: string): AgentInfo {
    if (a.id) this.uuids.set(key, a.id);
    return {
      id: key,
      name: a.display_name || key,
      ...(a.frontmatter ? { description: a.frontmatter } : {}),
      ...(a.model ? { model: a.model } : {}),
      ...(hidden ? { hidden } : {}),
      facts: {
        ...(a.provider ? { provider: a.provider } : {}),
        ...(a.agent_type ? { agentType: a.agent_type } : {}),
      },
    };
  }

  async inventory(): Promise<AgentInventory> {
    const { rows, missing } = await this.listAll();
    const shown: AgentInfo[] = [];
    const hidden = new Map<string, AgentInfo[]>();
    for (const a of rows) {
      const key = a.agent_key;
      if (!key) continue;
      const why = a.status && a.status !== "active" ? hiddenWhy(a.status) : undefined;
      if (!why) shown.push(this.infoOf(a, key));
      else hidden.set(why, [...(hidden.get(why) ?? []), this.infoOf(a, key, why)]);
    }
    const notes =
      shown.length > 1
        ? []
        : [
            `GoClaw는 사용자 ID가 소유자일 때만 모든 에이전트를 보여 줘요. 지금 사용자 ID는 '${this.config.userId}'예요.`,
            "소유자가 아니면 그 사용자가 만들었거나 공유받은 에이전트만 보여요. 소유자 ID는 기본이 'system'이에요.",
          ];
    return {
      shown,
      hidden: [...hidden].map(([reason, agents]) => ({ reason, agents })),
      includesHidden: this.config.showHidden,
      ...(rows.length === 0
        ? { empty: missing ?? "응답의 agents 배열이 비어 있어요" }
        : missing
          ? { empty: missing }
          : {}),
      notes,
    };
  }

  async agents(): Promise<readonly AgentInfo[]> {
    const { shown, hidden } = await this.inventory();
    return this.config.showHidden ? [...shown, ...hidden.flatMap((h) => h.agents)] : shown;
  }

  async talk(req: TalkRequest): Promise<TalkReply> {
    return chatTalk(this.rest, `goclaw:${req.agentId}`, req);
  }

  run(req: AgentRunRequest): Promise<AgentRunOutcome> {
    return this.queue.run(req.agentId, () => this.runOne(req));
  }

  private async uuidOf(agentKey: string): Promise<string> {
    if (!this.uuids.has(agentKey)) await this.agents();
    const id = this.uuids.get(agentKey);
    if (!id) throw new Error(`게이트웨이에 '${agentKey}' 에이전트가 없어요`);
    return id;
  }

  private async runOne(req: AgentRunRequest): Promise<AgentRunOutcome> {
    const used: { inputTokens: number; outputTokens: number; model?: string } = {
      inputTokens: 0,
      outputTokens: 0,
    };
    if (!req.tools.mcpUrl)
      return { status: "error", message: "이 실행에는 툴 서버 주소가 없어요", harness: used };
    if (req.signal.aborted) return { status: "cancelled", harness: used };
    const registered: { serverId?: string; agentUuid?: string } = {};
    try {
      registered.agentUuid = await this.uuidOf(req.agentId);
      const server = await this.rest.json<{ id?: string }>(
        "툴 서버 등록",
        "POST",
        "/v1/mcp/servers",
        req.signal,
        {
          name: serverName(req.runId),
          display_name: "Terrarium",
          transport: "streamable-http",
          url: req.tools.mcpUrl,
          tool_prefix: TOOL_PREFIX,
          timeout_sec: 120,
          enabled: true,
        },
      );
      if (!server?.id) throw new Error("게이트웨이가 툴 서버 번호를 돌려주지 않았어요");
      registered.serverId = server.id;
      await this.rest.json(
        "툴 서버 허용",
        "POST",
        `/v1/mcp/servers/${server.id}/grants/agent`,
        req.signal,
        { agent_id: registered.agentUuid },
      );
      const signal = AbortSignal.any([
        req.signal,
        AbortSignal.timeout(this.config.requestTimeoutSeconds * 1000),
      ]);
      const body = await this.rest.json<Completion>(
        "채팅 요청",
        "POST",
        "/v1/chat/completions",
        signal,
        {
          model: `goclaw:${req.agentId}`,
          messages: [{ role: "user", content: taskText(req.prompt) }],
          stream: false,
          user: `terrarium-${req.runId}`,
        },
        traceHeaders(req),
      );
      used.inputTokens = body?.usage?.prompt_tokens ?? 0;
      used.outputTokens = body?.usage?.completion_tokens ?? 0;
      if (body?.model) used.model = body.model;
      return { status: "finished", harness: used };
    } catch (err) {
      if (req.signal.aborted) return { status: "cancelled", harness: used };
      return { status: "error", message: (err as Error).message, harness: used };
    } finally {
      await this.takeBack(registered);
    }
  }

  /** Remove what this run added, whether it finished, failed or was stopped. Best effort: a leftover is only a name. */
  private async takeBack(r: { serverId?: string; agentUuid?: string }): Promise<void> {
    if (!r.serverId) return;
    const signal = AbortSignal.timeout(10_000);
    const attempt = (what: string, path: string) =>
      this.rest.json(what, "DELETE", path, signal).catch(() => undefined);
    if (r.agentUuid)
      await attempt(
        "툴 서버 허용 풀기",
        `/v1/mcp/servers/${r.serverId}/grants/agent/${r.agentUuid}`,
      );
    await attempt("툴 서버 지우기", `/v1/mcp/servers/${r.serverId}`);
  }
}

export const goClawConnector = defineConnector({
  spec: {
    kind: "goclaw",
    label: "GoClaw (게이트웨이)",
    description:
      "GoClaw 게이트웨이에 연결해요. 게이트웨이의 에이전트가 목록에 나오고, 실행마다 테라리움의 툴 서버를 GoClaw에 등록해 그 에이전트에 허용했다가 끝나면 거둬요.",
    scope: "harness",
    toolTransport: "mcp",
    toolGuide: [
      "툴은 MCP로 가요. 실행마다 테라리움의 툴 주소를 GoClaw의 MCP 서버로 등록하고(streamable-http), 고른 에이전트에 허용했다가 끝나면 지워요.",
      "GoClaw는 사설망 주소의 MCP 서버를 기본으로 막아요. 테라리움이 사설망에 있으면 GoClaw 쪽에서 허용 호스트에 테라리움 주소를 넣어야 해요(GOCLAW_MCP_ALLOWED_HOSTS 또는 gateway.mcp_allowed_hosts).",
      "허용은 에이전트 단위라서, 같은 에이전트의 실험은 한 번에 하나씩 돌아요. 동시에 많이 돌리려면 에이전트를 여러 개 두세요.",
      "토큰은 게이트웨이 토큰이나 MCP 서버를 관리할 수 있는 API 키여야 해요.",
    ],
    fromScreen: true,
    fields: [
      {
        key: "url",
        label: "게이트웨이 주소",
        type: "url",
        required: true,
        placeholder: "http://goclaw.internal:18790",
      },
      ...credentialFields("token", "토큰", "GOCLAW_GATEWAY_TOKEN"),
      {
        key: "userId",
        label: "사용자 ID",
        type: "text",
        default: "terrarium",
        help: "GoClaw는 이 사용자가 소유자일 때만 모든 에이전트를 보여 줘요(기본 소유자 ID는 system). X-GoClaw-User-Id로 보내요.",
      },
      {
        key: "showHidden",
        label: "쉬는 에이전트도 목록에 넣기",
        type: "boolean",
        default: false,
        advanced: true,
        help: "GoClaw에서 상태가 active가 아닌 에이전트(예: inactive)는 기본으로 숨겨요. 켜면 목록에 넣고 이유를 붙여요.",
      },
      {
        key: "requestTimeoutSeconds",
        label: "한 번의 실행 제한(초)",
        type: "number",
        default: 1800,
        advanced: true,
      },
    ],
  },
  schema,
  connect: (config, ctx) =>
    new GoClawHarness(config, credential(ctx, "token", config.tokenEnv), ctx.fetch),
});
