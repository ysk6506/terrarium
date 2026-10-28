/**
 * The protocol endpoints of one simulated world. A session builds them once, with the product
 * versions its experiment chose, and hands them to the tools (which never pick profiles themselves).
 */
import { ProfileRegistry } from "@terrarium/core/profiles";
import type { WorldPort } from "@terrarium/core/world";
import type { FacadeRequest, FacadeResponse } from "./http";
import { RedfishFacade } from "./redfish";
import { VcenterFacade } from "./vcenter";
import { VropsFacade } from "./vrops";

export interface Facades {
  /** Each server's BMC; the profile comes from the server's `bmcProfile` property. */
  readonly redfish: { handle(serverId: string, req: FacadeRequest): FacadeResponse };
  readonly vcenter: { handle(req: FacadeRequest): FacadeResponse };
  readonly vrops: { handle(req: FacadeRequest): FacadeResponse };
}

export interface FacadeOptions {
  readonly profiles?: ProfileRegistry;
  /** vCenter product version, e.g. "vcenter/7.0"; the default profile when omitted. */
  readonly vcenter?: string;
  /** vROps / Aria Operations product version. */
  readonly vrops?: string;
}

export function createFacades(world: WorldPort, options: FacadeOptions = {}): Facades {
  const profiles = options.profiles ?? new ProfileRegistry();
  return {
    redfish: new RedfishFacade(world, profiles),
    vcenter: new VcenterFacade(world, profiles, options.vcenter),
    vrops: new VropsFacade(world, profiles, options.vrops),
  };
}
