import { Catalog } from "@terrarium/core/catalog";
import { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../world/test-support/sample";
import { createFacades, type FacadeRequest, Router, simTimeIso, stableUuid } from ".";

const get = (path: string): FacadeRequest => ({ method: "GET", path, query: {}, headers: {} });
const post = (path: string): FacadeRequest => ({ method: "POST", path, query: {}, headers: {} });

describe("facade router and helpers [REQ-003]", () => {
  test("patterns match case-insensitively, decode parameters and ignore query strings", () => {
    const router = new Router().on("GET", "/a/:id/b", (_q, p) => ({
      status: 200,
      headers: {},
      body: p.id,
    }));
    const found = router.match(get("/A/x%20y/B?z=1"));
    expect(found !== undefined && found !== "method_not_allowed" && found.params.id).toBe("x y");
    expect(router.match(get("/a/1"))).toBeUndefined();
    expect(router.match(post("/a/1/b"))).toBe("method_not_allowed");
  });

  test("stable ids and simulated time are deterministic", () => {
    expect(stableUuid("vm-1")).toBe(stableUuid("vm-1"));
    expect(stableUuid("vm-1")).not.toBe(stableUuid("vm-2"));
    expect(stableUuid("vm-1")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(simTimeIso(90)).toBe("2026-01-01T00:01:30Z");
  });
});

describe("facade bundle [REQ-004]", () => {
  test("a session's product-version choice reaches the facades it builds", () => {
    const world = World.fromBlueprint(sampleBlueprint(), new Catalog());
    expect(
      createFacades(world, { vcenter: "vcenter/7.0" }).vcenter.handle(get("/rest/vcenter/vm"))
        .status,
    ).toBe(200);
    expect(createFacades(world).vcenter.handle(get("/rest/vcenter/vm")).status).toBe(404);
    expect(createFacades(world).redfish.handle("srv-a1", get("/redfish/v1")).status).toBe(200);
    expect(createFacades(world).redfish.handle("rack-a", get("/redfish/v1")).status).toBe(404);
  });
});
