/**
 * The vCenter and Aria Operations facades against what the vendor's public API reference says
 * (REQ-003, REQ-061, ADR-0058). Every response a client reads is checked against a schema written from
 * the reference page (tests/spec/vmware-schemas/), for every product version the profiles offer.
 */
import { Catalog } from "@terrarium/core/catalog";
import {
  type FacadeRequest,
  SIM_EPOCH_MS,
  stableUuid,
  VcenterFacade,
  VropsFacade,
} from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { ProfileRegistry } from "@terrarium/core/profiles";
import { World } from "@terrarium/core/world";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";
import * as S from "./vmware-schemas/schemas";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

function problems(schema: object, value: unknown): string[] {
  const validate = ajv.compile(schema);
  validate(value);
  return (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`);
}

const profiles = new ProfileRegistry();

function boot() {
  const world = World.fromBlueprint(sampleBlueprint(), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(600);
  return { world, physics };
}

const get = (path: string, query: Record<string, string> = {}): FacadeRequest => ({
  method: "GET",
  path,
  query,
  headers: {},
});
const post = (path: string, query: Record<string, string> = {}): FacadeRequest => ({
  method: "POST",
  path,
  query,
  headers: {},
});

const each = (schema: object, values: unknown) => {
  const list = values as unknown[];
  expect(list.length).toBeGreaterThan(0);
  for (const [i, v] of list.entries()) expect(problems(schema, v), `item ${i}`).toEqual([]);
};

describe("vCenter answers the way the vSphere Automation API reference says [REQ-003] [REQ-061]", () => {
  test("lists and details match their data structures, for the current and the legacy API", () => {
    const { world } = boot();
    const vc = new VcenterFacade(world, profiles, "vcenter/8.0");
    each(S.VM_SUMMARY, vc.handle(get("/api/vcenter/vm")).body);
    each(S.HOST_SUMMARY, vc.handle(get("/api/vcenter/host")).body);
    each(S.CLUSTER_SUMMARY, vc.handle(get("/api/vcenter/cluster")).body);
    each(S.DATASTORE_SUMMARY, vc.handle(get("/api/vcenter/datastore")).body);
    const info = vc.handle(get("/api/vcenter/vm/vm-db"));
    expect(info.status).toBe(200);
    expect(problems(S.VM_INFO, info.body)).toEqual([]);
    expect(info.body).toMatchObject({ name: "vm-db", cpu: { count: 16 } });

    const legacy = new VcenterFacade(world, profiles, "vcenter/7.0");
    const wrapped = (path: string) => (legacy.handle(get(path)).body as { value: unknown }).value;
    each(S.VM_SUMMARY, wrapped("/rest/vcenter/vm"));
    each(S.HOST_SUMMARY, wrapped("/rest/vcenter/host"));
    expect(problems(S.VM_INFO, wrapped("/rest/vcenter/vm/vm-db"))).toEqual([]);
  });

  test("a session is created with a token, and read back with its three times", () => {
    const vc = new VcenterFacade(boot().world, profiles);
    const created = vc.handle(post("/api/session"));
    expect(created.status).toBe(201);
    expect(problems(S.SESSION_TOKEN, created.body)).toEqual([]);
    expect(problems(S.SESSION_INFO, vc.handle(get("/api/session")).body)).toEqual([]);
  });

  test("a host that cannot be reached is NOT_RESPONDING, never an invented state", () => {
    const { world, physics } = boot();
    const link = world.index.outgoing("srv-a1", "network")[0]?.id as string;
    world.apply(
      { type: "fault.add", fault: { id: "l", type: "link_down", target: link, params: {} } },
      "scenario",
    );
    physics.run(10);
    const hosts = new VcenterFacade(world, profiles).handle(get("/api/vcenter/host")).body as {
      host: string;
      connection_state: string;
    }[];
    each(S.HOST_SUMMARY, hosts);
    expect(hosts.find((h) => h.host === "srv-a1")?.connection_state).toBe("NOT_RESPONDING");
  });

  test("an error is an error type with messages", () => {
    const vc = new VcenterFacade(boot().world, profiles);
    const missing = vc.handle(get("/api/vcenter/vm/ghost"));
    expect(missing.status).toBe(404);
    expect(problems(S.VAPI_ERROR, missing.body)).toEqual([]);
    expect((missing.body as { error_type: string }).error_type).toBe("NOT_FOUND");
  });

  test("the schema check can fail", () => {
    const bad = { vm: "vm-1", name: "x", power_state: "RUNNING", extra: 1 };
    expect(problems(S.VM_SUMMARY, bad).length).toBeGreaterThanOrEqual(2);
    expect(problems(S.VM_INFO, { name: "x", power_state: "POWERED_ON" }).join()).toContain(
      "required",
    );
  });
});

describe("Aria Operations answers the way the operations API reference says [REQ-003] [REQ-061]", () => {
  for (const key of ["vrops/8.10", "aria-ops/8.18"]) {
    test(`${key}: resources, stats, alerts and the token match their data structures`, () => {
      const { world, physics } = boot();
      world.apply(
        {
          type: "fault.add",
          fault: { id: "t", type: "breaker_trip", target: "pdu-a", params: {} },
        },
        "scenario",
      );
      physics.run(10);
      const vrops = new VropsFacade(world, profiles, key);
      const resources = vrops.handle(get("/suite-api/api/resources")).body;
      expect(problems(S.RESOURCES, resources)).toEqual([]);
      const first = (resources as { resourceList: { identifier: string }[] }).resourceList;
      expect(first.length).toBeGreaterThan(3);
      expect(
        problems(
          S.RESOURCE,
          vrops.handle(get(`/suite-api/api/resources/${first[0]?.identifier}`)).body,
        ),
      ).toEqual([]);
      for (const id of ["vm-db", "srv-a1", "cl1"])
        expect(
          problems(
            S.STATS_LATEST,
            vrops.handle(get(`/suite-api/api/resources/${stableUuid(id)}/stats/latest`)).body,
          ),
          id,
        ).toEqual([]);
      const alerts = vrops.handle(get("/suite-api/api/alerts")).body;
      expect(problems(S.ALERTS, alerts)).toEqual([]);
      expect((alerts as { alerts: unknown[] }).alerts.length).toBeGreaterThan(0);
      const token = vrops.handle(post("/suite-api/api/auth/token/acquire")).body;
      expect(problems(S.ACQUIRED_TOKEN, token)).toEqual([]);
    });
  }

  test("the token expires six hours from now, in the form the reference shows", () => {
    const { world } = boot();
    const token = new VropsFacade(world, profiles).handle(post("/suite-api/api/auth/token/acquire"))
      .body as { validity: number; expiresAt: string };
    const now = SIM_EPOCH_MS + Math.round(world.time() * 1000);
    expect(token.validity - now).toBe(6 * 60 * 60 * 1000);
    // "Friday, August 5, 2016 6:22:05 PM UTC": the form on the reference page, and the same moment as `validity`.
    expect(token.expiresAt).toMatch(
      /^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}, \d{4} \d{1,2}:\d{2}:\d{2} [AP]M UTC$/,
    );
    expect(Date.parse(token.expiresAt.replace(" UTC", " GMT"))).toBe(token.validity);
  });

  test("the schema check can fail", () => {
    expect(
      problems(S.RESOURCE, { identifier: "x", resourceHealth: "BLUE" }).length,
    ).toBeGreaterThanOrEqual(3);
    expect(problems(S.ALERT, { alertLevel: "SEVERE" }).length).toBe(1);
    expect(
      problems(S.ACQUIRED_TOKEN, { token: "t", validity: 21_600_000, expiresAt: "never" }).join(),
    ).toContain("roles");
  });
});
