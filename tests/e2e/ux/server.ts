/** A throwaway Terrarium server for the browser run: its own data directory, its own port. */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

export interface TestServer {
  readonly url: string;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** Build the web app so the run looks at the current source, not at an old build. */
export function buildWeb(root: string): void {
  execFileSync("pnpm", ["--filter", "@terrarium/web", "build"], { cwd: root, stdio: "ignore" });
}

async function waitUntilUp(url: string, child: ChildProcess): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error("서버가 시작하지 못하고 끝났다");
    try {
      if ((await fetch(`${url}/healthz`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("서버가 30초 안에 뜨지 않았다");
}

export async function startServer(root: string): Promise<TestServer> {
  const dir = mkdtempSync(path.join(tmpdir(), "terrarium-ux-server-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const config = path.join(dir, "terrarium.json");
  writeFileSync(
    config,
    JSON.stringify({ port, host: "127.0.0.1", dataDir: "data", publicUrl: url, workers: 1 }),
  );
  const child = spawn(process.execPath, ["--import", "tsx", "apps/server/src/main.ts"], {
    cwd: root,
    env: { ...process.env, TERRARIUM_CONFIG: config },
    stdio: "ignore",
  });
  await waitUntilUp(url, child);
  return {
    url,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        child.once("close", resolve);
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve(undefined);
        }, 5000);
      });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
