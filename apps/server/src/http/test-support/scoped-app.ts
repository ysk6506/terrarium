/**
 * A server behind the SSO proxy with four people who differ only in what the read rule looks at (ADR-0174): the maker, a
 * member of the maker's group, someone in another group, and an admin. Used by the tests of visibility scopes.
 */

import { sampleBlueprint } from "../../../../../packages/core/src/world/test-support/sample";
import { parseConfig, SecretBox } from "../../adapters";
import { FakeFetch, json } from "../../adapters/test-support/fake-fetch";
import { recipe, testPlatform, until } from "../../runtime/test-support/platform";
import { buildApp } from "../app";
import { authenticatorOf } from "../identity";

const SECRET = "proxy-secret-for-scope-tests-0001";
const ENV = { TERRARIUM_TEST_PROXY_SECRET: SECRET };
const PROXY = {
  header: "x-forwarded-user",
  proxySecretEnv: "TERRARIUM_TEST_PROXY_SECRET",
  groupsHeader: "x-forwarded-groups",
  admins: ["boss"],
};

export interface Person {
  readonly login: string;
  readonly groups: readonly string[];
}

/** The maker, a member of the maker's group, someone in another group, and an admin. */
export const OLIVIA: Person = { login: "olivia", groups: ["part-a"] };
export const MINA: Person = { login: "mina", groups: ["part-a", "everyone-team"] };
export const OMAR: Person = { login: "omar", groups: ["part-b"] };
export const BOSS: Person = { login: "boss", groups: [] };
/** Someone with no group at all. */
export const LONE: Person = { login: "lone", groups: [] };
export const PEOPLE = [OLIVIA, MINA, OMAR, BOSS] as const;

export type Send = (
  who: Person,
  method: string,
  url: string,
  payload?: object,
) => Promise<{ status: number; body: Record<string, any>; text: string }>;

export function scopedApp() {
  const fake = new FakeFetch().on("GET", /^\/agents$/, () =>
    json({ agents: [{ id: "triage", name: "분류" }] }),
  );
  const llmCalls: string[] = [];
  const t = testPlatform([], {
    adapters: { connect: { env: {}, fetch: fake.fetch }, secretBox: SecretBox.ephemeral() },
    llm: {
      fetch: async (_url, init) => {
        // what every call to a model carries (the key rides in a header), so a test can see whose key went out
        llmCalls.push(JSON.stringify(init?.headers ?? {}));
        return new Response(JSON.stringify({ data: [{ id: "m" }] }));
      },
    },
  });
  const app = buildApp({
    platform: t.platform,
    authenticator: authenticatorOf(parseConfig({ identity: PROXY }).identity, ENV),
  });
  const send: Send = async (who, method, url, payload) => {
    const r = await app.inject({
      method: method as "GET",
      url,
      headers: {
        "x-terrarium-proxy-secret": SECRET,
        "x-forwarded-user": who.login,
        "x-forwarded-groups": who.groups.join(","),
      },
      ...(payload ? { payload } : {}),
    });
    let body: Record<string, any> = {};
    try {
      body = r.json() as Record<string, any>;
    } catch {
      // a report or a file, not JSON
    }
    return { status: r.statusCode, body, text: r.body };
  };
  return { ...t, app, send, llmCalls, close: () => t.platform.stop() };
}

export type ScopedApp = ReturnType<typeof scopedApp>;

/** The scope fields a create body carries. */
export interface Scoping {
  readonly scope: "private" | "group" | "everyone";
  readonly group?: string;
}

/** What the maker has made under one scope: every kind of record, and a finished run on the experiment. */
export async function makeAll(s: ScopedApp, as: Person, scoping: Scoping) {
  const { send } = s;
  // the first model registered is the default, which everyone sees; an admin's takes that place, so the others show their scope
  if (((await send(BOSS, "GET", "/api/models")).body as unknown as unknown[]).length === 0)
    await send(BOSS, "POST", "/api/models", {
      name: "기본 모델",
      kind: "openai",
      baseUrl: "https://llm.test/v1",
      apiKey: "sk-boss-0001",
      scope: "everyone",
    });
  const world = (
    await send(as, "POST", "/api/worlds", {
      name: "홀",
      blueprint: sampleBlueprint(),
      ...scoping,
    })
  ).body.world;
  const scenario = (
    await send(as, "POST", "/api/scenarios", {
      worldId: world.id,
      templateId: "cooling-failure",
      ...scoping,
    })
  ).body.scenario;
  const connection = (
    await send(as, "POST", "/api/connections", {
      connector: "http",
      name: `연결 ${scoping.scope}`,
      config: { url: "https://harness.test", token: "olivia-secret" },
      ...scoping,
    })
  ).body;
  const model = (
    await send(as, "POST", "/api/models", {
      name: `모델 ${scoping.scope}`,
      kind: "openai",
      baseUrl: "https://llm.test/v1",
      apiKey: "sk-olivia-secret-0001",
      ...scoping,
    })
  ).body;
  const experiment = (
    await send(as, "POST", "/api/experiments", {
      name: "실험",
      recipe: recipe(world.id, scenario.id, { seeds: [1] }),
      ...scoping,
    })
  ).body.experiment;
  await until(
    async () =>
      (await send(as, "GET", `/api/experiments/${experiment.id}`)).body.progress.finished === 1,
  );
  const run = (await send(as, "GET", `/api/experiments/${experiment.id}`)).body.runs[0];
  return { world, scenario, connection, model, experiment, run };
}

export type Made = Awaited<ReturnType<typeof makeAll>>;
