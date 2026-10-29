/**
 * Who is asking (REQ-033, ADR-0028). Behind the company's SSO proxy, the proxy's header is the truth.
 * Without one, people say who they are (the web asks once and remembers); that is enough for an
 * internal tool where the point is to see whose experiment is whose, not to keep anyone out.
 */
import type { IncomingHttpHeaders } from "node:http";
import { ANONYMOUS, type Viewer } from "../runtime";

/** Header the web sends with the name a person typed (URL-encoded, so Korean names survive). */
export const SELF_HEADER = "x-terrarium-user";

const NAME = /^[^\p{Cc}\s][^\p{Cc}]{0,39}$/u;

function clean(raw: string | string[] | undefined, encoded: boolean): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  let text = value;
  if (encoded) {
    try {
      text = decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  text = text.trim();
  return NAME.test(text) ? text : undefined;
}

export function viewerOf(headers: IncomingHttpHeaders, proxyHeader?: string): Viewer {
  const fromProxy = proxyHeader ? clean(headers[proxyHeader], false) : undefined;
  if (fromProxy) return { name: fromProxy, source: "proxy" };
  if (proxyHeader) return ANONYMOUS;
  const self = clean(headers[SELF_HEADER], true);
  return self ? { name: self, source: "self" } : ANONYMOUS;
}
