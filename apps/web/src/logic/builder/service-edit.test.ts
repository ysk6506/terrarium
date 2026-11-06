import { type Blueprint, BlueprintIndex, serviceDef } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { addService, servicesOnPlace, supportLine } from "./service-edit";

const base: Blueprint = {
  id: "t",
  name: "t",
  entities: [{ id: "srv-1", kind: "server", name: "서버 1", props: {} }],
  links: [],
} as unknown as Blueprint;

describe("services in the builder [REQ-086]", () => {
  test("a server with no service says so, and adding one is counted on its line", () => {
    expect(supportLine(new BlueprintIndex(base), "srv-1")).toBe("떠받치는 서비스가 아직 없어요");
    const edit = addService(base, "srv-1");
    const index = new BlueprintIndex(edit.blueprint);
    expect(supportLine(index, "srv-1")).toBe("떠받치는 서비스 1개");
    expect(servicesOnPlace(index, "srv-1").map((s) => s.id)).toEqual(edit.select);
  });

  test("a new batch service costs delay and a request service costs money, both marked as guesses", () => {
    const once = addService(base, "srv-1", "batch");
    const twice = addService(once.blueprint, "srv-1", "request");
    const [batch, request] = servicesOnPlace(new BlueprintIndex(twice.blueprint), "srv-1");
    expect(serviceDef(batch as never).harm.delayHours).toBe(2);
    expect(serviceDef(request as never).harm.perHourKrw).toBe(1_000_000);
    expect(serviceDef(request as never).harmEstimated).toBe(true);
    expect(new Set([batch?.id, request?.id]).size).toBe(2);
  });
});
