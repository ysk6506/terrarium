/** core.facades: Redfish/vCenter/vROps request/response translation over a world port (REQ-002, REQ-003, REQ-008). */
export { BacnetFacade, type BacnetRequest, type BacnetService } from "./bacnet";
export {
  ERROR_CLASS as BACNET_ERROR_CLASS,
  ERROR_CODE as BACNET_ERROR_CODE,
  OBJECT_TYPE_ID as BACNET_OBJECT_TYPE_ID,
  PROPERTY_ID as BACNET_PROPERTY_ID,
  UNITS as BACNET_UNITS,
} from "./bacnet-core";
export { createFacades, type FacadeOptions, type Facades } from "./bundle";
export {
  dispatch,
  type FacadeRequest,
  type FacadeResponse,
  type Handler,
  json,
  type Method,
  noContent,
  type Params,
  Router,
  SIM_EPOCH_MS,
  simTimeIso,
  simTimeMs,
  stableUuid,
} from "./http";
export type { CliRequest, CliResponse, HttpApiResponse } from "./network";
export { NetworkFacade } from "./network";
export { type Protocol, protocolsOf, speaks } from "./protocols";
export { RedfishFacade, redfishError } from "./redfish";
export { reportedInlet, serialOf } from "./redfish-resources";
export { SnmpFacade, type SnmpOperation, type SnmpRequest, type SnmpResponse } from "./snmp";
export { VcenterFacade, vcenterError } from "./vcenter";
export { VropsFacade, vropsError } from "./vrops";
