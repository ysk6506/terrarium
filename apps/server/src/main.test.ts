import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../packages/core/src/world/test-support/sample";
import { run } from "./main";

const dir = mkdtempSync(path.join(tmpdir(), "terrarium-main-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

describe("starting and stopping the server [REQ-030]", () => {
  test("a config file is all it takes; data lives next to it and survives a restart", async () => {
    const port = await freePort();
    const file = path.join(dir, "terrarium.json");
    writeFileSync(
      file,
      JSON.stringify({
        port,
        host: "127.0.0.1",
        workers: 1,
        dataDir: "./state",
        identity: { adminTokenEnv: "TERRARIUM_TEST_ADMIN" },
      }),
    );
    const env = { TERRARIUM_CONFIG: file, TERRARIUM_TEST_ADMIN: "invented-admin-token" };
    const first = await run({ env, logger: false });
    expect(first.url).toBe(`http://127.0.0.1:${port}`);
    const meta = (await (await fetch(`${first.url}/api/meta`)).json()) as {
      harnesses: { id: string }[];
    };
    expect(meta.harnesses.map((h) => h.id)).toEqual(["builtin"]);
    const made = await fetch(`${first.url}/api/worlds`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-terrarium-user": "haneul" },
      body: JSON.stringify({ name: "남는 세계", blueprint: sampleBlueprint() }),
    });
    expect(made.status).toBe(200);
    await first.stop();
    const second = await run({ env, logger: false });
    const worlds = (await (await fetch(`${second.url}/api/worlds`)).json()) as { name: string }[];
    expect(worlds.map((w) => w.name)).toEqual(["남는 세계"]);
    await second.stop();
  }, 60_000);

  test("a config that still lists `sources` stops the start and says to remove it (ADR-0202)", async () => {
    const file = path.join(dir, "old-sources.json");
    writeFileSync(file, JSON.stringify({ sources: [{ kind: "falkordb", id: "kg" }] }));
    await expect(run({ env: { TERRARIUM_CONFIG: file }, logger: false })).rejects.toThrow(
      "sources 설정은 더 쓰지 않아요. 설정에서 지워 주세요 (ADR-0202)",
    );
  });

  test("a broken config stops the start with the reason", async () => {
    const file = path.join(dir, "broken.json");
    writeFileSync(file, JSON.stringify({ port: "eighty" }));
    await expect(run({ env: { TERRARIUM_CONFIG: file }, logger: false })).rejects.toThrow(
      "port 숫자여야 해요 (지금은 문자열이에요)",
    );
  });
});
