import { ROUTES, type RouteSpec } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import { type IdentityConfig, parseConfig } from "../adapters";
import { recipe, testPlatform, until } from "../runtime/test-support/platform";
import { buildApp } from "./app";
import { authenticatorOf } from "./identity";

const SECRET = "proxy-secret-for-tests-0001";
const ADMIN_TOKEN = "admin-token-for-tests-0001";
const ENV = { TERRARIUM_TEST_PROXY_SECRET: SECRET, TERRARIUM_TEST_ADMIN_TOKEN: ADMIN_TOKEN };
const PROXY = {
  header: "x-forwarded-user",
  proxySecretEnv: "TERRARIUM_TEST_PROXY_SECRET",
  nameHeader: "x-forwarded-name",
  groupsHeader: "x-forwarded-groups",
  admins: ["boss"],
  adminGroup: "terrarium-admins",
};

const identityOf = (raw: object): IdentityConfig => parseConfig({ identity: raw }).identity;

function serve(identity: object = PROXY, env: NodeJS.ProcessEnv = ENV) {
  const t = testPlatform();
  const app = buildApp({
    platform: t.platform,
    authenticator: authenticatorOf(identityOf(identity), env),
  });
  return { ...t, app };
}

/** What the proxy sends for a signed-in person. */
const signedIn = (login: string, extra: Record<string, string> = {}) => ({
  "x-terrarium-proxy-secret": SECRET,
  "x-forwarded-user": login,
  ...extra,
});

const urlOf = (r: RouteSpec) => r.path.replace(/:[A-Za-z]+/g, "x");
const NFC = "김연수".normalize("NFC");
const NFD = "김연수".normalize("NFD");

