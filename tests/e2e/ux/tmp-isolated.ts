/** TEMPORARY: one journey, several times, a fresh server each. */
import { launch } from "./driver";
import { JOURNEYS, perform } from "./journeys";
import { buildWeb, startServer } from "./server";

const id = process.argv[2] ?? "own-card-only";
const times = Number(process.argv[3] ?? 3);
const work = JOURNEYS.find(([k]) => k === id)?.[1];
if (!work) throw new Error(`no journey ${id}`);
if (!process.env.SKIP_BUILD) buildWeb(process.cwd());
const browser = await launch();
try {
  for (let i = 0; i < times; i++) {
    const server = await startServer(process.cwd());
    const started = Date.now();
    try {
      const o = await perform(browser, server.url, work);
      console.log(
        `run ${i + 1}: ok=${o.ok} actions=${o.actions} note=${o.note ?? ""} ${Math.round((Date.now() - started) / 1000)}s`,
      );
    } finally {
      await server.stop();
    }
  }
} finally {
  await browser.close();
}
process.exit(0);
