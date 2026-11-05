/**
 * The processors of a server's BMC (REQ-066): one `CPU<n>` per socket and one `GPU<n>` per accelerator, so an
 * agent can ask a host what it carries the way it would ask a real HGX or Dell BMC. A GPU of a model that names
 * its chip (the H100 to B300 servers) says which, how much memory it has and what it may draw; a generic GPU
 * server says only that it has accelerators. They follow the server's health and power.
 */
import { type GpuModel, gpuOf } from "@terrarium/core/catalog";
import { type BmcContext, ids, serialOf, status } from "./redfish-resources";

const MEMORY_TYPE: Readonly<Record<GpuModel["memoryType"], string>> = {
  HBM3: "HBM3",
  HBM3e: "HBM3E",
  HBM4: "HBM4",
};

interface Member {
  readonly id: string;
  readonly body: Record<string, unknown>;
}

function members(ctx: BmcContext): Member[] {
  const model = ctx.world.catalog.getOf(ctx.server.modelId ?? "", "server");
  const s = ctx.world.stateAs(ctx.server.id, "server");
  const base = `${ctx.base}/Systems/${ids(ctx).system}/Processors`;
  const common = (id: string, name: string) => ({
    "@odata.id": `${base}/${id}`,
    "@odata.type": "#Processor.v1_24_0.Processor",
    Id: id,
    Name: name,
    Status: status(s),
  });
  const cpus = Array.from({ length: model.cpuSockets }, (_, i): Member => {
    const id = `CPU${i}`;
    return {
      id,
      body: {
        ...common(id, `Processor ${i}`),
        ProcessorType: "CPU",
        Socket: id,
        TotalCores: model.coresPerSocket,
      },
    };
  });
  const gpu = gpuOf(model);
  const gpus = Array.from({ length: model.gpus }, (_, i): Member => {
    const id = `GPU${i}`;
    return {
      id,
      body: {
        ...common(id, `GPU ${i}`),
        ProcessorType: "GPU",
        SerialNumber: serialOf(`${ctx.server.id}/${id}`),
        ...(gpu
          ? {
              Manufacturer: "NVIDIA",
              Model: gpu.name,
              TDPWatts: gpu.tdpW,
              MemorySummary: { TotalMemorySizeMiB: gpu.memoryGiB * 1024 },
              ProcessorMemory: [
                {
                  CapacityMiB: gpu.memoryGiB * 1024,
                  IntegratedMemory: false,
                  MemoryType: MEMORY_TYPE[gpu.memoryType],
                },
              ],
            }
          : {}),
      },
    };
  });
  return [...cpus, ...gpus];
}

export function processorCollection(ctx: BmcContext): Record<string, unknown> {
  const all = members(ctx);
  return {
    "@odata.id": `${ctx.base}/Systems/${ids(ctx).system}/Processors`,
    "@odata.type": "#ProcessorCollection.ProcessorCollection",
    Name: "Processor Collection",
    Members: all.map((m) => ({ "@odata.id": m.body["@odata.id"] })),
    "Members@odata.count": all.length,
  };
}

/** One CPU or GPU, or undefined when the server has no such processor. */
export function processor(ctx: BmcContext, id: string): Record<string, unknown> | undefined {
  return members(ctx).find((m) => m.id === id)?.body;
}
