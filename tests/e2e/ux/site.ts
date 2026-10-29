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
    headers: { "x-terrarium-user": "%EC%97%B0%EC%88%98" },
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
  const scenarios = await json<Array<{ id: string }>>(base, "/api/scenarios");
  const experiments = await json<ExperimentItem[]>(base, "/api/experiments");
  const root = experiments.find((e) => !e.experiment.parentId && e.status === "completed");
  const forked = experiments.find((e) => e.experiment.parentId && e.status === "completed");
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
    scenario: scenarios[0].id,
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
  { key: "notFound", path: "/nowhere", missing: true },
];

/** Open a page and wait until it has stopped loading. */
export async function open(page: Page, base: string, path: string): Promise<void> {
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  await page
    .locator(".loading")
    .first()
    .waitFor({ state: "detached", timeout: 15_000 })
    .catch(() => undefined);
  if (path.startsWith("/worlds/") || path.startsWith("/scenarios/"))
    await page.waitForTimeout(1200);
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
