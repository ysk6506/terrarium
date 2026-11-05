/** "말 걸어 보기" for gateways that answer OpenAI-style chat requests: one user message, no tools, one reply. */
import type { TalkReply, TalkRequest } from "@terrarium/core/experiments";
import type { Rest } from "./rest";
import { traceHeaders } from "./util";

interface Completion {
  readonly model?: string;
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: unknown; readonly tool_calls?: readonly unknown[] };
  }>;
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
}

/** The text of a message whose `content` is a string or a list of `{type: "text", text}` parts. */
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p) => (p && typeof p === "object" ? ((p as { text?: unknown }).text ?? "") : ""))
    .filter((t): t is string => typeof t === "string")
    .join("");
}

export async function chatTalk(
  rest: Rest,
  model: string,
  req: TalkRequest,
  path = "/v1/chat/completions",
): Promise<TalkReply> {
  const body = await rest.json<Completion>(
    "채팅 요청",
    "POST",
    path,
    req.signal,
    {
      model,
      messages: [{ role: "user", content: req.text }],
      stream: false,
      user: `terrarium-${req.runId}`,
    },
    traceHeaders({ ...(req.telemetry ? { telemetry: req.telemetry } : {}) }),
  );
  const message = body?.choices?.[0]?.message;
  if (!message) throw new Error("게이트웨이가 빈 응답을 보냈어요");
  return {
    text: contentText(message.content),
    ...(body.model ? { model: body.model } : {}),
    ...(body.usage?.prompt_tokens === undefined ? {} : { inputTokens: body.usage.prompt_tokens }),
    ...(body.usage?.completion_tokens === undefined
      ? {}
      : { outputTokens: body.usage.completion_tokens }),
    toolCalls: message.tool_calls?.length ?? 0,
  };
}
