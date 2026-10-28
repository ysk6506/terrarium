/** core.facades: Redfish/vCenter/vROps request/response translation over a world port (REQ-002, REQ-003, REQ-008). */
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
export { RedfishFacade, redfishError } from "./redfish";
export { reportedInlet, serialOf } from "./redfish-resources";
export { VcenterFacade, vcenterError } from "./vcenter";
export { VropsFacade, vropsError } from "./vrops";
