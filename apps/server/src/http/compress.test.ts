import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterAll, describe, expect, test } from "vitest";
import { testPlatform } from "../runtime/test-support/platform";
import { buildApp } from "./app";
import { bytesOf } from "./compress";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const BIG = `${"const 테라리움 = 1;\n".repeat(400)}`;

async function web() {
  const dist = mkdtempSync(path.join(tmpdir(), "terrarium-compress-"));
  dirs.push(dist);
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>테라리움</title>");
  writeFileSync(path.join(dist, "assets", "app.js"), BIG);
  writeFileSync(path.join(dist, "assets", "tiny.js"), "1");
  writeFileSync(path.join(dist, "assets", "font.woff2"), Buffer.alloc(4000, 7));
  const app = buildApp({ platform: testPlatform().platform, webDist: dist });
  await app.ready();
  return app;
}

describe("the web app's text files travel compressed, so the first screen stays small [REQ-041]", () => {
  test("brotli or gzip when the browser accepts it, and the same bytes come back", async () => {
    const app = await web();
    const br = await app.inject({
      url: "/assets/app.js",
      headers: { "accept-encoding": "gzip, br" },
    });
    expect(br.headers["content-encoding"]).toBe("br");
    expect(br.headers.vary).toBe("Accept-Encoding");
    expect(brotliDecompressSync(br.rawPayload).toString()).toBe(BIG);
    expect(br.rawPayload.length).toBeLessThan(BIG.length / 5);

    const gz = await app.inject({ url: "/assets/app.js", headers: { "accept-encoding": "gzip" } });
    expect(gz.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(gz.rawPayload).toString()).toBe(BIG);
    // Asked twice, answered from the kept copy with the same result.
    const again = await app.inject({
      url: "/assets/app.js",
      headers: { "accept-encoding": "gzip" },
    });
    expect(again.rawPayload.equals(gz.rawPayload)).toBe(true);
  });

  test("small files, binaries, browsers that do not ask, and machine paths go out as they are", async () => {
    const app = await web();
    const ask = { "accept-encoding": "gzip, br" };
    expect(
      (await app.inject({ url: "/assets/tiny.js", headers: ask })).headers["content-encoding"],
    ).toBeUndefined();
    expect(
      (await app.inject({ url: "/assets/font.woff2", headers: ask })).headers["content-encoding"],
    ).toBeUndefined();
    const plain = await app.inject({ url: "/assets/app.js" });
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.body).toBe(BIG);
    const api = await app.inject({ url: "/api/meta", headers: ask });
    expect(api.headers["content-encoding"]).toBeUndefined();
    expect(api.json().harnesses).toBeDefined();
  });

  test("whatever a handler hands over is read as bytes: text, buffers and streams", async () => {
    async function* chunks() {
      yield "가";
      yield Buffer.from("나");
    }
    expect((await bytesOf("글"))?.toString()).toBe("글");
    expect((await bytesOf(Buffer.from("글")))?.toString()).toBe("글");
    expect((await bytesOf(chunks()))?.toString()).toBe("가나");
    expect(await bytesOf(undefined)).toBeUndefined();
    expect(await bytesOf(42)).toBeUndefined();
  });
});
