import { Catalog } from "@terrarium/core/catalog";
import { SDN_TEMPLATES } from "@terrarium/core/scenario";
import { DEFAULT_SHAPE, generateShaped, type ShapeSpec } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex, type Layers } from "@terrarium/core/world";
import { describe, expect, it } from "vitest";

const spec = (layers: Partial<Layers>, servers = 120): ShapeSpec => ({
  ...DEFAULT_SHAPE,
  servers,
  layers: { ...DEFAULT_SHAPE.layers, ...layers },
});

describe("만들어진 세계에서 SDN 시나리오가 만들어진다 [REQ-097]", () => {
  for (const network of ["net-sdn", "net-cloud-native"]) {
    it(`${network}: 이 세계에서 쓸 수 있는 시나리오는 모두 에러 없이 만들어지고 서비스를 가리킨다`, () => {
      const bp = generateShaped(spec({ network }), new Catalog()).blueprint;
      const index = new BlueprintIndex(bp);
      const built = SDN_TEMPLATES.filter((t) => t.unavailable(index) === undefined);
      expect(built.length).toBe(network === "net-sdn" ? 3 : 6);
      for (const t of built) {
        const doc = t.build(index, "w");
        const agent = doc.nodes.find((n) => n.type === "agent_task");
        expect(String(agent?.params.prompt ?? ""), t.id).not.toContain("undefined");
        const diagnosis = doc.expectations.find((e) => e.kind === "diagnosis") as unknown as {
          rootCause: string[];
        };
        for (const id of diagnosis.rootCause)
          expect(index.find(id), `${t.id}: ${id}`).toBeDefined();
      }
    });
  }

  it("리프-스파인에는 SDN 시나리오를 만들 수 없다고 이유를 말한다", () => {
    const index = new BlueprintIndex(generateShaped(spec({}), new Catalog()).blueprint);
    for (const t of SDN_TEMPLATES) expect(t.unavailable(index), t.id).toBeTruthy();
  });
});
