/**
 * The shell module stays out of the web bundle and out of the core, and the .wasm in the repository is the one the
 * pinned sources and tool chain make (ADR-0196 2-바, ADR-0200). The rebuild itself needs Go and runs in its own CI job;
 * this checks the lock that job compares against.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = join(import.meta.dirname, "../..");
const wasm = join(root, "apps/server/shell-wasm/bin/terrarium-sh.wasm");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );

describe("the shell module and its bundle [REQ-098]", () => {
  test("[REQ-098] nothing in the web app or the core names the module, the engine or the workers", () => {
    const hits = [...files(join(root, "apps/web/src")), ...files(join(root, "packages/core/src"))]
      .filter((f) => /\.(ts|tsx|mjs)$/.test(f))
      .filter((f) =>
        /terrarium-sh|shell-wasm|WasmShellEngine|worker_threads/.test(readFileSync(f, "utf8")),
      )
      .map((f) => f.slice(root.length + 1));
    expect(hits).toEqual([]);
  });

  test("[REQ-098] the .wasm in the repository matches the lock of the pinned sources", () => {
    const out = execFileSync("node", ["apps/server/shell-wasm/scripts/lock.mjs", "check"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(out).toMatch(/^ok [0-9a-f]{64} /);
    expect(statSync(wasm).size).toBeLessThan(15 * 1024 * 1024);
  });

  test("[REQ-098] the module imports only the three host functions and the small WASI layer", () => {
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(wasm)));
    expect(
      imports
        .filter((i) => i.module === "terrarium")
        .map((i) => i.name)
        .sort(),
    ).toEqual(["call", "job", "take"]);
    expect(imports.every((i) => ["terrarium", "wasi_snapshot_preview1"].includes(i.module))).toBe(
      true,
    );
  });
});
