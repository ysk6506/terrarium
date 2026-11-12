/**
 * The browser half of the UX measurement (REQ-041, ADR-0031): builds the web app, starts a fresh server,
 * does what people do, and writes raw counts. It decides nothing; harness/src/ux/score.ts scores them.
 *   tsx tests/e2e/ux/measure.ts --out measurements.json                      journeys and probes (mode all)
 *   tsx tests/e2e/ux/measure.ts --mode journeys [--group flow|build|own] [--only id,id] [--out file]
 * `journeys` only asks whether each journey can be finished (ADR-0141): it runs no timing or accessibility probe,
 * prints one line per journey and exits 1 when one failed. A group is a run of journeys that use what the
 * earlier ones of the group made, so each group can run on its own fresh server.
 *   tsx tests/e2e/ux/measure.ts --part <name> --out part.json
 * `--part` runs one slice of the measurement on a server of its own (ADR-0175): a group of journeys or some probes. The
 * probes read what the journeys left behind, so a probe slice first runs the `build` journey, the `flow` and `small` groups
 * without recording them. `pnpm ux merge` puts the slices together into the same file a whole run writes.
 */
import { writeFileSync } from "node:fs";
import { launch } from "./driver";
import { JOURNEY_GROUPS, JOURNEYS, perform, seedWorld } from "./journeys";
import { PARTS } from "./parts";
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
const partName = argOf("--part");
const part = partName ? PARTS[partName] : undefined;
if (partName && !part)
  throw new Error(`없는 조각이다: ${partName} (${Object.keys(PARTS).join(", ")})`);
if (!out && (mode === "all" || part)) throw new Error("--out <file>이 필요하다");
const group = argOf("--group");
const only = argOf("--only")?.split(",");
if (group && !(group in JOURNEY_GROUPS)) throw new Error(`없는 묶음이다: ${group}`);
const wanted = part
  ? [...(part.groups ?? []).flatMap((g) => JOURNEY_GROUPS[g] ?? [])]
  : group
    ? JOURNEY_GROUPS[group]
    : only;
/**
 * What a slice runs first, unrecorded (ADR-0175). The probes look at a server that has had the journeys run on it: a
 * world, a scenario, experiments, and several worlds (a screen with one world offers a default and another button, a
 * screen with several does not), so a probe slice runs the `build` journey, the `flow` and `small` groups.
 * The `flow` slice needs only the world that `build` makes.
 */
const PRELUDE = part?.probes
  ? [
      ...(JOURNEY_GROUPS.build ?? []),
      ...(JOURNEY_GROUPS.flow ?? []),
      ...(JOURNEY_GROUPS.small ?? []),
    ]
  : [...(JOURNEY_GROUPS.build ?? [])];
const recorded = JOURNEYS.filter(([id]) => !wanted || wanted.includes(id));
const chosen = part?.prelude
  ? JOURNEYS.filter(([id]) => PRELUDE.includes(id) || recorded.some(([r]) => r === id))
  : recorded;
