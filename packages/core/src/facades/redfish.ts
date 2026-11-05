/**
 * Redfish facade: every server has its own BMC service rooted at /redfish/v1 (REQ-002, REQ-003).
 * The profile (by product version) decides member ids, schema generation and allowed reset types.
 */
import { InvalidValueError, NotFoundError } from "@terrarium/core/kernel";
import type { ProfileRegistry } from "@terrarium/core/profiles";
import type { Entity, WorldPort } from "@terrarium/core/world";
import {
  dispatch,
  type FacadeRequest,
  type FacadeResponse,
  type Handler,
  json,
  noContent,
  type Params,
  Router,
} from "./http";
import { noService, speaks } from "./protocols";
import { redfishError } from "./redfish-common";
import { handleFacility } from "./redfish-facility";
import * as log from "./redfish-log";
import { processor, processorCollection } from "./redfish-processors";
import * as r from "./redfish-resources";

export { redfishError };

const BASE = "/redfish/v1";

type Ctx = r.BmcContext;

function expectId(actual: string, expected: string, what: string): void {
  if (actual !== expected) throw new NotFoundError(`no ${what} '${actual}' on this BMC`);
}

function reset(world: WorldPort, ctx: Ctx, body: unknown): FacadeResponse {
  const type = (body as { ResetType?: unknown } | undefined)?.ResetType;
  if (typeof type !== "string" || !ctx.profile.resetTypes.includes(type)) {
    throw new InvalidValueError(`ResetType must be one of ${ctx.profile.resetTypes.join(", ")}`);
  }
  const cause = `redfish:${ctx.server.id}:${type}`;
  const on = world.stateAs(ctx.server.id, "server").adminOn;
  if (type === "Nmi") world.apply({ type: "note", text: `NMI sent to ${ctx.server.id}` }, cause);
  else if (type === "ForceOff" || type === "GracefulShutdown")
    world.apply({ type: "power.set", target: ctx.server.id, on: false }, cause);
  else if (type === "PushPowerButton")
    world.apply({ type: "power.set", target: ctx.server.id, on: !on }, cause);
  else {
    if (on && type !== "On")
      world.apply({ type: "power.set", target: ctx.server.id, on: false }, cause);
    world.apply({ type: "power.set", target: ctx.server.id, on: true }, cause);
  }
  return noContent();
}

function powerSupplies(ctx: Ctx, index?: number): FacadeResponse {
  const s = ctx.world.stateAs(ctx.server.id, "server");
  const base = `${ctx.base}/Chassis/${r.ids(ctx).chassis}/PowerSubsystem/PowerSupplies`;
  if (index === undefined) {
    return json(200, {
      "@odata.id": base,
      "@odata.type": "#PowerSupplyCollection.PowerSupplyCollection",
      Name: "Power Supplies",
      Members: s.psuOk.map((_, i) => ({ "@odata.id": `${base}/${i}` })),
      "Members@odata.count": s.psuOk.length,
    });
  }
  const ok = s.psuOk[index];
  if (ok === undefined) throw new NotFoundError(`no power supply ${index}`);
  return json(200, {
    "@odata.id": `${base}/${index}`,
    "@odata.type": "#PowerSupply.v1_8_0.PowerSupply",
    Id: String(index),
    Name: `PS${index + 1}`,
    Status: { State: ok && s.powered ? "Enabled" : "Absent", Health: ok ? "OK" : "Critical" },
  });
}

/** A handler that first checks the `:id` path parameter against this BMC's member id. */
function guarded(
  expected: string,
  what: string,
  respond: (req: FacadeRequest, params: Params) => FacadeResponse,
): Handler {
  return (req, params) => {
    expectId(params.id as string, expected, what);
    return respond(req, params);
  };
}

function legacyRoutes(router: Router, ctx: Ctx): void {
  const cid = r.ids(ctx).chassis;
  router
    .on(
      "GET",
      `${BASE}/Chassis/:id/Thermal`,
      guarded(cid, "chassis", () => json(200, r.thermal(ctx))),
    )
    .on(
      "GET",
      `${BASE}/Chassis/:id/Power`,
      guarded(cid, "chassis", () => json(200, r.power(ctx))),
    );
}

function subsystemRoutes(router: Router, ctx: Ctx): void {
  const cid = r.ids(ctx).chassis;
  const chassis = `${BASE}/Chassis/:id`;
  router
    .on(
      "GET",
      `${chassis}/ThermalSubsystem`,
      guarded(cid, "chassis", () => json(200, r.thermalSubsystem(ctx))),
    )
    .on(
      "GET",
      `${chassis}/ThermalSubsystem/ThermalMetrics`,
      guarded(cid, "chassis", () => json(200, r.thermalMetrics(ctx))),
    )
    .on(
      "GET",
      `${chassis}/ThermalSubsystem/Fans`,
      guarded(cid, "chassis", () => json(200, r.fanCollection(ctx))),
    )
    .on(
      "GET",
      `${chassis}/ThermalSubsystem/Fans/:fan`,
      guarded(cid, "chassis", (_q, p) => {
        const body = r.fan(ctx, Number(p.fan));
        if (!body) throw new NotFoundError(`no fan ${p.fan}`);
        return json(200, body);
      }),
    )
    .on(
      "GET",
      `${chassis}/PowerSubsystem`,
      guarded(cid, "chassis", () => json(200, r.powerSubsystem(ctx))),
    )
    .on(
      "GET",
      `${chassis}/PowerSubsystem/PowerSupplies`,
      guarded(cid, "chassis", () => powerSupplies(ctx)),
    )
    .on(
      "GET",
      `${chassis}/PowerSubsystem/PowerSupplies/:psu`,
      guarded(cid, "chassis", (_q, p) => powerSupplies(ctx, Number(p.psu))),
    );
}

