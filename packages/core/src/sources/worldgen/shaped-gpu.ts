/**
 * The accelerator layer of a "서비스부터" world (REQ-107, ADR-0130): the GPUs of the GPU servers the room built, an NVLink
 * domain in each server, the scale-out fabric between them, a scheduler with a training job, and an inference pool. The
 * services that need them depend on them, so a failing GPU is a failing service. Also the parts of the power and cooling
 * choices that are entities of the world and not equipment of the room: a battery pack and a 48 V bus per rack, the rear
 * doors and the immersion tanks.
 */
import { type Catalog, gpuOf } from "@terrarium/core/catalog";
import type { BlueprintIndex, ChipBuild, Entity } from "@terrarium/core/world";
import { type Laying, link } from "./shaped-db";
import type { ServiceDraft } from "./shaped-plan";

type AccelBuild = NonNullable<ChipBuild["accel"]>;

/** The GPU servers the room holds, in a fixed order. */
export const gpuServersOf = (index: BlueprintIndex, catalog: Catalog): Entity[] =>
  index
    .ofKind("server")
    .filter((s) => (s.modelId ? catalog.getOf(s.modelId, "server").gpus > 0 : false))
    .sort((a, b) => a.id.localeCompare(b.id));

const node = (id: string, kind: Entity["kind"], name: string, props: Entity["props"]): Entity => ({
  id,
  kind,
  name,
  props,
});

/** The service a part of the layer serves: the AI card by its key, else the first of the right kind, else the first. */
function serving(services: readonly ServiceDraft[], keys: readonly string[], kind: string) {
  return (
    services.find((s) => keys.includes(s.key.replace(/-\d+$/, ""))) ??
    services.find((s) => (kind === "batch") === (s.kind === "batch")) ??
    services[0]
  );
}

/** The ids of the layer's entities, so the scenarios and the tests can name them. */
export const ACCEL_IDS = {
  fabric: "ib-fabric",
  scheduler: "job-scheduler",
  job: "train-job",
  pool: "serve-pool",
} as const;

/** The GPUs of one server and the NVLink domain that joins them. */
function layServerGpus(
  into: Laying,
  ctx: { readonly catalog: Catalog; readonly build: AccelBuild },
  server: Entity,
): void {
  const model = ctx.catalog.getOf(server.modelId ?? "", "server");
  const chip = gpuOf(model);
  const count = Math.min(ctx.build.gpusPerServer, model.gpus);
  for (let i = 0; i < count; i++) {
    const id = `${server.id}-gpu${i}`;
    into.entities.push(
      node(id, "gpu", `${server.name} GPU${i}`, {
        server: server.id,
        model: chip?.name ?? "NVIDIA GPU",
        memGiB: chip?.memoryGiB ?? 80,
        tdpW: chip?.tdpW ?? 700,
        slot: i,
      }),
    );
    link(into, "member_of", id, server.id);
  }
  const nv = `${server.id}-nvl`;
  into.entities.push(node(nv, "nvlink_domain", `${server.name} NVLink`, { server: server.id }));
  link(into, "member_of", nv, server.id);
}

export function layAccel(
  into: Laying,
  ctx: {
    readonly index: BlueprintIndex;
    readonly catalog: Catalog;
    readonly build: AccelBuild;
    readonly fabric: "ib" | "roce";
    readonly services: readonly ServiceDraft[];
    /** A host for the scheduler (a server no service uses). */
    readonly schedulerHost: string | undefined;
  },
): void {
  const { index, catalog, build } = ctx;
  const servers = gpuServersOf(index, catalog).slice(0, build.servers);
  if (servers.length === 0) return;
  for (const server of servers) layServerGpus(into, ctx, server);
  const nodes = servers.slice(0, Math.max(1, servers.length - build.spares)).map((s) => s.id);
  const spares = servers.slice(nodes.length).map((s) => s.id);
  if (build.fabric) layFabric(into, ctx.fabric, servers, catalog);
  if (build.scheduler && build.job) layJob(into, ctx, { nodes, spares });
  if (build.pool) layPool(into, ctx, build.mode === "server" ? servers.slice(0, 1) : servers);
}

