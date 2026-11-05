/**
 * PDU and distribution-panel resources of the DMTF PowerEquipment model: PowerDistribution with its mains
 * circuit (breaker state, load), outlets and summary metrics (REQ-002, ADR-0057). A rack PDU is a
 * `RackPDU`, a panelboard a `FloorPDU`. The breaker action maps onto the world's `breaker.reset`.
 */
import { InvalidValueError, NotFoundError } from "@terrarium/core/kernel";
import type { PanelState, PduState } from "@terrarium/core/world";
import { type FacadeRequest, json, noContent, type Router } from "./http";
import {
  collectionOf,
  type FacilityContext,
  makerOf,
  modelOf,
  reading,
  serialFor,
  statusOf,
} from "./redfish-common";
import { outletRoutes } from "./redfish-outlets";

type Feed = PduState | PanelState;

const isPanel = (ctx: FacilityContext): boolean => ctx.entity.kind === "power_panel";
const feed = (ctx: FacilityContext): Feed =>
  isPanel(ctx)
    ? ctx.world.stateAs(ctx.entity.id, "power_panel")
    : ctx.world.stateAs(ctx.entity.id, "pdu");

/** An ORv3 power shelf: a PDU-kind model that feeds a busbar instead of outlets. */
const isShelf = (ctx: FacilityContext): boolean =>
  ctx.entity.kind === "pdu" && modelOf(ctx, "pdu").shelf === true;

/** Where this equipment sits under /PowerEquipment. */
const collectionName = (ctx: FacilityContext): "RackPDUs" | "FloorPDUs" | "PowerShelves" => {
  if (isPanel(ctx)) return "FloorPDUs";
  return isShelf(ctx) ? "PowerShelves" : "RackPDUs";
};

const equipmentType = (ctx: FacilityContext): string => {
  if (isPanel(ctx)) return "FloorPDU";
  return isShelf(ctx) ? "PowerShelf" : "RackPDU";
};
const root = (ctx: FacilityContext): string => `${ctx.base}/PowerEquipment`;
const self = (ctx: FacilityContext): string => `${root(ctx)}/${collectionName(ctx)}/1`;

/** DMTF names a few nominal voltages; one outside the list (380 V) is left out rather than rounded. */
const NOMINAL: Readonly<Record<number, string>> = {
  120: "AC120V",
  208: "AC208V",
  230: "AC230V",
  240: "AC240V",
  277: "AC277V",
  400: "AC400V",
  480: "AC480V",
};

/** Rack PDUs have outlets; a panel has circuits and a power shelf a busbar. */
const hasOutlets = (ctx: FacilityContext): boolean => !isPanel(ctx) && !isShelf(ctx);

/** What the equipment is rated for: a PDU in watts, a panel in amps at its voltage (apparent power follows). */
function ratings(ctx: FacilityContext): {
  watts?: number;
  amps?: number;
  volts?: number;
  va?: number;
} {
  if (isPanel(ctx)) {
    const m = modelOf(ctx, "power_panel");
    return { amps: m.capacityA, volts: m.voltage, va: m.capacityA * m.voltage * Math.sqrt(3) };
  }
  return { watts: modelOf(ctx, "pdu").capacityW };
}

/** How full the equipment is: a panel by current against its rating, a PDU by watts. */
function loadPercent(ctx: FacilityContext): number {
  const s = feed(ctx);
  const r = ratings(ctx);
  if ("loadA" in s && r.amps) return (s.loadA / r.amps) * 100;
  return r.watts ? (s.loadW / r.watts) * 100 : 0;
}

function powerDistribution(ctx: FacilityContext): Record<string, unknown> {
  const s = feed(ctx);
  const model = ctx.world.catalog.get(ctx.entity.modelId ?? "");
  const parent = ctx.entity.parentId ? ctx.world.index.find(ctx.entity.parentId) : undefined;
  const base = self(ctx);
  return {
    "@odata.id": base,
    "@odata.type": "#PowerDistribution.v1_7_0.PowerDistribution",
    Id: "1",
    Name: ctx.entity.name,
    EquipmentType: equipmentType(ctx),
    Manufacturer: makerOf(ctx, ctx.entity.kind === "pdu" ? "pdu" : "power_panel"),
    Model: model.name,
    SerialNumber: serialFor(ctx.entity.id),
    ...(ratings(ctx).va === undefined ? {} : { PowerCapacityVA: Math.round(ratings(ctx).va ?? 0) }),
    Status: statusOf(s, s.powered || s.tripped),
    Location: { PartLocation: { ServiceLabel: parent?.name ?? "", LocationType: "Slot" } },
    Mains: { "@odata.id": `${base}/Mains` },
    Metrics: { "@odata.id": `${base}/Metrics` },
    ...(hasOutlets(ctx) ? { Outlets: { "@odata.id": `${base}/Outlets` } } : {}),
  };
}

