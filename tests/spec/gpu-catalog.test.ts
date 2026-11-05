/**
 * GPU accelerators and the servers that carry them (REQ-066, ADR-0063): the chip table, the H100-to-B300 servers
 * built on it, Vera Rubin as a planned chip with no server yet, and what a BMC says about the GPUs it holds.
 */
import { Catalog, GPU_MODELS, gpuOf, plannedGpus } from "@terrarium/core/catalog";
import { type FacadeRequest, RedfishFacade } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { ProfileRegistry } from "@terrarium/core/profiles";
import { type Blueprint, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint, withChanges } from "../../packages/core/src/world/test-support/sample";
import { crawl, schemaErrors } from "./redfish-schemas/validator";

const catalog = new Catalog();
const KRW_PER_USD = 1343;

const gpuServers = () =>
  catalog.list("server").flatMap((m) => (m.kind === "server" && m.gpuModel ? [m] : []));

const req = (path: string): FacadeRequest => ({
  method: "GET",
  path,
  query: {},
  headers: {},
  body: undefined,
});

/** The sample hall with its first server swapped for `modelId` (placed high in the rack, clear of the rest). */
function withServer(modelId: string): Blueprint {
  const bp = sampleBlueprint();
  const server = bp.entities.find((e) => e.id === "srv-a1") as Blueprint["entities"][number];
  return withChanges(bp, {
    entities: [{ ...server, modelId, placement: { type: "unit", u: 20 } }],
  });
}

