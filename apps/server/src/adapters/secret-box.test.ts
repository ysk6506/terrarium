import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { SecretBox } from "./secret-box";

const dirs: string[] = [];
const fresh = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "terrarium-box-"));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("tokens and passwords typed on the screen are kept sealed [REQ-051]", () => {
  test("what is sealed opens to the same text, and the sealed text shows nothing of it", () => {
    const box = SecretBox.ephemeral();
    const sealed = box.seal("s3cret-토큰");
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain("s3cret");
    expect(box.open(sealed)).toBe("s3cret-토큰");
    expect(box.seal("s3cret-토큰")).not.toBe(sealed);
  });

  test("another key, a changed byte or an unknown format cannot be opened", () => {
    const sealed = SecretBox.ephemeral().seal("x");
    expect(() => SecretBox.ephemeral().open(sealed)).toThrow();
    const box = SecretBox.ephemeral();
    const mine = box.seal("x");
    const body = Buffer.from(mine.slice(3), "base64");
    body[body.length - 1] = (body[body.length - 1] as number) ^ 1;
    expect(() => box.open(`v1:${body.toString("base64")}`)).toThrow();
    expect(() => box.open("v9:abc")).toThrow("알 수 없는 형식");
    expect(() => box.open("nonsense")).toThrow("알 수 없는 형식");
    expect(() => new SecretBox(Buffer.alloc(8))).toThrow("32바이트");
  });

  test("the server's key comes from its environment, else from a file only it can read", () => {
    const a = SecretBox.forServer({ TERRARIUM_SECRET_KEY: "한 줄 암호" }, fresh());
    const b = SecretBox.forServer({ TERRARIUM_SECRET_KEY: "한 줄 암호" }, fresh());
    expect(b.open(a.seal("같아요"))).toBe("같아요");
    expect(() =>
      SecretBox.forServer({ TERRARIUM_SECRET_KEY: "다른 암호" }, fresh()).open(a.seal("x")),
    ).toThrow();

    const dir = fresh();
    const first = SecretBox.forServer({}, dir);
    const file = path.join(dir, "secret.key");
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o077).toBe(0);
    const text = readFileSync(file, "utf8");
    expect(SecretBox.forServer({}, dir).open(first.seal("다시 열려요"))).toBe("다시 열려요");
    expect(readFileSync(file, "utf8")).toBe(text);
  });
});
