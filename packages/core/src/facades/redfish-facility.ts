/**
 * Redfish on power and cooling equipment (REQ-002, ADR-0057): the management controller of a PDU, a
 * distribution panel or a CDU answers on its own /redfish/v1, shaped after the DMTF PowerEquipment and
 * ThermalEquipment models (the same schemas real rack-PDU and CDU firmware implements).
 */
import { manufacturerOf } from "@terrarium/core/catalog";
import type { Entity, WorldPort } from "@terrarium/core/world";
import { dispatch, type FacadeRequest, type FacadeResponse, json, Router } from "./http";
import {
  collectionOf,
  FACILITY_BASE,
  type FacilityContext,
  modelOf,
  redfishError,
  uuidFor,
} from "./redfish-common";
import { powerRoutes } from "./redfish-power";
import { thermalRoutes } from "./redfish-thermal";

function serviceRoot(ctx: FacilityContext, root: "PowerEquipment" | "ThermalEquipment") {
  const model = modelOf(
    ctx,
    ctx.entity.kind === "cdu" ? "cdu" : ctx.entity.kind === "pdu" ? "pdu" : "power_panel",
  );
  return {
    "@odata.id": ctx.base,
    "@odata.type": "#ServiceRoot.v1_16_0.ServiceRoot",
    Id: "RootService",
    Name: "Root Service",
    RedfishVersion: "1.17.0",
    UUID: uuidFor(ctx.entity.id),
    Product: model.name,
    Vendor: manufacturerOf(model),
    ...(root === "PowerEquipment"
      ? { PowerEquipment: { "@odata.id": `${ctx.base}/PowerEquipment` } }
      : { ThermalEquipment: { "@odata.id": `${ctx.base}/ThermalEquipment` } }),
    SessionService: { "@odata.id": `${ctx.base}/SessionService` },
    Links: { Sessions: { "@odata.id": `${ctx.base}/SessionService/Sessions` } },
  };
}

function sessionRoutes(router: Router, ctx: FacilityContext): void {
  router
    .on("GET", `${ctx.base}/SessionService`, () =>
      json(200, {
        "@odata.id": `${ctx.base}/SessionService`,
        "@odata.type": "#SessionService.v1_2_0.SessionService",
        Id: "SessionService",
        Name: "Session Service",
        ServiceEnabled: true,
        SessionTimeout: 1800,
        Status: { State: "Enabled", Health: "OK" },
        Sessions: { "@odata.id": `${ctx.base}/SessionService/Sessions` },
      }),
    )
    .on("GET", `${ctx.base}/SessionService/Sessions`, () =>
      json(200, collectionOf(ctx, "/SessionService/Sessions", "SessionCollection", "Sessions", [])),
    );
}

/** The kinds that run a Redfish service, and which root they hang their equipment under. */
const ROOT_OF: Readonly<Record<string, "PowerEquipment" | "ThermalEquipment" | undefined>> = {
  pdu: "PowerEquipment",
  power_panel: "PowerEquipment",
  cdu: "ThermalEquipment",
};

/** A breaker that tripped leaves the controller up (it sits ahead of the breaker); a lost feed does not. */
function reachable(world: WorldPort, entity: Entity): boolean {
  const s = world.stateOf(entity.id);
  if (s.kind === "pdu" || s.kind === "power_panel") return s.powered || s.tripped;
  return s.kind === "cdu" ? s.powered : true;
}

/** Answer a request to the management controller of power or cooling equipment. */
export function handleFacility(
  world: WorldPort,
  entity: Entity,
  req: FacadeRequest,
): FacadeResponse {
  const root = ROOT_OF[entity.kind];
  if (!root) return redfishError(404, `'${entity.id}' has no Redfish service`);
  if (!reachable(world, entity))
    return redfishError(503, `the controller of ${entity.name} has no power`);
  const ctx: FacilityContext = { world, entity, base: FACILITY_BASE };
  const router = new Router().on("GET", ctx.base, () => json(200, serviceRoot(ctx, root)));
  sessionRoutes(router, ctx);
  if (root === "PowerEquipment") powerRoutes(router, ctx);
  else thermalRoutes(router, ctx);
  return dispatch(router, req, redfishError);
}
