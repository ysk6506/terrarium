import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runRequest } from "../test-support/run-request";
import { commandConnector, findProgram } from "./command";

const dir = mkdtempSync(path.join(tmpdir(), "terrarium-command-"));
const script = (name: string, body: string) => {
  const file = path.join(dir, name);
  writeFileSync(file, body);
  return file;
};

function connect(
  command: string[],
  extra: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = {},
) {
  const parsed = commandConnector.schema.parse({
    kind: "command",
    id: "cmd",
    name: "스크립트",
    command,
    ...extra,
  });
  return commandConnector.connect(parsed, { env: { PATH: process.env.PATH, ...env }, fetch });
}

const node = process.execPath;

describe("an agent that is a program the server runs [REQ-051]", () => {
  test("it is for the config file only, and the program must be findable", async () => {
    expect(commandConnector.spec.fromScreen).toBe(false);
    expect(
      await connect([node, "x"], {
        agentName: "스크립트 에이전트",
        model: "m",
        description: "설명",
      }).agents(),
    ).toEqual([{ id: "agent", name: "스크립트 에이전트", model: "m", description: "설명" }]);
    await expect(connect(["no-such-program-here"]).agents()).rejects.toThrow(
      "명령 'no-such-program-here'을 찾을 수 없어요",
    );
    expect(findProgram("node", { PATH: path.dirname(node) })).toBeDefined();
    expect(findProgram(node, {})).toBe(node);
    expect(findProgram("node", {})).toBeUndefined();
  });

  test("the task and the tools' address arrive as arguments and variables; nothing else of the server's environment does", async () => {
    const file = script(
      "report.js",
      `console.log(JSON.stringify({ argv: process.argv.slice(2), env: {
        prompt: process.env.TERRARIUM_PROMPT, mcp: process.env.TERRARIUM_MCP_URL, seed: process.env.TERRARIUM_SEED,
        trace: process.env.TRACEPARENT, passed: process.env.PASSED, leaked: process.env.SECRET } }));`,
    );
    const out = await connect(
      [node, file, "--task", "{{prompt}}", "--tools={{mcpUrl}}"],
      { envPass: ["PASSED"] },
      { PASSED: "yes", SECRET: "no" },
    ).run(runRequest({ traceparent: "00-a-b-01" }));
    expect(out.status).toBe("finished");
    const seen = JSON.parse(out.harness?.message ?? "{}");
    expect(seen.argv).toEqual([
      "--task",
      '서버 "A"를 조사하라',
      "--tools=https://terrarium.test/mcp/runs/r1/tok",
    ]);
    expect(seen.env).toEqual({
      prompt: '서버 "A"를 조사하라',
      mcp: "https://terrarium.test/mcp/runs/r1/tok",
      seed: "3",
      trace: "00-a-b-01",
      passed: "yes",
    });
  });

  test("a program that fails says how, with the end of what it printed", async () => {
    const file = script("fail.js", `console.error("모델 키가 없어요"); process.exit(3);`);
    const out = await connect([node, file]).run(runRequest());
    expect(out).toMatchObject({
      status: "error",
      message: "명령이 종료 코드 3로 끝났어요: 모델 키가 없어요",
    });
    const killed = script("kill.js", `process.kill(process.pid, "SIGKILL");`);
    expect((await connect([node, killed]).run(runRequest())).message).toContain(
      "신호 SIGKILL로 끝났어요",
    );
  });

  test("a program that cannot start is an error with a reason", async () => {
    const out = await connect([node, "x"], { cwd: path.join(dir, "missing-folder") }).run(
      runRequest(),
    );
    expect(out.status).toBe("error");
    expect(out.message).toContain("명령을 시작하지 못했어요");
  });

  test("stopping a run stops the program", async () => {
    const file = script("wait.js", `setInterval(() => {}, 1000);`);
    const stop = new AbortController();
    const done = connect([node, file]).run(runRequest({ signal: stop.signal }));
    setTimeout(() => stop.abort(), 300);
    expect(await done).toEqual({ status: "cancelled" });
  });
});
