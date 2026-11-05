/**
 * The outlets of a rack PDU as DMTF `Outlet` resources (REQ-063, ADR-0060). Each outlet is the cable of
 * one device; `Outlet.PowerControl` switches it off or on, which the world sees as `outlet.set` (the
 * device on that cable loses that feed, as if someone had pulled the plug). PowerCycle is not offered: the
 * facade cannot wait between the off and the on, so a cycle would change nothing.
 */
import { InvalidValueError, NotFoundError } from "@terrarium/core/kernel";
import { outletConsumer, outletCount, outletOff } from "@terrarium/core/world";
import { type FacadeRequest, json, noContent, type Router } from "./http";
import { collectionOf, type FacilityContext, statusOf } from "./redfish-common";

const ALLOWED = ["On", "Off"] as const;

function outletNumber(ctx: FacilityContext, text: string | undefined): number {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > outletCount(ctx.world, ctx.entity.id))
    throw new NotFoundError(`no outlet '${text}'`);
  return n;
}

function outlet(ctx: FacilityContext, base: string, n: number): Record<string, unknown> {
  const s = ctx.world.stateAs(ctx.entity.id, "pdu");
  const enabled = !outletOff(ctx.world, ctx.entity.id, n);
  const consumer = outletConsumer(ctx.world, ctx.entity.id, n);
  const self = `${base}/Outlets/${n}`;
  return {
    "@odata.id": self,
    "@odata.type": "#Outlet.v1_5_0.Outlet",
    Id: String(n),
    Name: `Outlet ${n}`,
    ElectricalConsumerNames: consumer ? [consumer.name] : [],
    PowerEnabled: enabled,
    PowerState: enabled && s.powered ? "On" : "Off",
    Status: statusOf(s, s.powered || s.tripped),
    Actions: {
      "#Outlet.PowerControl": {
        target: `${self}/Actions/Outlet.PowerControl`,
        "PowerState@Redfish.AllowableValues": [...ALLOWED],
      },
    },
  };
}

function powerControl(ctx: FacilityContext, n: number, req: FacadeRequest) {
  const wanted = (req.body as { PowerState?: unknown } | undefined)?.PowerState;
  if (wanted !== "On" && wanted !== "Off")
    throw new InvalidValueError(`PowerState must be one of: ${ALLOWED.join(", ")}`);
  ctx.world.apply(
    { type: "outlet.set", target: ctx.entity.id, outlet: n, on: wanted === "On" },
    `redfish:${ctx.entity.id}:Outlets/${n}:PowerControl`,
  );
  return noContent();
}

export function outletRoutes(router: Router, ctx: FacilityContext, base: string): void {
  router
    .on("GET", `${base}/Outlets`, () =>
      json(
        200,
        collectionOf(
          ctx,
          `/PowerEquipment/RackPDUs/1/Outlets`,
          "OutletCollection",
          "Outlets",
          Array.from({ length: outletCount(ctx.world, ctx.entity.id) }, (_, i) => ({
            "@odata.id": `${base}/Outlets/${i + 1}`,
          })),
        ),
      ),
    )
    .on("GET", `${base}/Outlets/:n`, (_q, p) =>
      json(200, outlet(ctx, base, outletNumber(ctx, p.n))),
    )
    .on("POST", `${base}/Outlets/:n/Actions/Outlet.PowerControl`, (q, p) =>
      powerControl(ctx, outletNumber(ctx, p.n), q),
    );
}
