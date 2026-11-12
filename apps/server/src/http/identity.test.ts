import { UnauthenticatedError } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import { parseConfig } from "../adapters";
import { ANONYMOUS } from "../runtime";
import { person, testPlatform } from "../runtime/test-support/platform";
import { buildApp } from "./app";
import { type Authenticator, authenticatorOf } from "./identity";

/** A stand-in for the company's identity provider: a bearer token that maps to a login. */
function sso(logins: Record<string, string>, strict = false): Authenticator & { mounted: number } {
  const me = {
    kind: "fake-sso",
    mounted: 0,
    mount(app: Parameters<NonNullable<Authenticator["mount"]>>[0]) {
      me.mounted++;
      app.get("/auth/callback", async () => ({ signedIn: true }));
    },
    async authenticate(req: { headers: Record<string, string | string[] | undefined> }) {
      await Promise.resolve();
      const login = logins[String(req.headers.authorization ?? "").replace(/^Bearer /, "")];
      if (login) return person(login, "sso");
      if (strict) throw new UnauthenticatedError("로그인이 필요해요");
      return ANONYMOUS;
    },
  };
  return me;
}

function serve(authenticator: Authenticator) {
  const t = testPlatform();
  return buildApp({ platform: t.platform, publicUrl: "https://terrarium.internal", authenticator });
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("who is asking is one slot an SSO can fill [REQ-054]", () => {
  test("a sign-in the server checks itself decides the viewer, and a typed name cannot pretend otherwise", async () => {
    const app = serve(sso({ "tok-1": "s.haneul" }));
    const signedIn = await app.inject({
      method: "GET",
      url: "/api/meta",
      headers: { ...bearer("tok-1"), "x-terrarium-user": encodeURIComponent("사칭") },
    });
    expect(signedIn.json().user).toMatchObject({ id: "s.haneul", name: "s.haneul", source: "sso" });
    const stranger = await app.inject({
      method: "GET",
      url: "/api/meta",
      headers: { "x-terrarium-user": encodeURIComponent("사칭") },
    });
    expect(stranger.json().user).toMatchObject({ id: "anonymous", source: "anonymous" });
  });

  test("a method that refuses strangers answers 401 on routes and on live streams, but not on shared links", async () => {
    const app = serve(sso({ "tok-1": "s.haneul" }, true));
    const refused = await app.inject({ method: "GET", url: "/api/meta" });
    expect(refused.statusCode).toBe(401);
    expect(refused.json().error).toEqual({ code: "unauthenticated", message: "로그인이 필요해요" });
    const stream = await app.inject({ method: "GET", url: "/api/experiments/e1/events" });
    expect(stream.statusCode).toBe(401);
    // A report link carries its own secret; an unknown one is a 404, never a demand to sign in.
    const link = await app.inject({ method: "GET", url: "/r/nope" });
    expect(link.statusCode).toBe(404);
    const ok = await app.inject({ method: "GET", url: "/api/meta", headers: bearer("tok-1") });
    expect(ok.statusCode).toBe(200);
  });

  test("the method may add the routes of its own sign-in flow", async () => {
    const method = sso({});
    const app = serve(method);
    const callback = await app.inject({ method: "GET", url: "/auth/callback" });
    expect(callback.json()).toEqual({ signedIn: true });
    expect(method.mounted).toBe(1);
  });

  test("without an SSO the settings give the proxy header, else a typed name", async () => {
    const identity = (raw: object) => parseConfig({ identity: raw }).identity;
    const env = { PROXY_SECRET: "test-secret-0002" };
    const settings = { header: "x-forwarded-user", proxySecretEnv: "PROXY_SECRET" };
    expect(authenticatorOf(identity(settings), env).kind).toBe("proxy-header");
    expect(authenticatorOf(identity({}), env).kind).toBe("self-declared");
    const proxy = authenticatorOf(identity(settings), env);
    expect(
      proxy.authenticate({
        headers: { "x-forwarded-user": "kim", "x-terrarium-proxy-secret": "test-secret-0002" },
      }),
    ).toEqual(person("kim", "proxy"));
    expect(
      authenticatorOf(identity({}), env).authenticate({
        headers: { "x-terrarium-user": encodeURIComponent("하늘") },
      }),
    ).toEqual(person("하늘"));
  });
});
