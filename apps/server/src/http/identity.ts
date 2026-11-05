/**
 * Who is asking, as a slot (REQ-033, ADR-0044). Every route asks one `Authenticator`; which one is a
 * choice made once, at start. Two are built in: the company's SSO proxy header, and a name people type
 * when there is no proxy (ADR-0028). A sign-in the server checks itself (OIDC, SAML, a bearer token from
 * the company's identity provider) is a third that plugs into the same slot and changes nothing else:
 * write the class, return it from `authenticatorOf`, give it a place in the `identity` settings.
 *
 * Out of its reach on purpose: the per-run tool endpoints (`/mcp/runs/:runId/:token`) and shared report
 * links (`/r/:token`). Their secret is in the address, and the programs and people who use them have no
 * browser session to sign in with.
 */
import type { IncomingHttpHeaders } from "node:http";
import type { FastifyInstance } from "fastify";
import type { Viewer } from "../runtime";
import { viewerOf } from "./viewer";

/** What an authenticator may look at. Headers carry cookies and bearer tokens alike. */
export interface AuthRequest {
  readonly headers: IncomingHttpHeaders;
}

export interface Authenticator {
  /** Names the method in logs and settings. */
  readonly kind: string;
  /**
   * The person asking. Answers `ANONYMOUS` for nobody; throws `UnauthenticatedError` (401) when this
   * method does not serve strangers, or `UnavailableError` (503) when the identity provider cannot be
   * reached. May be asynchronous: checking a token may mean fetching the provider's keys.
   */
  authenticate(req: AuthRequest): Viewer | Promise<Viewer>;
  /** Routes of the sign-in flow itself (the provider's callback, logout), added to the server once. */
  mount?(app: FastifyInstance): void;
}

/** The two methods that need no more than the request's headers (ADR-0028). */
export function headerAuthenticator(proxyHeader?: string): Authenticator {
  return {
    kind: proxyHeader ? "proxy-header" : "self-declared",
    authenticate: (req) => viewerOf(req.headers, proxyHeader),
  };
}

/** The method the settings ask for. The one place a new method is added to. */
export function authenticatorOf(identity: { readonly header?: string }): Authenticator {
  return headerAuthenticator(identity.header);
}
