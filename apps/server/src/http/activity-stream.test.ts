import type { AddressInfo } from "node:net";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { person, testPlatform } from "../runtime/test-support/platform";
import { buildApp } from "./app";

const WHO = {
  experimentId: "e-1",
  experiment: "냉방 점검",
  owner: "연수",
  harness: "하네스",
  agent: "에이전트",
};

describe("the live view of a world as server-sent events [REQ-050]", () => {
  test("runs already working come first, then what they do as it happens; a world that is not there is a 404", async () => {
    const t = testPlatform();
    const app = buildApp({ platform: t.platform, heartbeatSeconds: 0.05 });
    const world = await t.platform.worlds.create(person("연수"), {
      name: "홀",
      blueprint: sampleBlueprint(),
    });
    const id = world.world.id;
    t.platform.events.emitWorld(id, { type: "start", runId: "r-1", who: WHO });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    try {
      const controller = new AbortController();
      const res = await fetch(`${base}/api/worlds/${id}/activity`, { signal: controller.signal });
      expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let text = "";
      const readUntil = async (needle: string) => {
        while (!text.includes(needle)) {
          const { value, done } = await reader.read();
          if (done) break;
          text += decoder.decode(value);
        }
      };
      await readUntil("event: start");
      t.platform.events.emitWorld(id, {
        type: "call",
        runId: "r-1",
        t: 5,
        tool: "get_entity",
        ok: true,
        effect: "observe",
        targets: ["crah-1"],
      });
      await readUntil("event: call");
      controller.abort();
      expect(text.startsWith("event: start\ndata: ")).toBe(true);
      expect(text).toContain('"targets":["crah-1"]');
      expect((await fetch(`${base}/api/worlds/w-404/activity`)).status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
