/** server.http: the HTTP API, live events, MCP endpoints and the web app (REQ-030, REQ-038). */
export { type AppOptions, buildApp } from "./app";
export { HANDLERS, type Handler, type HandlerInput } from "./handlers";
export {
  type Authenticator,
  type AuthRequest,
  authenticatorOf,
  headerAuthenticator,
  type IdentityMode,
  modeOf,
  settingsOf,
} from "./identity";
export { type IdentitySettings, proxyViewer, SELF_HEADER, SELF_ONLY, selfViewer } from "./viewer";
