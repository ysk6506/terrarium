import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  addressOf,
  dump,
  KEPT_REQUESTS,
  PREFIX,
  scrub,
  secretsOf,
  TEXT_LIMIT,
  trimText,
  watch,
} from "../e2e";

/** The page type the evidence module takes, without naming the browser package in this unit. */
type WatchedPage = Parameters<typeof watch>[0];

const PLANTED = "planted-secret-7f3a91c2e4";

/** A page that says what the browser would say, with secrets in the places a real request carries them. */
class FakePage extends EventEmitter {
  address = `http://127.0.0.1:8787/experiments/e1?token=${PLANTED}&tab=result#${PLANTED}`;
  text: string | Error = "실험 결과예요\n\n\n합격했어요";
  shotFails = false;
  url = () => this.address;
  innerText = async () => {
    if (this.text instanceof Error) throw this.text;
    return this.text;
  };
  screenshot = async (o: { path: string }) => {
    if (this.shotFails) throw new Error("page closed");
    writeFileSync(o.path, "png");
  };
  asPage = () => this as unknown as WatchedPage;

  /** An answer from the server whose request and response carry the secret in every header and in the body. */
  respond(method: string, url: string, status: number): void {
    const request = {
      method: () => method,
      url: () => url,
      headers: () => ({ authorization: `Bearer ${PLANTED}`, cookie: `sid=${PLANTED}` }),
      postData: () => `{"token":"${PLANTED}"}`,
    };
    this.emit("response", {
      url: () => url,
      status: () => status,
      request: () => request,
      headers: () => ({ "set-cookie": `sid=${PLANTED}`, "x-terrarium-proxy-secret": PLANTED }),
      text: async () => `{"token":"${PLANTED}"}`,
    });
  }
}

const folders: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "terrarium-evidence-"));
  folders.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("what a failed journey step leaves behind [REQ-041]", () => {
  test("a secret planted in headers, bodies, the address and the page text never reaches the dump", async () => {
    const page = new FakePage();
    const watcher = watch(page.asPage());
    page.respond("GET", `http://127.0.0.1:8787/api/worlds?token=${PLANTED}`, 200);
    page.respond("POST", "http://127.0.0.1:8787/api/experiments", 500);
    page.emit("console", { type: () => "error", text: () => `request failed for ${PLANTED}` });
    page.text = `관리자 토큰은 ${PLANTED} 예요\n합격했어요`;
    // the environment names the planted value as the server's admin token, as a CI job would
    const lines = await dump(
      page.asPage(),
      watcher,
      {
        id: "run",
        note: "click timed out",
        dir: scratch(),
        secrets: secretsOf({ ADMIN_TOKEN: PLANTED }),
      },
      1,
    );
    const all = lines.join("\n");
    expect(all).not.toContain(PLANTED);
    expect(all).toContain("GET /api/worlds?token=… 200");
    expect(all).toContain("POST /api/experiments 500");
    expect(all).toContain("/experiments/e1?token=…&tab=…");
    expect(all).not.toContain("authorization");
    expect(all).not.toContain("set-cookie");
    expect(all.split("\n").every((l) => l.startsWith(PREFIX))).toBe(true);
  });

  test("the planted value does not appear even when nothing names it as a secret, because no header or body is read", async () => {
    const page = new FakePage();
    const watcher = watch(page.asPage());
    page.respond("GET", "http://127.0.0.1:8787/api/worlds", 200);
    const lines = await dump(page.asPage(), watcher, { id: "run", note: "x", secrets: [] }, 1);
    expect(lines.join("\n")).not.toContain(PLANTED);
  });

  test("a secret held by the environment is taken out wherever it shows, and short or unrelated values stay", () => {
    const env = { TERRARIUM_ADMIN_TOKEN: PLANTED, PROXY_SECRET: "abc", HOME: "/root/home-dir" };
    const secrets = secretsOf(env);
    expect(secrets).toEqual([PLANTED]);
    expect(scrub(`a ${PLANTED} b /root/home-dir`, secrets)).toBe("a [redacted] b /root/home-dir");
  });

  test("bearer credentials, share links, tool links and long opaque strings are taken out", () => {
    const long = "A1b2C3d4".repeat(6);
    expect(scrub("Authorization: Bearer abc.def-123", [])).toBe("Authorization: Bearer [redacted]");
    expect(scrub("https://x/r/shareToken123", [])).toBe("https://x/r/[redacted]");
    expect(scrub("/mcp/runs/run-1/runToken9", [])).toBe("/mcp/runs/run-1/[redacted]");
    expect(scrub(`key ${long} end`, [])).toBe("key [redacted] end");
    expect(scrub("an ordinary id 0d3b6e4c-1f2a-4b7c-9d10-aabbccddeeff", [])).toContain("0d3b6e4c");
  });

  test("only the last 20 API requests are kept, with status codes, and other requests are not", () => {
    const page = new FakePage();
    const watcher = watch(page.asPage());
    for (let i = 0; i < 30; i++) page.respond("GET", `http://127.0.0.1:8787/api/items/${i}`, 200);
    page.respond("GET", "http://127.0.0.1:8787/assets/app.js", 200);
    page.emit("requestfailed", { method: () => "GET", url: () => "http://x/api/slow" });
    const kept = watcher.requests();
    expect(kept).toHaveLength(KEPT_REQUESTS);
    expect(kept.at(-1)).toMatch(/GET \/api\/slow failed$/);
    expect(kept[0]).toMatch(/GET \/api\/items\/11 200$/);
    expect(kept.join("\n")).not.toContain("assets");
  });

  test("the page text is folded and cut to a few kilobytes", () => {
    expect(trimText("a  b\n\n\n  c \t d")).toBe("a b\nc d");
    const cut = trimText("x".repeat(TEXT_LIMIT + 500));
    expect(cut.length).toBeLessThan(TEXT_LIMIT + 80);
    expect(cut).toContain(`cut: ${TEXT_LIMIT + 500} characters`);
  });

  test("an address keeps its path and the names of its query fields only", () => {
    expect(addressOf("http://h:1/a/b?x=1&y=2#frag")).toBe("/a/b?x=…&y=…");
    expect(addressOf("not an address")).toBe("(address unreadable)");
  });

  test("a dump that cannot read the page or take the picture still comes back, and the screenshot is written when it can", async () => {
    const page = new FakePage();
    page.text = new Error("page closed");
    page.shotFails = true;
    const broken = await dump(page.asPage(), watch(page.asPage()), {
      id: "build",
      note: "x",
      dir: scratch(),
    });
    expect(broken.join("\n")).toContain("page text unavailable");
    expect(broken.join("\n")).toContain("screenshot unavailable");

    const dir = scratch();
    const fine = new FakePage();
    const lines = await dump(fine.asPage(), watch(fine.asPage()), { id: "run", note: "x", dir }, 7);
    expect(lines.join("\n")).toContain(`screenshot: ${path.join(dir, "run-7.png")}`);
    expect(existsSync(path.join(dir, "run-7.png"))).toBe(true);
    const none = await dump(fine.asPage(), watch(fine.asPage()), { id: "run", note: "x" });
    expect(none.join("\n")).toContain("no screenshot");
  });
});
