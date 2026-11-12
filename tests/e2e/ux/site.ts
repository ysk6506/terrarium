/** What the probes need to know about the running server: where it is and which things exist on it. */
import type { Browser, Page } from "playwright";
import { type Visitor, type VisitorOptions, visitor } from "./driver";

export interface Ids {
  readonly world: string;
  readonly scenario: string;
  readonly experiment: string;
  readonly fork: string;
  readonly run: string;
}

export interface Site {
  readonly browser: Browser;
  readonly base: string;
  readonly ids: Ids;
}

export interface Tally {
  tried: number;
  ok: number;
}

export const tally = (): Tally => ({ tried: 0, ok: 0 });
export const record = (t: Tally, ok: boolean): void => {
  t.tried++;
  if (ok) t.ok++;
};

async function json<T>(base: string, path: string): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    headers: { "x-terrarium-user": "%ED%95%98%EB%8A%98" },
  });
  return (await response.json()) as T;
}

interface ExperimentItem {
  readonly status: string;
  readonly experiment: { readonly id: string; readonly parentId?: string };
}

/** Find one of each thing that the journeys left behind. */
export async function findIds(base: string): Promise<Ids> {
  const worlds = await json<Array<{ id: string }>>(base, "/api/worlds");
  const scenarios = await json<Array<{ id: string; doc?: { template?: string } }>>(
    base,
    "/api/scenarios",
  );
  const experiments = await json<ExperimentItem[]>(base, "/api/experiments");
  const forked = experiments.find((e) => e.experiment.parentId && e.status === "completed");
  // The experiment the fork came from is the ordinary one (the `run` journey's); another journey may have left a root
  // experiment of a different kind (a web API one), whose page is not the page a person reads results on.
  const root =
    experiments.find((e) => e.experiment.id === forked?.experiment.parentId) ??
    experiments.find((e) => !e.experiment.parentId && e.status === "completed");
  if (!worlds[0] || !scenarios[0] || !root || !forked)
    throw new Error("여정이 남겨야 할 세계, 시나리오, 실험이 없다");
  const view = await json<{ runs: Array<{ id: string }> }>(
    base,
    `/api/experiments/${root.experiment.id}`,
  );
  const run = view.runs[0];
  if (!run) throw new Error("실험에 실행이 없다");
  return {
    world: worlds[0].id,
    // a scenario made from a template has content to look at; the bare one the author journey leaves has none
    scenario: (scenarios.find((s) => s.doc?.template) ?? scenarios[0]).id,
    experiment: root.experiment.id,
    fork: forked.experiment.id,
    run: run.id,
  };
}

export interface PageSpec {
  readonly key: string;
  readonly path: string;
  /** A page that is the app's own "not found". */
  readonly missing?: boolean;
}

export const pagesOf = (ids: Ids): PageSpec[] => [
  { key: "home", path: "/" },
  { key: "worlds", path: "/worlds" },
  { key: "world", path: `/worlds/${ids.world}` },
  { key: "scenarios", path: "/scenarios" },
  { key: "scenario", path: `/scenarios/${ids.scenario}` },
  { key: "experiments", path: "/experiments" },
  { key: "newExperiment", path: "/experiments/new" },
  { key: "experiment", path: `/experiments/${ids.experiment}` },
  { key: "fork", path: `/experiments/${ids.fork}` },
  { key: "run", path: `/runs/${ids.run}` },
  { key: "benchmarks", path: "/benchmarks" },
  { key: "connections", path: "/connections" },
  { key: "agentVersions", path: "/connections/builtin/agents/triage/versions" },
  { key: "notFound", path: "/nowhere", missing: true },
];

/**
 * Wait for the network to go quiet, but not forever: a page that keeps a live stream open (the world's
 * activity, a running experiment) is never idle, and waiting for that would only burn the clock.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
}

/** Open a page and wait until it has stopped loading. */
export async function open(page: Page, base: string, path: string): Promise<void> {
  const started = Date.now();
  await page.goto(`${base}${path}`, { waitUntil: "load" });
  await settle(page);
  const seconds = Math.round((Date.now() - started) / 1000);
  if (seconds >= 8) console.log(`note: 느린 화면 ${path} ${seconds}초`);
  await page
    .locator(".loading")
    .first()
    .waitFor({ state: "detached", timeout: 15_000 })
    .catch(() => undefined);
  if (path.startsWith("/worlds/") || path.startsWith("/scenarios/"))
    await page.waitForTimeout(1200);
}

/**
 * Run `work` on every page, each in a browser profile of its own. Letting go of a 3D world's graphics context takes seconds
 * on a machine that draws with its processor, and a page that is opened after it in the same tab waits for it: the probe
 * would then measure how long the world took to leave, not the page it is looking at.
 */
export async function eachPage(
  site: Site,
  options: VisitorOptions,
  work: (v: Visitor, page: PageSpec) => Promise<void>,
): Promise<void> {
  for (const p of pagesOf(site.ids)) await asVisitor(site, options, (v) => work(v, p));
}

/** Run `work` as a fresh visitor and always close the browser context. */
export async function asVisitor<T>(
  site: Site,
  options: VisitorOptions,
  work: (v: Visitor) => Promise<T>,
): Promise<T> {
  const v = await visitor(site.browser, options);
  try {
    return await work(v);
  } finally {
    await v.context.close();
  }
}
