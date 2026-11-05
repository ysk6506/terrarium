/**
 * The protocol endpoints of one simulated world. A session builds them once, with the product
 * versions its experiment chose, and hands them to the tools (which never pick profiles themselves).
 */
import { ProfileRegistry } from "@terrarium/core/profiles";
import type { WorldPort } from "@terrarium/core/world";
import { BacnetFacade, type BacnetRequest } from "./bacnet";
import type { FacadeRequest, FacadeResponse } from "./http";
import type { Memo } from "./netos-model";
import { type CliRequest, type CliResponse, type HttpApiResponse, NetworkFacade } from "./network";
import { RedfishFacade } from "./redfish";
import { SnmpFacade, type SnmpRequest, type SnmpResponse } from "./snmp";
import { VcenterFacade } from "./vcenter";
import { VropsFacade } from "./vrops";

export interface Facades {
  /** Each server's BMC (the profile comes from the server's `bmcProfile` property) and the controller of PDUs, panels and CDUs. */
  readonly redfish: { handle(equipmentId: string, req: FacadeRequest): FacadeResponse };
  /** The SNMP agents of UPSes and switches (UPS-MIB, IF-MIB). */
  readonly snmp: { handle(deviceId: string, req: SnmpRequest): SnmpResponse };
  /** The BACnet devices of cooling, plant and power equipment; no device means a Who-Is broadcast. */
  readonly bacnet: {
    handle(deviceId: string | undefined, req: BacnetRequest): Readonly<Record<string, unknown>>;
  };
  /** A switch's command line (SSH) and, by OS, Arista eAPI or Cisco NX-API. */
  readonly network: {
    cli(deviceId: string, req: CliRequest): CliResponse;
    eapi(deviceId: string, body: unknown): HttpApiResponse;
    nxapi(deviceId: string, body: unknown): HttpApiResponse;
  };
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
  // What a person sets on a switch (hostname, port descriptions) is one note per device, shared by its CLI and SNMP agent.
  const memos = new Map<string, Memo>();
  return {
    redfish: new RedfishFacade(world, profiles),
    snmp: new SnmpFacade(world, memos),
    bacnet: new BacnetFacade(world),
    network: new NetworkFacade(world, profiles, memos),
    vcenter: new VcenterFacade(world, profiles, options.vcenter),
    vrops: new VropsFacade(world, profiles, options.vrops),
  };
}