describe("behind the proxy, only the proxy is believed [REQ-054]", () => {
  test("[REQ-054] without the right secret every route that is not public answers 401, whatever the other headers say", async () => {
    const { app } = serve();
    const claims = {
      "x-forwarded-user": "boss",
      "x-forwarded-groups": "terrarium-admins",
      "x-terrarium-user": "boss",
      "x-terrarium-admin-token": ADMIN_TOKEN,
    };
    const wrong = { ...claims, "x-terrarium-proxy-secret": `${SECRET}x` };
    const empty = { ...claims, "x-terrarium-proxy-secret": "" };
    const guarded = Object.values(ROUTES as Record<string, RouteSpec>).filter((r) => !r.public);
    expect(guarded.length).toBeGreaterThan(70);
    for (const r of guarded)
      for (const headers of [claims, wrong, empty]) {
        const reply = await app.inject({ method: r.method, url: urlOf(r), headers });
        expect(reply.statusCode, `${r.method} ${r.path}`).toBe(401);
        expect(reply.body).not.toContain(SECRET);
      }
  });

  test("[REQ-054] the two live streams are behind the same door: no secret is a 401, not an open stream", async () => {
    const { app } = serve();
    for (const url of ["/api/experiments/x/events", "/api/worlds/x/activity"]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
      const wrong = { "x-forwarded-user": "boss", "x-terrarium-proxy-secret": "nope" };
      expect((await app.inject({ method: "GET", url, headers: wrong })).statusCode).toBe(401);
      // the right secret gets past the door (and finds there is no such world)
      const ok = await app.inject({ method: "GET", url, headers: signedIn("boss") });
      expect(ok.statusCode).toBe(404);
    }
  });

  test("[REQ-054] a missing login header is 401 even with the right secret; it is never let through as anonymous", async () => {
    const { app } = serve();
    const secretOnly = { "x-terrarium-proxy-secret": SECRET };
    expect(
      (await app.inject({ method: "GET", url: "/api/meta", headers: secretOnly })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/api/worlds", headers: secretOnly })).statusCode,
    ).toBe(401);
    const blank = { ...secretOnly, "x-forwarded-user": "   " };
    expect((await app.inject({ method: "GET", url: "/api/meta", headers: blank })).statusCode).toBe(
      401,
    );
    // a typed name does not stand in for the login
    const typed = { ...secretOnly, "x-terrarium-user": "boss" };
    expect((await app.inject({ method: "GET", url: "/api/meta", headers: typed })).statusCode).toBe(
      401,
    );
  });

  test("[REQ-054] a share link carries its own secret in the address and needs no sign-in", async () => {
    const { app } = serve();
    const reply = await app.inject({ method: "GET", url: "/r/nope" });
    expect(reply.statusCode).toBe(404);
  });

  test("[REQ-054] the word anonymous, in any case, is nobody's login", async () => {
    const { app } = serve();
    for (const login of ["anonymous", "Anonymous", "ANONYMOUS", " anonymous "]) {
      const reply = await app.inject({ method: "GET", url: "/api/meta", headers: signedIn(login) });
      expect(reply.statusCode, login).toBe(401);
    }
    // nor a name to show: the login is shown instead
    const named = await app.inject({
      method: "GET",
      url: "/api/meta",
      headers: signedIn("kim", { "x-forwarded-name": "Anonymous" }),
    });
    expect(named.json().user).toMatchObject({ id: "kim", name: "kim" });
  });

  test("[REQ-054] who the proxy says is who is asked: login id, display name, groups and roles", async () => {
    const { app } = serve();
    const reply = await app.inject({
      method: "GET",
      url: "/api/meta",
      headers: signedIn("yeonsu.kim", {
        "x-forwarded-name": "김연수",
        "x-forwarded-groups": " ai-platform , infra,, ai-platform ",
      }),
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json().user).toEqual({
      id: "yeonsu.kim",
      name: "김연수",
      groups: ["ai-platform", "infra"],
      roles: ["user"],
      source: "proxy",
    });
    expect(reply.json().identity).toEqual({ mode: "proxy" });
    expect(reply.body).not.toContain(SECRET);
  });

  test("[REQ-054] an empty groups header means no groups; a missing name header means the login is the name", async () => {
    const { app } = serve();
    const reply = await app.inject({
      method: "GET",
      url: "/api/meta",
      headers: signedIn("kim", { "x-forwarded-groups": "" }),
    });
    expect(reply.json().user).toMatchObject({ name: "kim", groups: [] });
  });

  test("[REQ-054] UTF-8 sent raw by the proxy (read as Latin-1 by Node) is put back together", async () => {
    const { app } = serve();
    const latin1 = Buffer.from("김연수", "utf8").toString("latin1");
    const reply = await app.inject({
      method: "GET",
      url: "/api/meta",
      headers: signedIn("kim", { "x-forwarded-name": latin1 }),
    });
    expect(reply.json().user.name).toBe("김연수");
  });
});

describe("one person is one login, however it is spelled [REQ-054]", () => {
  test("[REQ-054] a name typed in decomposed Unicode is the same person as the composed one", async () => {
    expect(NFC).not.toBe(NFD);
    const { app } = serve();
    const asNfd = await app.inject({ method: "GET", url: "/api/meta", headers: signedIn(NFD) });
    const asNfc = await app.inject({ method: "GET", url: "/api/meta", headers: signedIn(NFC) });
    expect(asNfd.json().user.id).toBe(NFC);
    expect(asNfc.json().user.id).toBe(NFC);
    // what the one made, the other may change
    const made = await app.inject({
      method: "POST",
      url: "/api/worlds/generate",
      headers: signedIn(NFD),
      payload: {},
    });
    expect(made.statusCode).not.toBe(401);
  });

  test("[REQ-054] ownership follows the login: the same person under either spelling changes their own world, another person cannot", async () => {
    const { app, platform } = serve();
    const { sampleBlueprint } = await import(
      "../../../../packages/core/src/world/test-support/sample"
    );
    const made = await app.inject({
      method: "POST",
      url: "/api/worlds",
      headers: signedIn(NFD),
      payload: { name: "내 세계", blueprint: sampleBlueprint() },
    });
    expect(made.statusCode).toBe(200);
    expect(made.json().world.owner).toBe(NFC);
    const id = made.json().world.id as string;
    const body = { baseDigest: made.json().world.digest, name: "새 이름" };
    const other = await app.inject({
      method: "PUT",
      url: `/api/worlds/${id}`,
      headers: signedIn("jimin"),
      payload: body,
    });
    expect(other.statusCode).toBe(403);
    const same = await app.inject({
      method: "PUT",
      url: `/api/worlds/${id}`,
      headers: signedIn(NFC),
      payload: body,
    });
    expect(same.statusCode).toBe(200);
    await platform.stop();
  });
});

describe("administrators come from the settings [REQ-054]", () => {
  const rolesOf = async (app: ReturnType<typeof serve>["app"], headers: Record<string, string>) =>
    (await app.inject({ method: "GET", url: "/api/meta", headers })).json().user.roles;

  test("[REQ-054] a login on the admin list is an admin, anyone else is a user", async () => {
    const { app } = serve();
    expect(await rolesOf(app, signedIn("boss"))).toEqual(["user", "admin"]);
    expect(await rolesOf(app, signedIn("kim"))).toEqual(["user"]);
    // the list is of logins: a display name that says "boss" is not one
    expect(await rolesOf(app, signedIn("kim", { "x-forwarded-name": "boss" }))).toEqual(["user"]);
  });

  test("[REQ-054] a member of the admin group is an admin", async () => {
    const { app } = serve();
    const groups = { "x-forwarded-groups": "infra, terrarium-admins" };
    expect(await rolesOf(app, signedIn("kim", groups))).toEqual(["user", "admin"]);
    expect(
      await rolesOf(app, signedIn("kim", { "x-forwarded-groups": "terrarium-admins-not" })),
    ).toEqual(["user"]);
  });

  test("[REQ-054] with neither a list nor a group nobody is an admin", async () => {
    const { app } = serve({ ...PROXY, admins: [], adminGroup: undefined });
    expect(
      await rolesOf(app, signedIn("boss", { "x-forwarded-groups": "terrarium-admins" })),
    ).toEqual(["user"]);
  });

  test("[REQ-054] a listed login is an admin in either Unicode spelling", async () => {
    const { app } = serve({ ...PROXY, admins: [NFD] });
    expect(await rolesOf(app, signedIn(NFC))).toEqual(["user", "admin"]);
  });

  test("[REQ-054] an admin changes what another person made; a user does not", async () => {
    const { app, platform } = serve();
    const { sampleBlueprint } = await import(
      "../../../../packages/core/src/world/test-support/sample"
    );
    const made = await app.inject({
      method: "POST",
      url: "/api/worlds",
      headers: signedIn("kim"),
      payload: { name: "세계", blueprint: sampleBlueprint() },
    });
    const id = made.json().world.id as string;
    const gone = await app.inject({
      method: "DELETE",
      url: `/api/worlds/${id}`,
      headers: signedIn("jimin"),
    });
    expect(gone.statusCode).toBe(403);
    const byAdmin = await app.inject({
      method: "DELETE",
      url: `/api/worlds/${id}`,
      headers: signedIn("boss"),
    });
    expect(byAdmin.statusCode).toBe(200);
    await platform.stop();
  });
});

describe("typed names are for one person on their own machine [REQ-054]", () => {
  const typed = (name: string, extra: Record<string, string> = {}) => ({
    "x-terrarium-user": encodeURIComponent(name),
    ...extra,
  });
  const self = (identity: object = { adminTokenEnv: "TERRARIUM_TEST_ADMIN_TOKEN" }) =>
    serve(identity);
  const meta = async (app: ReturnType<typeof serve>["app"], headers: Record<string, string>) =>
    (await app.inject({ method: "GET", url: "/api/meta", headers })).json();

  test("[REQ-054] meta says which mode is on, so the screen can say there is no protection", async () => {
    expect((await meta(self().app, typed("연수"))).identity).toEqual({ mode: "self-declared" });
    expect((await meta(serve().app, signedIn("kim"))).identity).toEqual({ mode: "proxy" });
  });

  test("[REQ-054] nobody is an admin without the token, and a name on the list does not make one", async () => {
    const { app } = self({
      adminTokenEnv: "TERRARIUM_TEST_ADMIN_TOKEN",
      admins: ["연수"],
      adminGroup: "g",
    });
    expect((await meta(app, typed("연수"))).user.roles).toEqual(["user"]);
    expect(
      (await meta(app, typed("연수", { "x-terrarium-admin-token": "wrong" }))).user.roles,
    ).toEqual(["user"]);
    expect(
      (await meta(app, typed("연수", { "x-terrarium-admin-token": ADMIN_TOKEN }))).user.roles,
    ).toEqual(["user", "admin"]);
  });

  test("[REQ-054] with no token configured, a request from another address is no admin, whatever is sent", async () => {
    const { app } = self({});
    const from = (headers: Record<string, string>) =>
      app.inject({ method: "GET", url: "/api/meta", headers, remoteAddress: "10.1.2.3" });
    const sent = typed("연수", { "x-terrarium-admin-token": ADMIN_TOKEN });
    expect((await from(sent)).json().user.roles).toEqual(["user"]);
    const blank = typed("연수", { "x-terrarium-admin-token": "" });
    expect((await from(blank)).json().user.roles).toEqual(["user"]);
  });

  test("[REQ-054] the admin token gates the admin routes in this mode", async () => {
    const { app } = self();
    const post = (headers: Record<string, string>) =>
      app.inject({
        method: "POST",
        url: "/api/worlds/import",
        headers,
        payload: { source: "sample" },
      });
    expect((await post(typed("연수"))).statusCode).toBe(403);
    expect((await post(typed("연수", { "x-terrarium-admin-token": "wrong" }))).statusCode).toBe(
      403,
    );
    expect((await post(typed("연수", { "x-terrarium-admin-token": ADMIN_TOKEN }))).statusCode).toBe(
      200,
    );
  });

  test("[REQ-054] the word anonymous, typed in any case, is not a name: such a request is nobody's, as if no name was typed", async () => {
    const { app } = self();
    for (const name of ["anonymous", "ANONYMOUS", "Anonymous"]) {
      const user = (await meta(app, typed(name))).user;
      expect(user, name).toMatchObject({ id: "anonymous", source: "anonymous" });
    }
  });

  test("[REQ-054] typed names are one Unicode form too: decomposed and composed are the same person", async () => {
    const { app } = self();
    expect((await meta(app, typed(NFD))).user).toMatchObject({
      id: NFC,
      name: NFC,
      source: "self",
    });
  });

  test("[REQ-054] the old behaviour for one developer stays: a typed name works, no name is the shared anonymous user", async () => {
    const { app } = self();
    expect((await meta(app, typed("연수"))).user).toMatchObject({
      id: "연수",
      source: "self",
      roles: ["user"],
    });
    expect((await meta(app, {})).user).toMatchObject({ id: "anonymous", source: "anonymous" });
  });
});

describe("a server that would believe anyone does not start [REQ-054]", () => {
  test("[REQ-054] proxy mode needs its secret: unset, empty or unnamed all refuse, and say how to fix it", () => {
    const cases: [object, NodeJS.ProcessEnv][] = [
      [PROXY, {}],
      [PROXY, { TERRARIUM_TEST_PROXY_SECRET: "" }],
      [{ header: "x-forwarded-user" }, ENV],
    ];
    for (const [identity, env] of cases) {
      const start = () => authenticatorOf(identityOf(identity), env);
      expect(start).toThrow(/problem:.*fix:/s);
      expect(start).not.toThrow(SECRET);
    }
  });

  test("[REQ-054] the secret itself is never in the settings file: the settings only name the variable", () => {
    expect(() => parseConfig({ identity: { ...PROXY, proxySecret: SECRET } })).toThrow();
    expect(identityOf(PROXY).proxySecretEnv).toBe("TERRARIUM_TEST_PROXY_SECRET");
    expect(JSON.stringify(identityOf(PROXY))).not.toContain(SECRET);
  });

  test("[REQ-054] a typed-name server whose admin token variable is empty refuses too, rather than run with no admin by accident", () => {
    expect(() =>
      authenticatorOf(identityOf({ adminTokenEnv: "TERRARIUM_TEST_ADMIN_TOKEN" }), {}),
    ).toThrow("fix:");
  });
});

describe("a share link lives thirty days unless its maker says otherwise [REQ-054]", () => {
  test("[REQ-054] no number given: thirty days; a number given: that many", async () => {
    const { app, platform } = serve();
    const { sampleBlueprint } = await import(
      "../../../../packages/core/src/world/test-support/sample"
    );
    const world = await app.inject({
      method: "POST",
      url: "/api/worlds",
      headers: signedIn("kim"),
      payload: { name: "홀", blueprint: sampleBlueprint() },
    });
    const scenario = await app.inject({
      method: "POST",
      url: "/api/scenarios",
      headers: signedIn("kim"),
      payload: { worldId: world.json().world.id, templateId: "cooling-failure" },
    });
    const made = await app.inject({
      method: "POST",
      url: "/api/experiments",
      headers: signedIn("kim"),
      payload: {
        name: "공유",
        recipe: recipe(world.json().world.id, scenario.json().scenario.id, { seeds: [1] }),
      },
    });
    const id = made.json().experiment.id as string;
    await until(
      async () =>
        (
          await app.inject({
            method: "GET",
            url: `/api/experiments/${id}`,
            headers: signedIn("kim"),
          })
        ).json().progress.finished === 1,
    );
    const days = (share: { createdAt: string; expiresAt: string }) =>
      (Date.parse(share.expiresAt) - Date.parse(share.createdAt)) / 86_400_000;
    const none = await app.inject({
      method: "POST",
      url: `/api/experiments/${id}/shares`,
      headers: signedIn("kim"),
      payload: {},
    });
    expect(none.statusCode).toBe(200);
    expect(days(none.json())).toBe(30);
    const seven = await app.inject({
      method: "POST",
      url: `/api/experiments/${id}/shares`,
      headers: signedIn("kim"),
      payload: { expiresInDays: 7 },
    });
    expect(days(seven.json())).toBe(7);
    // anyone with the link reads the report, with no sign-in
    const token = none.json().token as string;
    expect((await app.inject({ method: "GET", url: `/r/${token}?format=text` })).statusCode).toBe(
      200,
    );
    await platform.stop();
  });
});
