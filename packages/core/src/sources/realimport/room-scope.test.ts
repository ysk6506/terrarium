import { Catalog } from "@terrarium/core/catalog";
import { describe, expect, test } from "vitest";
import { importReality, MemorySource, sampleGraph } from ".";

const run = (rooms: string[]) =>
  importReality(new MemorySource("sample", sampleGraph()), {
    siteName: "샘플",
    catalog: new Catalog(),
    rooms,
  });

describe("a room filter that matches nothing is an error that names the choices [REQ-010]", () => {
  test("the message says what was asked and which rooms exist", async () => {
    await expect(run(["없는방-zzz"])).rejects.toThrow(
      /"없는방-zzz"에 맞는 서버룸이 없어요.*있는 서버룸: /,
    );
  });

  test("a filter that matches something still imports", async () => {
    const all = await run([]);
    const room = all.blueprint.entities.find((e) => e.kind === "room");
    const some = await run([room?.name ?? ""]);
    expect(some.blueprint.entities.some((e) => e.kind === "room")).toBe(true);
  });
});
