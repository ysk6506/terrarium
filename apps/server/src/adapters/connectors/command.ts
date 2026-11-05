/**
 * An agent that is a program (REQ-051, ADR-0042): a command-line tool or a script, run once for each run
 * with the task and the address of that run's tools handed over as arguments and environment variables.
 * It runs programs on the server, so it can only be written in the server's config file, never from the
 * screen or the API.
 */
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import type {
  AgentInfo,
  AgentRunOutcome,
  AgentRunRequest,
  HarnessInfo,
  HarnessPort,
} from "@terrarium/core/experiments";
import { z } from "zod";
import { base, EnvName } from "./fields";
import { defineConnector } from "./types";
import { fillText, snippet, varsOf } from "./util";

const schema = z
  .object({
    ...base("command"),
    /** The program and its arguments; {{prompt}}, {{mcpUrl}} … are filled in. No shell is involved. */
    command: z.array(z.string().min(1).max(500)).min(1).max(40),
    cwd: z.string().max(500).optional(),
    /** Variables copied from the server's environment into the program's (nothing else is). */
    envPass: z.array(EnvName).max(30).default([]),
    agentId: z.string().min(1).max(64).default("agent"),
    agentName: z.string().max(80).optional(),
    model: z.string().max(80).optional(),
  })
  .strict();

export type CommandConfig = z.output<typeof schema>;

/** What the program inherits from the server whatever else is set: enough to find and run things. */
const BASE_ENV = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "SystemRoot"];
const KILL_AFTER_MS = 5_000;
const TAIL = 4_000;

/** Whether the program can be found: by its own path, or on the PATH of the server. */
export function findProgram(program: string, env: NodeJS.ProcessEnv): string | undefined {
  const candidates = program.includes(path.sep)
    ? [program]
    : (env.PATH ?? "").split(path.delimiter).map((dir) => path.join(dir, program));
  return candidates.find((file) => {
    try {
      accessSync(file, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export class CommandAgent implements HarnessPort {
  readonly info: HarnessInfo;

  constructor(
    private readonly config: CommandConfig,
    private readonly env: NodeJS.ProcessEnv,
  ) {
    this.info = {
      id: config.id,
      name: config.name,
      kind: "command",
      description: config.description || "서버에서 명령으로 실행되는 에이전트.",
      toolTransport: "mcp",
      telemetry: "none",
    };
  }

  async agents(): Promise<readonly AgentInfo[]> {
    const program = this.config.command[0] as string;
    if (!findProgram(program, this.env))
      throw new Error(
        `명령 '${program}'을 찾을 수 없어요 (서버의 PATH에 있거나 전체 경로여야 해요)`,
      );
    const c = this.config;
    return [
      {
        id: c.agentId,
        name: c.agentName ?? c.name,
        ...(c.model ? { model: c.model } : {}),
        ...(c.description ? { description: c.description } : {}),
      },
    ];
  }

  private environment(req: AgentRunRequest): NodeJS.ProcessEnv {
    const copy = (names: readonly string[]) =>
      Object.fromEntries(
        names.flatMap((n) => (this.env[n] === undefined ? [] : [[n, this.env[n]]])),
      );
    return {
      ...copy(BASE_ENV),
      ...copy(this.config.envPass),
      TERRARIUM_RUN_ID: req.runId,
      TERRARIUM_AGENT_ID: req.agentId,
      TERRARIUM_PROMPT: req.prompt,
      TERRARIUM_MCP_URL: req.tools.mcpUrl ?? "",
      TERRARIUM_SEED: String(req.seed),
      TERRARIUM_MAX_TOOL_CALLS: String(req.limits.maxToolCalls),
      TERRARIUM_TIME_LIMIT_SECONDS: String(req.limits.timeLimitSeconds),
      ...(req.traceparent ? { TRACEPARENT: req.traceparent } : {}),
    };
  }

  run(req: AgentRunRequest): Promise<AgentRunOutcome> {
    const [program, ...rest] = this.config.command as [string, ...string[]];
    const vars = varsOf(req);
    const t0 = performance.now();
    return new Promise((resolve) => {
      const child = spawn(
        findProgram(program, this.env) ?? program,
        rest.map((a) => fillText(a, vars)),
        {
          env: this.environment(req),
          ...(this.config.cwd ? { cwd: this.config.cwd } : {}),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      const keep = (chunk: Buffer) => {
        output = (output + chunk.toString("utf8")).slice(-TAIL);
      };
      child.stdout.on("data", keep);
      child.stderr.on("data", keep);
      const stop = () => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS).unref();
      };
      const wall = setTimeout(stop, req.limits.timeLimitSeconds * 1000 + 60_000);
      req.signal.addEventListener("abort", stop, { once: true });
      const done = (outcome: AgentRunOutcome) => {
        clearTimeout(wall);
        req.signal.removeEventListener("abort", stop);
        resolve(outcome);
      };
      child.on("error", (err) =>
        done({ status: "error", message: `명령을 시작하지 못했어요: ${err.message}` }),
      );
      child.on("close", (code, signal) => {
        const harness = { wallSeconds: (performance.now() - t0) / 1000, message: snippet(output) };
        if (req.signal.aborted) return done({ status: "cancelled" });
        if (code === 0) return done({ status: "finished", harness });
        const how = signal ? `신호 ${signal}로 끝났어요` : `종료 코드 ${code}로 끝났어요`;
        done({ status: "error", message: `명령이 ${how}: ${snippet(output)}`, harness });
      });
    });
  }
}

export const commandConnector = defineConnector({
  spec: {
    kind: "command",
    label: "명령줄 에이전트",
    description:
      "실행마다 프로그램을 한 번 띄워요. 과제와 툴 주소는 인자({{prompt}}, {{mcpUrl}})와 환경 변수(TERRARIUM_PROMPT, TERRARIUM_MCP_URL …)로 건네요. 서버에서 프로그램을 실행하므로 서버 설정 파일에서만 쓸 수 있어요.",
    scope: "agent",
    toolTransport: "mcp",
    toolGuide: [
      "실행하는 프로그램에 환경 변수 TERRARIUM_MCP_URL 로 이 실행 전용 툴 주소가 들어가요. 인자에 {{mcpUrl}} 을 쓸 수도 있어요.",
      "프로그램은 테라리움 서버와 같은 컴퓨터에서 돌아요.",
    ],
    fromScreen: false,
    fields: [
      {
        key: "command",
        label: "명령과 인자",
        type: "lines",
        required: true,
        help: "한 줄에 하나(첫 줄이 프로그램). 쓸 수 있는 변수: {{prompt}} {{mcpUrl}} {{runId}} {{seed}}",
      },
      { key: "cwd", label: "작업 폴더", type: "text" },
      {
        key: "envPass",
        label: "넘겨 줄 환경 변수",
        type: "lines",
        help: "서버의 환경 변수 중 프로그램에 넘길 이름. 나머지는 넘기지 않아요.",
      },
      { key: "agentId", label: "에이전트 id", type: "text", default: "agent" },
      { key: "agentName", label: "에이전트 이름", type: "text" },
      { key: "model", label: "모델 이름", type: "text" },
    ],
  },
  schema,
  connect: (config, ctx) => new CommandAgent(config, ctx.env),
});
