/**
 * CDU resources of the DMTF ThermalEquipment model: a CoolingUnit with its primary (facility water) and
 * secondary (rack loop) coolant connectors and its pumps (REQ-002, ADR-0057). Readings are the world's;
 * what the world does not model (flow, pressure, conductivity, leak sensors) is left out, not made up.
 */
import { NotFoundError } from "@terrarium/core/kernel";
import { json, type Router } from "./http";
import {
  collectionOf,
  type FacilityContext,
  makerOf,
  modelOf,
  reading,
  serialFor,
  statusOf,
} from "./redfish-common";

const root = (ctx: FacilityContext): string => `${ctx.base}/ThermalEquipment`;
const self = (ctx: FacilityContext): string => `${root(ctx)}/CDUs/1`;
const cdu = (ctx: FacilityContext) => ctx.world.stateAs(ctx.entity.id, "cdu");

/** The chiller this CDU takes facility water from, if one is wired to it. */
function chillerOf(ctx: FacilityContext) {
  const link = ctx.world.index.outgoing(ctx.entity.id, "cooling").find((l) => {
    return ctx.world.index.find(l.to)?.kind === "chiller";
  });
  return link ? ctx.world.stateAs(link.to, "chiller") : undefined;
}

function coolingUnit(ctx: FacilityContext): Record<string, unknown> {
  const s = cdu(ctx);
  const m = modelOf(ctx, "cdu");
  const base = self(ctx);
  return {
    "@odata.id": base,
    "@odata.type": "#CoolingUnit.v1_6_0.CoolingUnit",
    Id: "1",
    Name: ctx.entity.name,
    EquipmentType: "CDU",
    Manufacturer: makerOf(ctx, "cdu"),
    Model: m.name,
    SerialNumber: serialFor(ctx.entity.id),
    CoolingCapacityWatts: m.capacityKw * 1000,
    Coolant: { CoolantType: "Water" },
    Status: statusOf(s, s.powered),
    PrimaryCoolantConnectors: { "@odata.id": `${base}/PrimaryCoolantConnectors` },
    SecondaryCoolantConnectors: { "@odata.id": `${base}/SecondaryCoolantConnectors` },
    Pumps: { "@odata.id": `${base}/Pumps` },
  };
}

/** The facility-water side: what the chiller sends in. */
function primary(ctx: FacilityContext): Record<string, unknown> {
  const s = cdu(ctx);
  const chiller = chillerOf(ctx);
  return {
    "@odata.id": `${self(ctx)}/PrimaryCoolantConnectors/1`,
    "@odata.type": "#CoolantConnector.v1_5_0.CoolantConnector",
    Id: "1",
    Name: "Facility water",
    CoolantConnectorType: "Pair",
    Status: statusOf(s, s.powered),
    ...(chiller ? { SupplyTemperatureCelsius: reading(chiller.supplyC) } : {}),
  };
}

/** The rack side: the loop this CDU feeds, with the setpoint it holds. */
function secondary(ctx: FacilityContext): Record<string, unknown> {
  const s = cdu(ctx);
  return {
    "@odata.id": `${self(ctx)}/SecondaryCoolantConnectors/1`,
    "@odata.type": "#CoolantConnector.v1_5_0.CoolantConnector",
    Id: "1",
    Name: "Rack loop",
    CoolantConnectorType: "Pair",
    Status: statusOf(s, s.powered),
    SupplyTemperatureCelsius: reading(s.supplyC),
    ReturnTemperatureCelsius: reading(s.returnC),
    DeltaTemperatureCelsius: reading(s.returnC - s.supplyC),
    HeatRemovedkW: reading(s.loadKw),
    SupplyTemperatureControlCelsius: { SetPoint: s.setpointC },
  };
}

function pump(ctx: FacilityContext, n: number): Record<string, unknown> {
  const s = cdu(ctx);
  const ok = s.pumpsOk[n - 1] ?? false;
  return {
    "@odata.id": `${self(ctx)}/Pumps/${n}`,
    "@odata.type": "#Pump.v1_2_0.Pump",
    Id: String(n),
    Name: `Pump ${n}`,
    PumpType: "Liquid",
    Status: {
      State: s.powered && s.adminOn ? "Enabled" : "Disabled",
      Health: ok ? "OK" : "Critical",
    },
  };
}

function connectorRoutes(router: Router, ctx: FacilityContext): void {
  const base = self(ctx);
  const one = (id: string | undefined): void => {
    if (id !== "1") throw new NotFoundError(`no coolant connector '${id}'`);
  };
  for (const [name, build] of [
    ["PrimaryCoolantConnectors", primary],
    ["SecondaryCoolantConnectors", secondary],
  ] as const) {
    router
      .on("GET", `${base}/${name}`, () =>
        json(
          200,
          collectionOf(
            ctx,
            `/ThermalEquipment/CDUs/1/${name}`,
            "CoolantConnectorCollection",
            name,
            [{ "@odata.id": `${base}/${name}/1` }],
          ),
        ),
      )
      .on("GET", `${base}/${name}/:id`, (_q, p) => {
        one(p.id);
        return json(200, build(ctx));
      });
  }
}

export function thermalRoutes(router: Router, ctx: FacilityContext): void {
  const base = self(ctx);
  const pumps = cdu(ctx).pumpsOk.length;
  router
    .on("GET", root(ctx), () =>
      json(200, {
        "@odata.id": root(ctx),
        "@odata.type": "#ThermalEquipment.v1_2_0.ThermalEquipment",
        Id: "ThermalEquipment",
        Name: "Thermal Equipment",
        CDUs: { "@odata.id": `${root(ctx)}/CDUs` },
        Status: statusOf(cdu(ctx), cdu(ctx).powered),
      }),
    )
    .on("GET", `${root(ctx)}/CDUs`, () =>
      json(
        200,
        collectionOf(ctx, "/ThermalEquipment/CDUs", "CoolingUnitCollection", "CDUs", [
          { "@odata.id": base },
        ]),
      ),
    )
    .on("GET", base, () => json(200, coolingUnit(ctx)))
    .on("GET", `${base}/Pumps`, () =>
      json(
        200,
        collectionOf(
          ctx,
          "/ThermalEquipment/CDUs/1/Pumps",
          "PumpCollection",
          "Pumps",
          Array.from({ length: pumps }, (_, i) => ({ "@odata.id": `${base}/Pumps/${i + 1}` })),
        ),
      ),
    )
    .on("GET", `${base}/Pumps/:n`, (_q, p) => {
      const n = Number(p.n);
      if (!Number.isInteger(n) || n < 1 || n > pumps) throw new NotFoundError(`no pump '${p.n}'`);
      return json(200, pump(ctx, n));
    });
  connectorRoutes(router, ctx);
}