if (chosen.length === 0 && !part?.probes) throw new Error("돌릴 여정이 없다");

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
const failedProbes = { pages: 0, critical: 0, serious: 0, moderate: 0 };
/** The probes, by the name a slice gives them. Each one returns the fields of the measurement it fills. */
const PROBES: Record<string, (site: Site) => Promise<Record<string, unknown>>> = {
  keyboard: async (site) => {
    const keys = await step("키보드", () => keyboard(site, notes), { keyboard: none, focus: none });
    return { keyboard: keys.keyboard, focus: keys.focus };
  },
  invalid: async (site) => ({
    invalid: await step("잘못된 입력", () => invalid(site, notes), none),
  }),
  colors: async () => ({ colors: colors(root) }),
  progress: async (site) => ({
    progress: await step("진행 표시", () => progress(site, notes), none),
  }),
  load: async (site) => ({
    load: await step("첫 화면", () => load(site), { kb: 1e6, ms: 1e6, sceneDrawn: false }),
  }),
  reach: async (site) => ({ reach: await step("닿는 길", () => reach(site, notes), none) }),
  orientation: async (site) => ({
    orientation: await step("위치 표시", () => orientation(site, notes), none),
  }),
  axe: async (site) => ({ axe: await step("접근성 검사", () => axe(site, notes), failedProbes) }),
  motion: async (site) => ({
    motion: { animated: await step("움직임", () => motion(site, notes), 10) },
  }),
  provenance: async (site) => ({
    provenance: await step("수치 설명", () => provenance(site, notes), none),
  }),
  value: async (site) => ({ value: await step("결정에 쓸모", () => value(site, notes), none) }),
  voice: async (site) => ({
    ...(await step("말투와 한 가지 행동", () => voice(site, notes), {
      voice: none,
      oneThing: none,
      buttons: none,
    })),
  }),
  detail: async (site) => ({
    ...(await step("작은 부분", () => detail(site, notes), {
      targets: none,
      disabledWhy: none,
      units: none,
      hover: none,
    })),
  }),
};
/** The order a whole run takes them in (the order they were first written in). */
const ALL_PROBES = [
  "keyboard",
  "invalid",
  "colors",
  "progress",
  "load",
  "reach",
  "orientation",
  "axe",
  "motion",
  "provenance",
  "value",
  "voice",
  "detail",
];
try {
  const first = { browser, base: server.url } as Site;
  const measuring = mode === "all" && !part;
  const looksAtEmpties = measuring || part?.fresh === true;
  if (looksAtEmpties) log("note: 빈 서버에서 빈 화면과 오류 화면을 본다");
  const emptyScreens = looksAtEmpties
    ? await step("빈 화면", () => empties(first, notes), none)
    : none;
  const failureScreens = looksAtEmpties
    ? await step("오류 화면", () => failures(first, notes), none)
    : none;

  if (chosen.length > 0)
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
    // A browser for each journey: the graphics process of one that drew a 3D world can still be busy tearing it down,
    // and the next journey would pay for that wait (software rendering on the runner).
    const once = async () => {
      const own = await launch();
      return perform(own, server.url, work).finally(() => own.close());
    };
    // A slice's prelude journeys only make what the probes look at; their results belong to the slice that records them.
    const kept = recorded.some(([r]) => r === id);
    let outcome = await once();
    // A prelude journey that failed once on a busy runner is tried up to twice more: the probes need what it makes. A recorded
    // journey is never tried twice, its failure is the score.
    for (let again = 0; !kept && !outcome.ok && again < 2; again++) {
      await new Promise((r) => setTimeout(r, 3000));
      outcome = await once();
    }
    const seconds = Math.round((Date.now() - began) / 100) / 10;
    if (kept) {
      journeys[id] = {
        ok: outcome.ok,
        actions: outcome.actions,
        seconds,
        ...(outcome.note ? { note: outcome.note } : {}),
      };
      clean.tried += outcome.screens;
      if (outcome.problems.length === 0) clean.ok += outcome.screens;
      for (const p of outcome.problems) notes.push(`journey ${id}: ${p}`);
    }
    log(
      `note: 여정 ${id} ${outcome.ok ? "ok" : `실패 ${outcome.note}`} (${outcome.actions}번, ${seconds}초)${kept ? "" : " (먼저 돌림, 기록 안 함)"}`,
    );
  }
  if (!measuring && !part?.probes) {
    if (out) {
      const extra = part
        ? {
            clean,
            ...(part.fresh ? { failures: failureScreens, empties: emptyScreens } : {}),
            notes,
            part: partName,
          }
        : {};
      writeFileSync(out, JSON.stringify({ journeys, ...extra }, null, 2));
    }
    for (const n of notes) log(`note: ${n}`);
    const failed = Object.entries(journeys).filter(([, j]) => !j.ok);
    log(
      failed.length === 0
        ? "journeys: 모두 끝냈다"
        : `journeys: 못 끝낸 여정 ${failed.map(([id]) => id).join(", ")}`,
    );
    // A slice of a measurement records what it saw and leaves the verdict to the merge: a journey that could not be
    // finished is a score, not a crash.
    process.exitCode = failed.length === 0 || part ? 0 : 1;
    throw new Done();
  }

  const site: Site = { browser, base: server.url, ids: await findIds(server.url) };
  const fields: Record<string, unknown> = {};
  for (const name of part ? (part.probes ?? []) : ALL_PROBES)
    Object.assign(
      fields,
      await (PROBES[name] as (site: Site) => Promise<Record<string, unknown>>)(site),
    );
  const result = measuring
    ? { journeys, clean, ...fields, failures: failureScreens, empties: emptyScreens }
    : { ...fields, notes, part: partName };
  writeFileSync(out as string, JSON.stringify(result, null, 2));
  for (const n of notes) log(`note: ${n}`);
} catch (err) {
  if (!(err instanceof Done)) throw err;
} finally {
  await browser.close();
  await server.stop();
}
