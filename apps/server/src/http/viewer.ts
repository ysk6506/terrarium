/**
 * Who is asking, read from a request's headers (REQ-033, ADR-0028, ADR-0174). Two ways, chosen once at start:
 *
 * - Behind the company's SSO proxy (`proxyViewer`): the proxy sets the login, and proves it is the proxy with a
 *   secret only it knows. A request without the secret or without a login is nobody; it is never let through as
 *   "anonymous". The login is the id ownership is compared by.
 * - Typed names (`selfViewer`): people say who they are, which only suits one person on their own machine. Admin
 *   needs the token from the environment; with no token configured, only a request from this machine's loopback
 *   address is an administrator's, so one person alone can still do everything.
 *
 * Both turn names into one Unicode form (NFC), so a name typed on one keyboard is the same person on another, and
 * neither accepts "anonymous" in any case: that word is the server's own for "nobody said".
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { AuditReason } from "@terrarium/core/experiments";
import { ANONYMOUS, type Role, type Viewer } from "../runtime";

/** Header the web sends with the name a person typed (URL-encoded, so Korean names survive). */
export const SELF_HEADER = "x-terrarium-user";

/** What the viewer readers need of the `identity` settings, with the secrets already read from the environment. */
export interface IdentitySettings {
  /** Header with the login id. Set: the proxy mode. */
  readonly header?: string | undefined;
  readonly secretHeader: string;
  readonly nameHeader?: string | undefined;
  readonly groupsHeader?: string | undefined;
  readonly admins: readonly string[];
  readonly adminGroup?: string | undefined;
  readonly adminTokenHeader: string;
  /** The value the proxy must send in `secretHeader`. */
  readonly secret?: string | undefined;
  /** The value that makes a typed-name request an administrator's. */
  readonly adminToken?: string | undefined;
  /** Typed-name mode with no token configured: a request from this machine's own loopback address is an administrator's. */
  readonly loopbackAdmin?: boolean | undefined;
}

/** Is this socket address the machine's own (127.0.0.0/8, ::1, or either as an IPv4-mapped IPv6 address)? */
export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.toLowerCase().replace(/^::ffff:/, "");
  return a === "::1" || /^127(\.\d{1,3}){3}$/.test(a);
}

/** Settings with no proxy and no admin token: typed names, nobody an administrator. */
export const SELF_ONLY: IdentitySettings = {
  secretHeader: "x-terrarium-proxy-secret",
  admins: [],
  adminTokenHeader: "x-terrarium-admin-token",
};

const NAME = /^[^\p{Cc}\s][^\p{Cc}]{0,39}$/u;
const GROUP_MAX = 100;
const GROUPS_MAX = 100;

const firstOf = (raw: string | string[] | undefined): string | undefined =>
  Array.isArray(raw) ? raw[0] : raw;

/** A header's text the way a proxy meant it: Node reads bytes as Latin-1, so UTF-8 sent raw is put back together. */
function rawText(raw: string | string[] | undefined): string | undefined {
  const value = firstOf(raw);
  if (!value) return undefined;
  if (/[\u0080-ÿ]/.test(value)) {
    const utf8 = Buffer.from(value, "latin1").toString("utf8");
    if (!utf8.includes("�")) return utf8;
  }
  return value;
}

/** A name or login in its one stored form, or nothing when it is empty, too long, has control characters or is the reserved word. */
export function cleanName(text: string | undefined): string | undefined {
  const name = text?.normalize("NFC").trim();
  if (!name || !NAME.test(name)) return undefined;
  return name.toLowerCase() === ANONYMOUS.id ? undefined : name;
}

/** What a person typed (URL-encoded by the web). */
function typedName(raw: string | string[] | undefined): string | undefined {
  const value = firstOf(raw);
  if (!value) return undefined;
  try {
    return cleanName(decodeURIComponent(value));
  } catch {
    return undefined;
  }
}

function groupsOf(raw: string | string[] | undefined): string[] {
  const text = rawText(raw)?.normalize("NFC");
  if (!text) return [];
  const found = text
    .split(",")
    .map((g) => g.trim())
    .filter((g) => g !== "" && g.length <= GROUP_MAX && !/\p{Cc}/u.test(g));
  return [...new Set(found)].slice(0, GROUPS_MAX);
}

/** Equal secrets, compared in time that does not depend on how many leading characters match. */
export function sameSecret(given: string | undefined, secret: string | undefined): boolean {
  if (given === undefined || secret === undefined || secret === "") return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(secret));
}

/** Everyone signed in is a user; an administrator is one more role. */
const rolesOf = (admin: boolean): Role[] => (admin ? ["user", "admin"] : ["user"]);

/**
 * The person the SSO proxy vouches for, or nothing: a wrong or missing secret, a missing login or the reserved
 * word all give nothing, and nothing is a 401, whatever else the headers say.
 */
export function proxyViewer(headers: IncomingHttpHeaders, s: IdentitySettings): Viewer | undefined {
  if (!s.header || !sameSecret(firstOf(headers[s.secretHeader]), s.secret)) return undefined;
  const id = cleanName(rawText(headers[s.header]));
  if (!id) return undefined;
  const groups = groupsOf(s.groupsHeader ? headers[s.groupsHeader] : undefined);
  const admin =
    s.admins.some((a) => a.normalize("NFC") === id) ||
    (s.adminGroup !== undefined && groups.includes(s.adminGroup.normalize("NFC")));
  const name = (s.nameHeader ? cleanName(rawText(headers[s.nameHeader])) : undefined) ?? id;
  return { id, name, groups, roles: rolesOf(admin), source: "proxy" };
}

/**
 * Why the proxy check refused a request, for the audit log only (the person is told the same words whatever went wrong):
 * no secret at all, a wrong one, or the right one with no usable login.
 */
export function proxyRefusal(
  headers: IncomingHttpHeaders,
  s: IdentitySettings,
): Extract<AuditReason, `proxy_${string}`> {
  const given = firstOf(headers[s.secretHeader]);
  if (given === undefined) return "proxy_secret_missing";
  return sameSecret(given, s.secret) ? "proxy_login_missing" : "proxy_secret_wrong";
}

/** A typed name (nobody when there is none), and an administrator only with the right token. */
export function selfViewer(
  headers: IncomingHttpHeaders,
  s: IdentitySettings,
  address?: string,
): Viewer {
  const name = typedName(headers[SELF_HEADER]);
  // The address is the socket's, never a forwarded header. A configured token always decides; loopback counts only without one.
  const admin =
    s.adminToken !== undefined
      ? sameSecret(firstOf(headers[s.adminTokenHeader]), s.adminToken)
      : s.loopbackAdmin === true && isLoopback(address);
  if (!name) return admin ? { ...ANONYMOUS, roles: rolesOf(true) } : ANONYMOUS;
  return { id: name, name, groups: [], roles: rolesOf(admin), source: "self" };
}