function bmc(modelId: string) {
  const world = World.fromBlueprint(withServer(modelId), catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(120);
  return { world, physics, redfish: new RedfishFacade(world, new ProfileRegistry()) };
}

const get = (redfish: RedfishFacade, path: string) => redfish.handle("srv-a1", req(path));

/** The system's own path, found the way a client finds it: from the Systems collection. */
function systemOf(redfish: RedfishFacade): string {
  const list = get(redfish, "/redfish/v1/Systems").body as {
    Members: Array<{ "@odata.id": string }>;
  };
  return list.Members[0]?.["@odata.id"] ?? "";
}

describe("the GPU table [REQ-066]", () => {
  test("H100, H200, B200 and B300 are on sale and carry the figures their datasheets print", () => {
    const shipping = GPU_MODELS.filter((g) => g.status === "shipping");
    expect(shipping.map((g) => g.id)).toEqual(["h100-sxm", "h200-sxm", "b200-sxm", "b300-sxm"]);
    const by = Object.fromEntries(GPU_MODELS.map((g) => [g.id, g]));
    expect(by["h100-sxm"]).toMatchObject({
      memoryGiB: 80,
      memoryType: "HBM3",
      memoryTBps: 3.35,
      tdpW: 700,
      nvlinkGBps: 900,
    });
    expect(by["h200-sxm"]).toMatchObject({ memoryGiB: 141, memoryType: "HBM3e", memoryTBps: 4.8 });
    expect(by["b200-sxm"]).toMatchObject({ memoryGiB: 180, tdpW: 1000, nvlinkGBps: 1800 });
    expect(by["b300-sxm"]).toMatchObject({
      memoryGiB: 288,
      memoryType: "HBM3e",
      nic: { name: "ConnectX-8", gbps: 800 },
    });
    expect(shipping.every((g) => g.firm)).toBe(true);
  });

  test("each generation holds more memory and moves more data than the last", () => {
    const rank = ["h100-sxm", "h200-sxm", "b200-sxm", "b300-sxm"].map(
      (id) => GPU_MODELS.find((g) => g.id === id) as (typeof GPU_MODELS)[number],
    );
    for (const [older, newer] of rank.slice(1).map((g, i) => [rank[i], g] as const)) {
      expect(newer.memoryGiB).toBeGreaterThan(older?.memoryGiB ?? 0);
      expect(newer.memoryTBps).toBeGreaterThanOrEqual(older?.memoryTBps ?? 0);
      expect(newer.nvlinkGBps).toBeGreaterThanOrEqual(older?.nvlinkGBps ?? 0);
      expect(newer.year).toBeGreaterThanOrEqual(older?.year ?? 0);
    }
  });

  test("Vera Rubin is planned for next year, its figures are marked as reported, and no server carries it", () => {
    const planned = plannedGpus();
    expect(planned.map((g) => g.id)).toEqual(["rubin"]);
    expect(planned[0]).toMatchObject({
      generation: "Rubin",
      year: 2027,
      memoryType: "HBM4",
      firm: false,
    });
    for (const server of catalog.list("server"))
      if (server.kind === "server" && server.gpuModel)
        expect(gpuOf(server)?.status, server.id).toBe("shipping");
  });
});

describe("the HGX servers built on it [REQ-066]", () => {
  test("there is a server for every chip that is on sale, and every one names a chip that exists", () => {
    const chips = new Set(gpuServers().map((m) => m.gpuModel));
    expect([...chips].sort()).toEqual(["b200-sxm", "b300-sxm", "h100-sxm", "h200-sxm"]);
    for (const m of gpuServers()) {
      expect(gpuOf(m), m.id).toBeDefined();
      expect(m.gpus, m.id).toBe(8);
    }
  });

  test("a server can feed its GPUs: the chips alone draw less than the server may, and not less than half of it", () => {
    for (const m of gpuServers()) {
      const gpuW = m.gpus * (gpuOf(m)?.tdpW ?? 0);
      expect(m.maxPowerW, m.id).toBeGreaterThan(gpuW);
      expect(gpuW / m.maxPowerW, m.id).toBeGreaterThan(0.5);
    }
  });

  test("a hotter generation needs a bigger air-cooled box, and a liquid-cooled one is the same chip in less room", () => {
    const air = (id: string) => catalog.getOf(id, "server");
    expect(air("ax-10u-b200-air").uHeight).toBeGreaterThan(air("ax-8u-h200-air").uHeight);
    expect(air("ax-8u-b300-air").maxPowerW).toBeGreaterThan(air("ax-8u-h200-air").maxPowerW);
    const dlc = air("ax-4u-b300-dlc");
    expect(dlc).toMatchObject({ cooling: "dlc", gpuModel: "b300-sxm" });
    expect(dlc.liquidShare).toBeGreaterThan(0.8);
    expect(dlc.uHeight).toBeLessThan(air("ax-8u-b300-air").uHeight);
  });

  test("prices follow what 8-GPU servers are listed at (2026-09): dearer each generation, within the listed ranges", () => {
    const usd = (id: string) => (catalog.getOf(id, "server").costM * 1e6) / KRW_PER_USD;
    // 8×H200 $319k~467k, 8×B200 $384k~562k, 8×B300 $537k~786k; H100 is an estimate (no current listing).
    expect(usd("ax-8u-h200-air")).toBeGreaterThan(319_000);
    expect(usd("ax-8u-h200-air")).toBeLessThan(467_000);
    expect(usd("ax-10u-b200-air")).toBeGreaterThan(384_000);
    expect(usd("ax-10u-b200-air")).toBeLessThan(562_000);
    expect(usd("ax-8u-b300-air")).toBeGreaterThan(537_000);
    expect(usd("ax-8u-b300-air")).toBeLessThan(786_000);
    expect(usd("ax-8u-h100-air")).toBeLessThan(usd("ax-8u-h200-air"));
    expect(usd("ax-8u-h200-air")).toBeLessThan(usd("ax-10u-b200-air"));
    expect(usd("ax-10u-b200-air")).toBeLessThan(usd("ax-8u-b300-air"));
    expect(usd("ax-8u-b300-air")).toBeLessThan(usd("ax-4u-b300-dlc"));
  });
});

describe("what a BMC says about its GPUs [REQ-066] [REQ-002]", () => {
  test("a B300 server lists two CPUs and eight GPUs, and each GPU says what it is", () => {
    const { redfish } = bmc("ax-8u-b300-air");
    const list = get(redfish, `${systemOf(redfish)}/Processors`).body as {
      Members: Array<{ "@odata.id": string }>;
      "Members@odata.count": number;
    };
    expect(list["Members@odata.count"]).toBe(10);
    expect(list.Members.map((m) => m["@odata.id"].split("/").pop())).toEqual([
      "CPU0",
      "CPU1",
      ...Array.from({ length: 8 }, (_, i) => `GPU${i}`),
    ]);
    const gpu = get(redfish, `${systemOf(redfish)}/Processors/GPU3`).body as Record<
      string,
      unknown
    >;
    expect(gpu).toMatchObject({
      ProcessorType: "GPU",
      Manufacturer: "NVIDIA",
      Model: "NVIDIA B300 288GB",
      TDPWatts: 1100,
      MemorySummary: { TotalMemorySizeMiB: 294_912 },
      ProcessorMemory: [{ CapacityMiB: 294_912, MemoryType: "HBM3E" }],
    });
    expect(gpu.SerialNumber).toMatch(/^TRM[0-9A-F]{7}$/);
    expect(schemaErrors(gpu)).toEqual([]);
    const other = get(redfish, `${systemOf(redfish)}/Processors/GPU4`).body as Record<
      string,
      unknown
    >;
    expect(other.SerialNumber).not.toBe(gpu.SerialNumber);
    expect(get(redfish, `${systemOf(redfish)}/Processors/CPU1`).body).toMatchObject({
      ProcessorType: "CPU",
      TotalCores: 64,
    });
  });

  test("every resource the GPU server links to conforms to the DMTF schemas", () => {
    const { redfish } = bmc("ax-8u-b300-air");
    const result = crawl((path) => {
      const r = redfish.handle("srv-a1", req(path));
      return { status: r.status, body: r.body };
    });
    expect(result.invalid).toEqual({});
    expect(result.broken).toEqual({});
    expect(result.visited.some((p) => p.endsWith("/Processors/GPU7"))).toBe(true);
  });

  test("the liquid-cooled B300 server is refused in an air-cooled rack, like every other liquid-cooled server", () => {
    expect(() => bmc("ax-4u-b300-dlc")).toThrow(/수랭/);
  });

  test("a GPU server that does not name its chip says only that it has accelerators; a CPU-only server has none", () => {
    const generic = bmc("srv-4u-gpu").redfish;
    const gpu = get(generic, `${systemOf(generic)}/Processors/GPU0`).body as Record<
      string,
      unknown
    >;
    expect(gpu).toMatchObject({ ProcessorType: "GPU" });
    expect(gpu).not.toHaveProperty("Model");
    expect(schemaErrors(gpu)).toEqual([]);
    const cpuOnly = bmc("srv-1u-compute").redfish;
    const plain = get(cpuOnly, `${systemOf(cpuOnly)}/Processors`).body as Record<string, unknown>;
    expect(plain["Members@odata.count"]).toBe(2);
  });

  test("a processor that is not there is a 404, and a GPU follows its server's health", () => {
    const { world, physics, redfish } = bmc("ax-8u-h100-air");
    expect(get(redfish, `${systemOf(redfish)}/Processors/GPU8`).status).toBe(404);
    expect(get(redfish, `${systemOf(redfish)}/Processors/GPU0`).body).toMatchObject({
      Status: { State: "Enabled", Health: "OK" },
    });
    world.apply(
      { type: "fault.add", fault: { id: "f1", type: "fan_failure", target: "srv-a1", params: {} } },
      "test",
    );
    physics.run(600);
    const health = world.stateAs("srv-a1", "server").health;
    const reported = (
      get(redfish, `${systemOf(redfish)}/Processors/GPU0`).body as {
        Status: { Health: string };
      }
    ).Status.Health;
    expect(reported).toBe(health === "ok" ? "OK" : health === "warning" ? "Warning" : "Critical");
  });
});
