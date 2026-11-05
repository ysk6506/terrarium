import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { testPlatform } from "../runtime/test-support/platform";
import { buildApp } from "./app";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("serving the web app [REQ-041]", () => {
  test("a file built after the server started is served, and a missing file is a 404 rather than the app", async () => {
    const dist = mkdtempSync(path.join(tmpdir(), "terrarium-web-"));
    dirs.push(dist);
    mkdirSync(path.join(dist, "assets"));
    writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>테라리움</title>");
    const app = buildApp({ platform: testPlatform().platform, webDist: dist });
    await app.ready();

    writeFileSync(path.join(dist, "assets", "later.js"), "console.log(2)");
    expect((await app.inject({ url: "/assets/later.js" })).body).toBe("console.log(2)");

    const missing = await app.inject({ url: "/assets/gone.js" });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers["content-type"]).toContain("application/json");
    expect(missing.json().error.message).toBe("그런 파일은 없어요");

    // A page address is still the app.
    expect((await app.inject({ url: "/worlds/w-1" })).statusCode).toBe(200);
  });
});
