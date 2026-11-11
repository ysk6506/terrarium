import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { run } from "./main";

const dir = mkdtempSync(path.join(tmpdir(), "terrarium-identity-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const proxy = {
  header: "x-forwarded-user",
  proxySecretEnv: "TERRARIUM_TEST_MAIN_PROXY_SECRET",
};

function configWith(identity: object): string {
  const file = path.join(dir, "terrarium.json");
  writeFileSync(file, JSON.stringify({ identity, dataDir: dir, port: 48123, host: "127.0.0.1" }));
  return file;
}

describe("a server that would believe anyone does not start [REQ-054]", () => {
  test("[REQ-054] the whole server refuses to start in proxy mode without the secret, before it opens anything", async () => {
    const file = configWith(proxy);
    const env = { TERRARIUM_CONFIG: file };
    await expect(run({ env, logger: false })).rejects.toThrow(/problem:.*fix:/s);
    await expect(
      run({ env: { ...env, TERRARIUM_TEST_MAIN_PROXY_SECRET: "" }, logger: false }),
    ).rejects.toThrow("TERRARIUM_TEST_MAIN_PROXY_SECRET");
  });
});