function layFabric(
  into: Laying,
  kind: "ib" | "roce",
  servers: readonly Entity[],
  catalog: Catalog,
) {
  into.entities.push(
    node(ACCEL_IDS.fabric, "ib_fabric", kind === "ib" ? "InfiniBand 패브릭" : "RoCE 패브릭", {
      fabric: kind,
    }),
  );
  for (const server of servers) {
    const chip = gpuOf(catalog.getOf(server.modelId ?? "", "server"));
    const id = `${server.id}-ib`;
    into.entities.push(
      node(id, "ib_link", `${server.name} IB`, { server: server.id, gbps: chip?.nic.gbps ?? 400 }),
    );
    link(into, "member_of", id, ACCEL_IDS.fabric);
  }
}

function layJob(
  into: Laying,
  ctx: { readonly services: readonly ServiceDraft[]; readonly schedulerHost: string | undefined },
  places: { readonly nodes: readonly string[]; readonly spares: readonly string[] },
): void {
  into.entities.push(node(ACCEL_IDS.scheduler, "job_scheduler", "작업 스케줄러(Slurm)", {}));
  if (ctx.schedulerHost) link(into, "hosted_on", ACCEL_IDS.scheduler, ctx.schedulerHost);
  into.entities.push(
    node(ACCEL_IDS.job, "training_job", "학습 잡", {
      nodes: places.nodes.join(","),
      spares: places.spares.join(","),
    }),
  );
  link(into, "member_of", ACCEL_IDS.job, ACCEL_IDS.scheduler);
  const svc = serving(ctx.services, ["training-pipeline"], "batch");
  if (!svc) return;
  const id = `svc-${slug(svc.key)}`;
  link(into, "depends_on", id, ACCEL_IDS.job);
  link(into, "depends_on", id, ACCEL_IDS.scheduler);
  if (into.entities.some((e) => e.id === ACCEL_IDS.fabric))
    link(into, "depends_on", id, ACCEL_IDS.fabric);
}

function layPool(
  into: Laying,
  ctx: { readonly services: readonly ServiceDraft[]; readonly build: AccelBuild },
  servers: readonly Entity[],
): void {
  into.entities.push(
    node(ACCEL_IDS.pool, "inference_pool", "추론 풀", {
      servers: servers.map((s) => s.id).join(","),
      mig: ctx.build.mig,
      load: Math.max(1, servers.length * (ctx.build.mig ? 3 : 0.7)),
    }),
  );
  const svc = serving(ctx.services, ["ai-serving"], "request");
  if (svc) link(into, "depends_on", `svc-${slug(svc.key)}`, ACCEL_IDS.pool);
}

const slug = (key: string): string =>
  key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// ── the entity-level parts of the power and cooling choices ────────────────

/** A battery pack and a 48 V bus in every rack that holds servers (the rack battery choice). */
export function layRackPower(into: Laying, index: BlueprintIndex, catalog: Catalog): void {
  for (const rack of index.ofKind("rack")) layRackOne(into, index, catalog, rack);
}

function layRackOne(into: Laying, index: BlueprintIndex, catalog: Catalog, rack: Entity): void {
  const servers = index.childrenOf(rack.id, "server");
  if (servers.length === 0) return;
  const peakW = servers.reduce((n, s) => n + catalog.getOf(s.modelId ?? "", "server").maxPowerW, 0);
  const bbu = `${rack.id}-bbu`;
  into.entities.push(
    node(bbu, "bbu", `BBU ${rack.name}`, {
      kwh: Math.max(2, Math.round((peakW / 1000) * 0.1 * 10) / 10),
    }),
  );
  link(into, "member_of", bbu, rack.id);
  const bus = `${rack.id}-dc48`;
  into.entities.push(
    node(bus, "dc_bus", `48V DC ${rack.name}`, { ratedW: Math.max(10_000, peakW) }),
  );
  link(into, "member_of", bus, rack.id);
}

/** A rear door on each rear-door rack, an immersion tank record on each tank. */
export function layLiquidParts(into: Laying, index: BlueprintIndex, catalog: Catalog): void {
  for (const rack of index.ofKind("rack")) {
    if (!rack.modelId || !catalog.has(rack.modelId)) continue;
    const model = catalog.get(rack.modelId);
    if (model.kind !== "rack") continue;
    if (model.cooling === "rdhx") {
      const id = `${rack.id}-rdhx`;
      into.entities.push(node(id, "rdhx", `리어도어 ${rack.name}`, {}));
      link(into, "member_of", id, rack.id);
    } else if (model.cooling === "immersion") {
      const id = `${rack.id}-tank`;
      into.entities.push(node(id, "immersion_tank", `침지 탱크 ${rack.name}`, {}));
      link(into, "member_of", id, rack.id);
    }
  }
}
