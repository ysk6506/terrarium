/**
 * The browser half of the UX measurement (REQ-041, ADR-0031): builds the web app, starts a fresh server,
 * does what people do, and writes raw counts. It decides nothing; harness/src/ux/score.ts scores them.
 *   tsx tests/e2e/ux/measure.ts --out measurements.json                      journeys and probes (mode all)
 *   tsx tests/e2e/ux/measure.ts --mode journeys [--group flow|build|own] [--only id,id] [--out file]
 * `journeys` only asks whether each journey can be finished (ADR-0141): it runs no timing or accessibility probe,
 * prints one line per journey and exits 1 when one failed. A group is a run of journeys that use what the
 * earlier ones of the group made, so each group can run on its own fresh server.
 */
import { writeFileSync } from "node:fs";
import { launch } from "./driver";
import { JOURNEY_GROUPS, JOURNEYS, perform, seedWorld } from "./journeys";
import { axe, keyboard, motion } from "./probes-a11y";
import { detail } from "./probes-detail";
import { colors, load, orientation, reach } from "./probes-find";
import { empties, failures, invalid, progress, provenance, value } from "./probes-trust";
import { voice } from "./probes-voice";
import { buildWeb, startServer } from "./server";
import { findIds, type Site } from "./site";

const argOf = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const out = argOf("--out");
const mode = argOf("--mode") ?? "all";
if (mode !== "all" && mode !== "journeys") throw new Error(`--mode는 all이나 journeys다 (${mode})`);
if (!out && mode === "all") throw new Error("--out <file>이 필요하다");
const group = argOf("--group");
const only = argOf("--only")?.split(",");
if (group && !(group in JOURNEY_GROUPS)) throw new Error(`없는 묶음이다: ${group}`);
const wanted = group ? JOURNEY_GROUPS[group] : only;
const chosen = JOURNEYS.filter(([id]) => !wanted || wanted.includes(id));
if (chosen.length === 0) throw new Error("돌릴 여정이 없다");

/** Thrown to leave the run early (journeys mode) while still closing the browser and the server. */
class Done extends Error {}

const root = process.cwd();
const notes: string[] = [];
const log = (line: string) => process.stdout.write(`${line}\n`);

// A probe that cannot finish counts as the worst case, so a broken screen never scores well by crashing.
const step = async <T>(name: string, work: () => Promise<T>, failed: T): Promise<T> => {
  const started = Date.now();
  try {
    const value = await work();
    log(`step: ${name} ${Math.round((Date.now() - started) / 1000)}초`);
    return value;
  } catch (err) {
    notes.push(
      `probe: ${name}을 끝내지 못했다: ${String(err instanceof Error ? err.message : err).split("\n")[0]}`,
    );
    return failed;
  }
};
const none = { tried: 1, ok: 0 };

buildWeb(root);
const server = await startServer(root);
const browser = await launch();
try {
  const first = { browser, base: server.url } as Site;
  const measuring = mode === "all";
  if (measuring) log("note: 빈 서버에서 빈 화면과 오류 화면을 본다");
  const emptyScreens = measuring ? await step("빈 화면", () => empties(first, notes), none) : none;
  const failureScreens = measuring
    ? await step("오류 화면", () => failures(first, notes), none)
    : none;

  await seedWorld(
    server.url,
    chosen.map(([id]) => id),
  );
  const journeys: Record<
    string,
    { ok: boolean; actions: number; note?: string; seconds?: number }
  > = {};
  const clean = { tried: 0, ok: 0 };
  for (const [id, work] of chosen) {
    const began = Date.now();
    const outcome = await perform(browser, server.url, work);
    journeys[id] = {
      ok: outcome.ok,
      actions: outcome.actions,
      seconds: Math.round((Date.now() - began) / 100) / 10,
      ...(outcome.note ? { note: outcome.note } : {}),
    };
    clean.tried += outcome.screens;
    if (outcome.problems.length === 0) clean.ok += outcome.screens;
    log(
      `note: 여정 ${id} ${outcome.ok ? "ok" : `실패 ${outcome.note}`} (${outcome.actions}번, ${journeys[id]?.seconds}초)`,
    );
    for (const p of outcome.problems) notes.push(`journey ${id}: ${p}`);
  }
  if (!measuring) {
    if (out) writeFileSync(out, JSON.stringify({ journeys }, null, 2));
    for (const n of notes) log(`note: ${n}`);
    const failed = Object.entries(journeys).filter(([, j]) => !j.ok);
    log(
      failed.length === 0
        ? "journeys: 모두 끝냈다"
        : `journeys: 못 끝낸 여정 ${failed.map(([id]) => id).join(", ")}`,
    );
    process.exitCode = failed.length === 0 ? 0 : 1;
    throw new Done();
  }

  const site: Site = { browser, base: server.url, ids: await findIds(server.url) };
  const keys = await step("키보드", () => keyboard(site, notes), { keyboard: none, focus: none });
  const result = {
    journeys,
    clean,
    invalid: await step("잘못된 입력", () => invalid(site, notes), none),
    colors: colors(root),
    progress: await step("진행 표시", () => progress(site, notes), none),
    load: await step("첫 화면", () => load(site), { kb: 1e6, ms: 1e6, sceneDrawn: false }),
    reach: await step("닿는 길", () => reach(site, notes), none),
    orientation: await step("위치 표시", () => orientation(site, notes), none),
    axe: await step("접근성 검사", () => axe(site, notes), {
      pages: 0,
      critical: 0,
      serious: 0,
      moderate: 0,
    }),
    keyboard: keys.keyboard,
    focus: keys.focus,
    motion: { animated: await step("움직임", () => motion(site, notes), 10) },
    failures: failureScreens,
    empties: emptyScreens,
    provenance: await step("수치 설명", () => provenance(site, notes), none),
    value: await step("결정에 쓸모", () => value(site, notes), none),
    ...(await step("말투와 한 가지 행동", () => voice(site, notes), {
      voice: none,
      oneThing: none,
      buttons: none,
    })),
    ...(await step("작은 부분", () => detail(site, notes), {
      targets: none,
      disabledWhy: none,
      units: none,
      hover: none,
    })),
  };
  writeFileSync(out as string, JSON.stringify(result, null, 2));
  for (const n of notes) log(`note: ${n}`);
} catch (err) {
  if (!(err instanceof Done)) throw err;
} finally {
  await browser.close();
  await server.stop();
}
