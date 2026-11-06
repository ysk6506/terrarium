import { describe, expect, test } from "vitest";
import { presets } from ".";

const memory = (seed: Record<string, string> = {}) => {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};

const OLD = {
  "terrarium.presets.tools.v1": JSON.stringify([
    { id: "a", name: "냉방만", data: ["list_alarms"], savedAt: "2026-11-01T09:00:00Z" },
    {
      id: "b",
      name: "지운 것",
      data: ["wait"],
      savedAt: "2026-11-02T09:00:00Z",
      deletedAt: "2026-11-03T09:00:00Z",
    },
  ]),
  "terrarium.presets.runbook.v1": JSON.stringify([
    { id: "c", name: "절차", data: { title: "x", steps: [] }, savedAt: "2026-11-01T10:00:00Z" },
  ]),
  "terrarium.operation.instructions": JSON.stringify({ 권장: "5분마다 봐요", 빈것: "  " }),
};

describe("what saved things look like on the way to the server [REQ-090] [REQ-080] [REQ-082]", () => {
  test("a text is kept as it is, a list and a runbook as JSON, and they read back the same", () => {
    expect(presets.encode("instruction", "복구 먼저")).toBe("복구 먼저");
    expect(presets.decode("instruction", "복구 먼저")).toBe("복구 먼저");
    const tools = presets.encode("toolset", ["wait", "list_alarms"]);
    expect(presets.decode("toolset", tools)).toEqual(["wait", "list_alarms"]);
    const book = presets.encode("runbook", { title: "t", steps: [] });
    expect(presets.decode("runbook", book)).toEqual({ title: "t", steps: [] });
  });

  test("a body that cannot be read is nothing, not an error", () => {
    expect(presets.decode("toolset", "{not json")).toBeUndefined();
    expect(presets.decode("toolset", '{"a":1}')).toBeUndefined();
    expect(presets.decode("runbook", "[]")).toBeUndefined();
  });

  test("the old localStorage copies are found: tool sets, runbooks and instructions, without the deleted and the empty ones", () => {
    const found = presets.legacyItems(memory(OLD));
    expect(found.map((i) => [i.kind, i.name])).toEqual([
      ["toolset", "냉방만"],
      ["runbook", "절차"],
      ["instruction", "권장"],
    ]);
    expect(found[0]).toMatchObject({ body: '["list_alarms"]', createdAt: "2026-11-01T09:00:00Z" });
    expect(presets.legacyItems(undefined)).toEqual([]);
    expect(presets.legacyItems(memory({ "terrarium.presets.tools.v1": "{not json" }))).toEqual([]);
  });

  test("they are sent once and forgotten; if the server refuses they stay for next time", async () => {
    const store = memory(OLD);
    const sent: unknown[] = [];
    expect(await presets.moveLegacy(store, async (items) => void sent.push(items))).toBe(true);
    expect(sent).toHaveLength(1);
    expect(store.data.size).toBe(0);
    expect(await presets.moveLegacy(store, async (items) => void sent.push(items))).toBe(false);
    expect(sent).toHaveLength(1);

    const kept = memory(OLD);
    expect(
      await presets.moveLegacy(kept, async () => {
        throw new Error("서버가 응답하지 않아요");
      }),
    ).toBe(false);
    expect(kept.data.size).toBe(3);
  });
});
