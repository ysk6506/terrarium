import { DEFAULT_SHAPE } from "@terrarium/core/sources/worldgen";
import { describe, expect, test } from "vitest";
import { testPlatform, YEONSU } from "./test-support/platform";

describe("서비스부터 만든 세계와 템플릿 [REQ-094]", () => {
  test("모양으로 세계를 만들고, 서비스·일감이 세계에 저장된다", async () => {
    const { platform: p } = testPlatform();
    const made = await p.worlds.generate(YEONSU, { shape: { ...DEFAULT_SHAPE, servers: 48 } });
    const service = made.world.blueprint.entities.find((e) => e.kind === "service");
    expect(made.world.origin).toBe("worldgen");
    expect(service?.name).toBe("IAP");
    expect(service?.props.workKind).toBe("interactive");
    expect(made.world.provenance?.shape).toBeDefined();
    expect(made.stats.service).toBe(1);
  });

  test("템플릿은 세계 목록에 끼지 않고 따로 나열되며, 구성을 그대로 담는다", async () => {
    const { platform: p } = testPlatform();
    await p.worlds.generate(YEONSU, { shape: { ...DEFAULT_SHAPE, servers: 48 } });
    const saved = await p.worlds.generate(YEONSU, {
      shape: { ...DEFAULT_SHAPE, servers: 48 },
      template: true,
      name: "우리 IAP",
    });
    expect(saved.world.origin).toBe("template");
    expect((await p.worlds.list()).map((w) => w.origin)).toEqual(["worldgen"]);
    const templates = await p.worlds.templates();
    expect(templates.map((t) => t.name)).toEqual(["우리 IAP"]);
    expect((templates[0]?.provenance?.shape as { servers: number }).servers).toBe(48);
  });
});
