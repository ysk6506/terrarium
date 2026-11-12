/**
 * The server behind the SSO proxy of `scoped-app.ts`, with the audit store in the test's hand: the tests of the audit log read
 * what was written, make the store fail, and hear the lines the server's own log would get.
 */

import { type AuditStore, MemoryAuditStore } from "@terrarium/core/experiments";
import { parseConfig, SecretBox } from "../../adapters";
import { FakeFetch, json } from "../../adapters/test-support/fake-fetch";
import type { AuditLogLine } from "../../runtime";
import { testPlatform } from "../../runtime/test-support/platform";
import { buildApp } from "../app";
import { authenticatorOf } from "../identity";
import type { Send } from "./scoped-app";

export const PROXY_SECRET = "proxy-secret-for-scope-tests-0001";
const PROXY = {
  header: "x-forwarded-user",
  proxySecretEnv: "TERRARIUM_TEST_PROXY_SECRET",
  groupsHeader: "x-forwarded-groups",
  admins: ["boss"],
};

export function auditedApp(
  options: { readonly audit?: AuditStore; readonly auditLine?: AuditLogLine } = {},
) {
  const audit = options.audit ?? new MemoryAuditStore();
  const fake = new FakeFetch().on("GET", /^\/agents$/, () =>
    json({ agents: [{ id: "triage", name: "분류" }] }),
  );
  const t = testPlatform([], {
    ...(options.auditLine ? { auditLine: options.auditLine } : {}),
    adapters: {
      connect: { env: {}, fetch: fake.fetch },
      secretBox: SecretBox.ephemeral(),
      audit,
    },
    llm: { fetch: async () => new Response(JSON.stringify({ data: [{ id: "m" }] })) },
  });
  const app = buildApp({
    platform: t.platform,
    authenticator: authenticatorOf(parseConfig({ identity: PROXY }).identity, {
      TERRARIUM_TEST_PROXY_SECRET: PROXY_SECRET,
    }),
  });
  const send: Send = async (who, method, url, payload) => {
    const r = await app.inject({
      method: method as "GET",
      url,
      headers: {
        "x-terrarium-proxy-secret": PROXY_SECRET,
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
  return { ...t, app, send, llmCalls: [] as string[], audit, close: () => t.platform.stop() };
}

export type AuditedApp = ReturnType<typeof auditedApp>;