function logRoutes(router: Router, ctx: Ctx): void {
  const sid = r.ids(ctx).system;
  const logs = `${BASE}/Systems/:id/LogServices`;
  router
    .on(
      "GET",
      logs,
      guarded(sid, "system", () => json(200, log.logServices(ctx))),
    )
    .on(
      "GET",
      `${logs}/EventLog`,
      guarded(sid, "system", () => json(200, log.logService(ctx))),
    )
    .on(
      "GET",
      `${logs}/EventLog/Entries`,
      guarded(sid, "system", () => json(200, log.eventLog(ctx))),
    )
    .on(
      "GET",
      `${logs}/EventLog/Entries/:entry`,
      guarded(sid, "system", (_q, p) => {
        const entry = log.eventLogEntry(ctx, p.entry as string);
        if (!entry) throw new NotFoundError(`no log entry ${p.entry}`);
        return json(200, entry);
      }),
    );
}

function routes(world: WorldPort, ctx: Ctx): Router {
  const { system: sid, chassis: cid, manager: mid } = r.ids(ctx);
  const router = new Router()
    .on("GET", BASE, () => json(200, r.serviceRoot(ctx)))
    .on("GET", `${BASE}/Systems`, () => json(200, r.collection(ctx, "Systems")))
    .on("GET", `${BASE}/Chassis`, () => json(200, r.collection(ctx, "Chassis")))
    .on("GET", `${BASE}/Managers`, () => json(200, r.collection(ctx, "Managers")))
    .on("GET", `${BASE}/SessionService`, () => json(200, r.sessionService(ctx)))
    .on("GET", `${BASE}/SessionService/Sessions`, () => json(200, r.sessions(ctx)))
    .on(
      "GET",
      `${BASE}/Systems/:id`,
      guarded(sid, "system", () => json(200, r.system(ctx))),
    )
    .on(
      "GET",
      `${BASE}/Systems/:id/Processors`,
      guarded(sid, "system", () => json(200, processorCollection(ctx))),
    )
    .on(
      "GET",
      `${BASE}/Systems/:id/Processors/:cpu`,
      guarded(sid, "system", (_q, p) => {
        const body = processor(ctx, p.cpu as string);
        if (!body) throw new NotFoundError(`no processor ${p.cpu}`);
        return json(200, body);
      }),
    )
    .on(
      "POST",
      `${BASE}/Systems/:id/Actions/ComputerSystem.Reset`,
      guarded(sid, "system", (q) => reset(world, ctx, q.body)),
    )
    .on(
      "GET",
      `${BASE}/Chassis/:id`,
      guarded(cid, "chassis", () => json(200, r.chassis(ctx))),
    )
    .on(
      "GET",
      `${BASE}/Managers/:id`,
      guarded(mid, "manager", () => json(200, r.manager(ctx))),
    );
  if (ctx.profile.thermalSchema !== "subsystem") legacyRoutes(router, ctx);
  if (ctx.profile.thermalSchema !== "legacy") subsystemRoutes(router, ctx);
  if (ctx.profile.supportsEventLog) logRoutes(router, ctx);
  return router;
}

export class RedfishFacade {
  constructor(
    private readonly world: WorldPort,
    private readonly profiles: ProfileRegistry,
  ) {}

  /** Handle a request to the Redfish service of `id`: a server's BMC, or the controller of power or cooling equipment. */
  handle(id: string, req: FacadeRequest): FacadeResponse {
    const entity = this.world.index.find(id);
    if (!entity || !speaks(entity.kind, "redfish"))
      return redfishError(404, noService(entity, id, "redfish"));
    return entity.kind === "server"
      ? this.bmc(entity, req)
      : handleFacility(this.world, entity, req);
  }

  private bmc(server: Entity, req: FacadeRequest): FacadeResponse {
    const serverId = server.id;
    if (this.world.faultsOn(serverId).some((f) => f.type === "bmc_unresponsive")) {
      return redfishError(504, `BMC of ${server.name} did not respond`);
    }
    if (!this.world.stateAs(serverId, "server").powered)
      return redfishError(503, `BMC of ${server.name} has no power`);
    const profileKey =
      typeof server.props.bmcProfile === "string" ? server.props.bmcProfile : undefined;
    const ctx: Ctx = {
      world: this.world,
      server,
      profile: this.profiles.get("redfish", profileKey),
      base: BASE,
    };
    return dispatch(routes(this.world, ctx), req, redfishError);
  }
}
