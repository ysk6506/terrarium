import { describe, expect, test } from "vitest";
import { SqliteStore } from "./sqlite-store";

const store = () => new SqliteStore(":memory:");

const preset = (id: string, over = {}) => ({
  id,
  owner: "yeon",
  kind: "instruction" as const,
  name: `이름 ${id}`,
  body: "본문",
  createdAt: `2026-11-0${id.length}`,
  ...over,
});

describe("the SQLite store keeps presets, journals, saved cards, models and tables [REQ-030]", () => {
  test("a preset is read back as it was saved, listed by owner and kind, and deleted once", async () => {
    const s = store();
    await s.putPreset(preset("a"));
    await s.putPreset(preset("bb", { kind: "toolset" }));
    await s.putPreset(preset("c", { owner: "other" }));
    expect(await s.getPreset("a")).toEqual(preset("a"));
    expect(await s.getPreset("none")).toBeUndefined();
    expect((await s.listPresets("yeon")).map((p) => p.id)).toEqual(["a", "bb"]);
    expect((await s.listPresets("yeon", "toolset")).map((p) => p.id)).toEqual(["bb"]);
    await s.putPreset(preset("a", { body: "바뀜" }));
    expect((await s.getPreset("a"))?.body).toBe("바뀜");
    expect(await s.deletePreset("a")).toBe(true);
    expect(await s.deletePreset("a")).toBe(false);
    s.close();
  });

  test("a run's journal is appended in order, read back whole with the time of the last write, and deleted", async () => {
    const s = store();
    expect(await s.readJournal("r1")).toEqual({ entries: [] });
    await s.appendJournal("r1", [], "2026-11-01T00:00:00Z");
    expect(await s.readJournal("r1")).toEqual({ entries: [] });
    await s.appendJournal("r1", [["h", "w1", "e1"]], "2026-11-01T00:00:01Z");
    await s.appendJournal(
      "r1",
      [["k", 10, "list_alarms", "2026-11-01T00:00:02Z"]],
      "2026-11-01T00:00:03Z",
    );
    await s.appendJournal("r2", [["h", "w2", "e1"]], "2026-11-01T00:00:09Z");
    const journal = await s.readJournal("r1");
    expect(journal.entries).toEqual([
      ["h", "w1", "e1"],
      ["k", 10, "list_alarms", "2026-11-01T00:00:02Z"],
    ]);
    expect(journal.lastAt).toBe("2026-11-01T00:00:03Z");
    await s.deleteJournal("r1");
    expect(await s.readJournal("r1")).toEqual({ entries: [] });
    expect((await s.readJournal("r2")).entries).toHaveLength(1);
    s.close();
  });

  test("saved models, service cards and current processes are kept by id, in the order they were made", async () => {
    const s = store();
    const model = (id: string, createdAt: string) =>
      ({
        id,
        owner: "yeon",
        name: id,
        kind: "openai",
        baseUrl: "http://x",
        headers: [],
        isDefault: false,
        createdAt,
      }) as never;
    await s.putModel(model("m2", "2026-11-02"));
    await s.putModel(model("m1", "2026-11-01"));
    expect((await s.listModels()).map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(await s.getModel("m2")).toMatchObject({ id: "m2" });
    await s.deleteModel("m2");
    expect(await s.getModel("m2")).toBeUndefined();

    const card = {
      id: "c1",
      owner: "yeon",
      name: "카드",
      card: "web-api",
      shared: false,
      createdAt: "2026-11-01",
    } as never;
    await s.putServiceCard(card);
    expect(await s.getServiceCard("c1")).toMatchObject({ card: "web-api", shared: false });
    expect(await s.listServiceCards()).toHaveLength(1);
    await s.deleteServiceCard("c1");
    expect(await s.listServiceCards()).toEqual([]);

    const process = {
      id: "sc1",
      owner: "yeon",
      steps: [],
      createdAt: "2026-11-01",
      updatedAt: "2026-11-01",
    } as never;
    await s.putCurrentProcess(process);
    expect(await s.getCurrentProcess("sc1")).toMatchObject({ owner: "yeon" });
    expect(await s.getCurrentProcess("none")).toBeUndefined();
    s.close();
  });
});
