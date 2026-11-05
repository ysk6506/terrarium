/**
 * A scripted OpenAI-compatible chat-completions server: no model, only the next Terrarium tool call for
 * the "냉방기 정지" scenario (list_alarms, facility_status, restart_cooling_unit, submit_diagnosis).
 * It lets a real harness (OpenCode, OpenClaw) run end to end where no LLM is reachable.
 * Usage: pnpm tsx tests/e2e/harness/stub-llm.ts <port> [logfile]
 */
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

interface Tool {
  readonly name?: string;
  readonly function?: { readonly name?: string };
}
interface Message {
  readonly role?: string;
  readonly content?: unknown;
}
interface Body {
  readonly stream?: boolean;
  readonly tools?: readonly Tool[];
  readonly messages?: readonly Message[];
}
type Step = { call: { id: string; name: string; args: object } } | { text: string };

const port = Number(process.argv[2] ?? 4300);
const logFile = process.argv[3];
const log = (line: string): void => {
  if (logFile) appendFileSync(logFile, `${line}\n`);
};

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((p) => (p as { text?: string }).text ?? "").join("");
};
const nameOf = (t: Tool): string => t.function?.name ?? t.name ?? "";

let counter = 0;

/** MCP clients prefix tool names with the server name (`terrarium-<run>_list_alarms`), so match the tail. */
function plan(body: Body): Step {
  const tools = body.tools ?? [];
  const find = (name: string): string | undefined =>
    tools.map(nameOf).find((n) => n === name || n.endsWith(`_${name}`));
  if (!find("list_alarms")) return { text: "Terrarium e2e" }; // title and other helper requests
  const messages = body.messages ?? [];
  const lastUser = messages.findLastIndex((m) => m.role === "user");
  const results = messages.slice(lastUser + 1).filter((m) => m.role === "tool");
  // OpenClaw flattens the history into one user text: "Tool:<id>: <result>".
  const flat = messages
    .filter((m) => m.role === "user")
    .map((m) => textOf(m.content))
    .join("\n");
  const flatResults = flat.match(/^Tool:[^\s:]+: .*$/gm) ?? [];
  const seen = results.length > 0 ? results.map((m) => textOf(m.content)) : flatResults;
  const unit = seen.join("\n").match(/ca-[a-z0-9-]+/)?.[0] ?? "unknown";
  const steps: ReadonlyArray<readonly [string, object]> = [
    ["list_alarms", {}],
    ["facility_status", {}],
    ["restart_cooling_unit", { unitId: unit }],
    [
      "submit_diagnosis",
      {
        rootCause: unit,
        faultType: "cooling_unit_failure",
        summary: `냉방기 ${unit} 정지로 서버룸 온도가 올랐다. 재시작을 시도했다.`,
        actions: [{ tool: "restart_cooling_unit", unitId: unit }],
        confidence: 0.8,
      },
    ],
  ];
  const step = steps[seen.length];
  const name = step ? find(step[0]) : undefined;
  if (!step || !name) return { text: "진단을 제출했어요." };
  return { call: { id: `call_${++counter}`, name, args: step[1] } };
}

const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };

createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => {
    raw += d;
  });
  req.on("end", () => {
    if (req.method === "GET") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ object: "list", data: [{ id: "scripted", object: "model" }] }));
      return;
    }
    let body: Body = {};
    try {
      body = JSON.parse(raw) as Body;
    } catch {
      // an empty or broken body gets the plain answer
    }
    const step = plan(body);
    const call = "call" in step ? step.call : undefined;
    log(
      `${req.method} ${req.url} stream=${!!body.stream} tools=${body.tools?.length ?? 0} -> ${
        call ? `${call.name} ${JSON.stringify(call.args)}` : "text"
      }`,
    );
    const toolCall = call && {
      index: 0,
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.args) },
    };
    const finish = call ? "tool_calls" : "stop";
    if (!body.stream) {
      const message = call
        ? { role: "assistant", content: null, tool_calls: [toolCall] }
        : { role: "assistant", content: "text" in step ? step.text : "" };
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "chatcmpl-stub",
          object: "chat.completion",
          created: 0,
          model: "scripted",
          choices: [{ index: 0, message, finish_reason: finish }],
          usage,
        }),
      );
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const chunk = (choices: unknown[], extra: object = {}) =>
      res.write(
        `data: ${JSON.stringify({ id: "chatcmpl-stub", object: "chat.completion.chunk", created: 0, model: "scripted", choices, ...extra })}\n\n`,
      );
    chunk([{ index: 0, delta: { role: "assistant", content: call ? null : "" } }]);
    chunk([
      {
        index: 0,
        delta: toolCall ? { tool_calls: [toolCall] } : { content: "text" in step ? step.text : "" },
      },
    ]);
    chunk([{ index: 0, delta: {}, finish_reason: finish }]);
    chunk([], { usage });
    res.end("data: [DONE]\n\n");
  });
}).listen(port, "127.0.0.1", () => log(`stub listening ${port}`));
