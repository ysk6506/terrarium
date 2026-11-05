/** Parts every piece of power or cooling equipment shares when it answers over Redfish (ADR-0057). */
import { type ModelKind, manufacturerOf } from "@terrarium/core/catalog";
import { hashHex } from "@terrarium/core/kernel";
import type { Entity, EntityState, WorldPort } from "@terrarium/core/world";
import { type FacadeResponse, json } from "./http";

export const FACILITY_BASE = "/redfish/v1";

/** What a resource builder needs: the world, the equipment, and where it is mounted. */
export interface FacilityContext {
  readonly world: WorldPort;
  readonly entity: Entity;
  readonly base: string;
}

const HEALTH = { ok: "OK", warning: "Warning", critical: "Critical" } as const;

/** Redfish `Status` of a piece of equipment; `fed` says whether it has power to answer at all. */
export function statusOf(state: EntityState, fed = true): { State: string; Health: string } {
  return { State: fed ? "Enabled" : "UnavailableOffline", Health: HEALTH[state.health] };
}

/** A reading in the shape DMTF's sensor excerpts take. */
export const reading = (value: number, digits = 1): { Reading: number } => ({
  Reading: Math.round(value * 10 ** digits) / 10 ** digits,
});

/** The catalog model of this equipment, of the kind the caller expects. */
export const modelOf = <K extends ModelKind>(ctx: FacilityContext, kind: K) =>
  ctx.world.catalog.getOf(ctx.entity.modelId ?? "", kind);

export const makerOf = (ctx: FacilityContext, kind: ModelKind): string =>
  manufacturerOf(modelOf(ctx, kind));

export function serialFor(id: string): string {
  return `TRM${hashHex(`serial:${id}`).slice(0, 7).toUpperCase()}`;
}

export function uuidFor(id: string): string {
  const h = (hashHex(`uuid1:${id}`) + hashHex(`uuid2:${id}`)).toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Collection of references, the way every DMTF collection looks. */
export function collectionOf(
  ctx: FacilityContext,
  path: string,
  type: string,
  name: string,
  members: readonly object[],
): Record<string, unknown> {
  return {
    "@odata.id": `${ctx.base}${path}`,
    "@odata.type": `#${type}.${type}`,
    Name: name,
    Members: members,
    "Members@odata.count": members.length,
  };
}

export function redfishError(status: number, message: string): FacadeResponse {
  const code =
    status === 404
      ? "Base.1.18.ResourceMissingAtURI"
      : status === 400
        ? "Base.1.18.ActionParameterValueNotInList"
        : "Base.1.18.GeneralError";
  return json(status, {
    error: {
      code,
      message,
      "@Message.ExtendedInfo": [{ MessageId: code, Message: message, Severity: "Critical" }],
    },
  });
}
