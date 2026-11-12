import { describe, expect, test } from "vitest";
import { parseConfig } from "../adapters";
import { testPlatform } from "../runtime/test-support/platform";
import { buildApp } from "./app";
import { authenticatorOf } from "./identity";
import { isLoopback } from "./viewer";

const SECRET = "proxy-secret-for-tests-0002";
const TOKEN = "admin-token-for-tests-0002";
const ENV = { TERRARIUM_TEST_PROXY_SECRET: SECRET, TERRARIUM_TEST_ADMIN_TOKEN: TOKEN };

function serve(identity: object) {
  const t = testPlatform();
  return buildApp({
    platform: t.platform,
    authenticator: authenticatorOf(parseConfig({ identity }).identity, ENV),
  });
}

type App = ReturnType<typeof serve>;
const typed = { "x-terrarium-user": encodeURIComponent("하늘") };

async function asking(app: App, remoteAddress: string, headers: Record<string, string> = typed) {
  const reply = await app.inject({ method: "GET", url: "/api/meta", headers, remoteAddress });
  return reply.json().user.roles as string[];
}

describe("alone on one's own machine, the loopback address is the administrator [REQ-054]", () => {
  test("[REQ-054] with no token configured, a loopback request is an admin and meta says so", async () => {
    const app = serve({});
    for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"])
      expect(await asking(app, address), address).toEqual(["user", "admin"]);
  });

  test("[REQ-054] a loopback request with no typed name is an admin too, so the first screen works", async () => {
    expect(await asking(serve({}), "127.0.0.1", {})).toEqual(["user", "admin"]);
  });

  test("[REQ-054] the same request from another address is not an admin", async () => {
    const app = serve({});
    for (const address of ["10.1.2.3", "192.168.0.7", "2001:db8::1", "::ffff:10.1.2.3"])
      expect(await asking(app, address), address).toEqual(["user"]);
  });

  test("[REQ-054] a forwarded header cannot make a stranger look like loopback", async () => {
    const headers = { ...typed, "x-forwarded-for": "127.0.0.1", forwarded: "for=127.0.0.1" };
    expect(await asking(serve({}), "10.1.2.3", headers)).toEqual(["user"]);
  });

  test("[REQ-054] the admin routes open for loopback and stay shut for others", async () => {
    const app = serve({});
    const post = (remoteAddress: string) =>
      app.inject({
        method: "POST",
        url: "/api/worlds/import",
        headers: typed,
        payload: { source: "sample" },
        remoteAddress,
      });
    expect((await post("127.0.0.1")).statusCode).toBe(200);
    expect((await post("10.1.2.3")).statusCode).toBe(403);
  });

  test("[REQ-054] with a token configured, loopback alone is not enough", async () => {
    const app = serve({ adminTokenEnv: "TERRARIUM_TEST_ADMIN_TOKEN" });
    expect(await asking(app, "127.0.0.1")).toEqual(["user"]);
    const withToken = { ...typed, "x-terrarium-admin-token": TOKEN };
    expect(await asking(app, "127.0.0.1", withToken)).toEqual(["user", "admin"]);
    expect(await asking(app, "10.1.2.3", withToken)).toEqual(["user", "admin"]);
  });

  test("[REQ-054] in proxy mode loopback means nothing: only the list and the group make an admin", async () => {
    const app = serve({
      header: "x-forwarded-user",
      proxySecretEnv: "TERRARIUM_TEST_PROXY_SECRET",
      groupsHeader: "x-forwarded-groups",
      admins: ["boss"],
    });
    const proxy = { "x-terrarium-proxy-secret": SECRET, "x-forwarded-user": "kim" };
    expect(await asking(app, "127.0.0.1", proxy)).toEqual(["user"]);
    expect(await asking(app, "127.0.0.1", { ...proxy, "x-forwarded-user": "boss" })).toEqual([
      "user",
      "admin",
    ]);
    const stranger = await app.inject({
      method: "GET",
      url: "/api/meta",
      headers: typed,
      remoteAddress: "127.0.0.1",
    });
    expect(stranger.statusCode).toBe(401);
  });

  test("[REQ-054] what counts as loopback", () => {
    for (const a of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1"])
      expect(isLoopback(a), a).toBe(true);
    for (const a of [undefined, "", "10.0.0.1", "1127.0.0.1", "::2", "127.0.0.1.evil", "localhost"])
      expect(isLoopback(a), String(a)).toBe(false);
  });
});
