/**
 * The app's pages and their addresses. Small on purpose: a handful of pages, history API, no library.
 * Every page has one address, so any screen can be linked to and shared.
 */

export type Page =
  | { readonly name: "home" }
  | { readonly name: "worlds" }
  | { readonly name: "world"; readonly id: string }
  | { readonly name: "scenarios"; readonly worldId?: string }
  | { readonly name: "scenario"; readonly id: string }
  | { readonly name: "experiments"; readonly mine?: boolean }
  | { readonly name: "newExperiment"; readonly forkOf?: string; readonly scenarioId?: string }
  | { readonly name: "experiment"; readonly id: string }
  | { readonly name: "run"; readonly id: string }
  | { readonly name: "benchmarks"; readonly set?: string }
  | { readonly name: "notFound"; readonly path: string };

export type PageName = Page["name"];

/** What the navigation rail calls each section, and which pages belong to it. */
export const SECTIONS: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly page: Page;
  readonly owns: readonly PageName[];
}> = [
  { key: "home", label: "홈", page: { name: "home" }, owns: ["home"] },
  { key: "worlds", label: "세계", page: { name: "worlds" }, owns: ["worlds", "world"] },
  {
    key: "scenarios",
    label: "시나리오",
    page: { name: "scenarios" },
    owns: ["scenarios", "scenario"],
  },
  {
    key: "experiments",
    label: "실험",
    page: { name: "experiments" },
    owns: ["experiments", "newExperiment", "experiment", "run"],
  },
  { key: "benchmarks", label: "벤치마크", page: { name: "benchmarks" }, owns: ["benchmarks"] },
];

export const sectionOf = (page: Page) => SECTIONS.find((s) => s.owns.includes(page.name))?.key;

const ID = "([A-Za-z0-9._:-]+)";
const PATTERNS: ReadonlyArray<[RegExp, (m: RegExpExecArray, q: URLSearchParams) => Page]> = [
  [/^\/$/, () => ({ name: "home" })],
  [/^\/worlds\/?$/, () => ({ name: "worlds" })],
  [new RegExp(`^/worlds/${ID}$`), (m) => ({ name: "world", id: m[1] as string })],
  [
    /^\/scenarios\/?$/,
    (_, q) =>
      q.get("world")
        ? { name: "scenarios", worldId: q.get("world") as string }
        : { name: "scenarios" },
  ],
  [new RegExp(`^/scenarios/${ID}$`), (m) => ({ name: "scenario", id: m[1] as string })],
  [
    /^\/experiments\/?$/,
    (_, q) =>
      q.get("mine") === "1" ? { name: "experiments", mine: true } : { name: "experiments" },
  ],
  [
    /^\/experiments\/new$/,
    (_, q) => ({
      name: "newExperiment",
      ...(q.get("fork") ? { forkOf: q.get("fork") as string } : {}),
      ...(q.get("scenario") ? { scenarioId: q.get("scenario") as string } : {}),
    }),
  ],
  [new RegExp(`^/experiments/${ID}$`), (m) => ({ name: "experiment", id: m[1] as string })],
  [new RegExp(`^/runs/${ID}$`), (m) => ({ name: "run", id: m[1] as string })],
  [
    /^\/benchmarks\/?$/,
    (_, q) =>
      q.get("set") ? { name: "benchmarks", set: q.get("set") as string } : { name: "benchmarks" },
  ],
];

export function parseLocation(pathname: string, search = ""): Page {
  const query = new URLSearchParams(search);
  for (const [pattern, build] of PATTERNS) {
    const m = pattern.exec(pathname);
    if (m) return build(m, query);
  }
  return { name: "notFound", path: pathname };
}

const withQuery = (path: string, query: Record<string, string | undefined>) => {
  const entries = Object.entries(query).filter((e): e is [string, string] => e[1] !== undefined);
  return entries.length === 0 ? path : `${path}?${new URLSearchParams(entries).toString()}`;
};

const enc = encodeURIComponent;

type Of<N extends PageName> = Extract<Page, { name: N }>;

const HREFS: { readonly [N in PageName]: (page: Of<N>) => string } = {
  home: () => "/",
  worlds: () => "/worlds",
  world: (p) => `/worlds/${enc(p.id)}`,
  scenarios: (p) => withQuery("/scenarios", { world: p.worldId }),
  scenario: (p) => `/scenarios/${enc(p.id)}`,
  experiments: (p) => withQuery("/experiments", { mine: p.mine ? "1" : undefined }),
  newExperiment: (p) => withQuery("/experiments/new", { fork: p.forkOf, scenario: p.scenarioId }),
  experiment: (p) => `/experiments/${enc(p.id)}`,
  run: (p) => `/runs/${enc(p.id)}`,
  benchmarks: (p) => withQuery("/benchmarks", { set: p.set }),
  notFound: (p) => p.path,
};

export function hrefOf(page: Page): string {
  return (HREFS[page.name] as (p: Page) => string)(page);
}

/** The title in the browser tab, so open tabs can be told apart. */
export function titleOf(page: Page, name?: string): string {
  const section = SECTIONS.find((s) => s.owns.includes(page.name))?.label;
  const parts = [name, page.name === "home" ? undefined : section, "테라리움"].filter(Boolean);
  if (page.name === "notFound") return "없는 화면 — 테라리움";
  if (page.name === "newExperiment") return "새 실험 — 테라리움";
  return parts.join(" — ");
}