function mainsCircuit(ctx: FacilityContext): Record<string, unknown> {
  const s = feed(ctx);
  const r = ratings(ctx);
  const nominal = r.volts === undefined ? undefined : NOMINAL[r.volts];
  const base = `${self(ctx)}/Mains/1`;
  return {
    "@odata.id": base,
    "@odata.type": "#Circuit.v1_10_0.Circuit",
    Id: "1",
    Name: `${ctx.entity.name} main breaker`,
    CircuitType: "Mains",
    VoltageType: "AC",
    BreakerState: s.tripped ? "Tripped" : "Normal",
    PowerState: s.powered ? "On" : "Off",
    PowerEnabled: s.powered,
    PowerWatts: reading(s.loadW, 0),
    PowerLoadPercent: reading(loadPercent(ctx)),
    Status: statusOf(s, s.powered || s.tripped),
    ...(nominal ? { NominalVoltage: nominal } : {}),
    ...(r.volts === undefined ? {} : { Voltage: reading(r.volts, 0) }),
    ...(r.amps === undefined ? {} : { RatedCurrentAmps: r.amps }),
    ...("loadA" in s ? { CurrentAmps: reading(s.loadA) } : {}),
    Actions: {
      "#Circuit.BreakerControl": { target: `${base}/Actions/Circuit.BreakerControl` },
    },
  };
}

function metrics(ctx: FacilityContext): Record<string, unknown> {
  const s = feed(ctx);
  return {
    "@odata.id": `${self(ctx)}/Metrics`,
    "@odata.type": "#PowerDistributionMetrics.v1_5_0.PowerDistributionMetrics",
    Id: "Metrics",
    Name: `${ctx.entity.name} metrics`,
    PowerWatts: reading(s.loadW, 0),
    PowerLoadPercent: reading(loadPercent(ctx)),
  };
}

function breakerControl(ctx: FacilityContext, req: FacadeRequest) {
  const wanted = (req.body as { PowerState?: unknown } | undefined)?.PowerState;
  if (wanted !== "On")
    throw new InvalidValueError(
      "this breaker can only be reset: PowerState must be 'On' (opening a breaker is not supported)",
    );
  ctx.world.apply(
    { type: "breaker.reset", target: ctx.entity.id },
    `redfish:${ctx.entity.id}:BreakerControl`,
  );
  return noContent();
}

export function powerRoutes(router: Router, ctx: FacilityContext): void {
  const base = self(ctx);
  const only1 = (id: string | undefined): void => {
    if (id !== "1") throw new NotFoundError(`no circuit '${id}'`);
  };
  router
    .on("GET", root(ctx), () =>
      json(200, {
        "@odata.id": root(ctx),
        "@odata.type": "#PowerEquipment.v1_2_3.PowerEquipment",
        Id: "PowerEquipment",
        Name: "Power Equipment",
        [collectionName(ctx)]: { "@odata.id": `${root(ctx)}/${collectionName(ctx)}` },
        Status: statusOf(feed(ctx), feed(ctx).powered || feed(ctx).tripped),
      }),
    )
    .on("GET", `${root(ctx)}/${collectionName(ctx)}`, () =>
      json(
        200,
        collectionOf(
          ctx,
          `/PowerEquipment/${collectionName(ctx)}`,
          "PowerDistributionCollection",
          "Power distribution",
          [{ "@odata.id": base }],
        ),
      ),
    )
    .on("GET", base, () => json(200, powerDistribution(ctx)))
    .on("GET", `${base}/Metrics`, () => json(200, metrics(ctx)))
    .on("GET", `${base}/Mains`, () =>
      json(
        200,
        collectionOf(
          ctx,
          `/PowerEquipment/${collectionName(ctx)}/1/Mains`,
          "CircuitCollection",
          "Mains",
          [{ "@odata.id": `${base}/Mains/1` }],
        ),
      ),
    )
    .on("GET", `${base}/Mains/:circuit`, (_q, p) => {
      only1(p.circuit);
      return json(200, mainsCircuit(ctx));
    })
    .on("POST", `${base}/Mains/:circuit/Actions/Circuit.BreakerControl`, (q, p) => {
      only1(p.circuit);
      return breakerControl(ctx, q);
    });
  if (hasOutlets(ctx)) outletRoutes(router, ctx, self(ctx));
}
