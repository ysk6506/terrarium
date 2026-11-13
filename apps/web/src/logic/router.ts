/**
 * The app's pages and their addresses. Small on purpose: a handful of pages, history API, no library.
 * Every page has one address, so any screen can be linked to and shared.
 */

/** The four views of an experiment's result; the address carries it as `?tab=`, so a link and the back button keep it. */
export type ResultTab = "summary" | "runs" | "process" | "world";

export const RESULT_TABS: readonly ResultTab[] = ["summary", "runs", "process", "world"];

export type Page =
  | { readonly name: "home" }
  | { readonly name: "worlds" }
  | { readonly name: "world"; readonly id: string }
  | {
      readonly name: "newWorld";
      /** A template to start from, and whether to change it ("조금 바꿔서") or build it as it is. */
      readonly template?: string;
      readonly change?: boolean;
      /** The door already chosen: "service" skips the first question. */
      readonly door?: "service";
    }
  | { readonly name: "scenarios"; readonly worldId?: string }
  | { readonly name: "scenario"; readonly id: string }
  /** The steps people take today for a scenario, written down for the before/after comparison (REQ-112). */
  | { readonly name: "scenarioProcess"; readonly id: string }
  | { readonly name: "experiments"; readonly mine?: boolean }
  | {
      readonly name: "newExperiment";
      readonly forkOf?: string;
      readonly scenarioId?: string;
      /** The world the new experiment starts on (after "바로 실험 만들기"). */
      readonly worldId?: string;
      /** Open pre-filled with the recommended settings of "실험 시작" (REQ-104). */
      readonly quick?: boolean;
      /** How many situations a fork starts with ("상황을 10개로 늘려 돌리기"). */
      readonly runs?: number;
    }
  | { readonly name: "experiment"; readonly id: string; readonly tab?: ResultTab }
  | { readonly name: "run"; readonly id: string }
  | { readonly name: "benchmarks"; readonly set?: string }
  | { readonly name: "connections" }
  | { readonly name: "settings" }
  /** What was done to what and by whom (ADR-0193): the whole log for an administrator, a person's own things for anyone else. */
  | { readonly name: "audit" }
  | { readonly name: "operationGuide" }
  | { readonly name: "agentVersions"; readonly connectionId: string; readonly agentId: string }
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
  { key: "worlds", label: "세계", page: { name: "worlds" }, owns: ["worlds", "world", "newWorld"] },
  {
    key: "scenarios",
    label: "시나리오",
    page: { name: "scenarios" },
    owns: ["scenarios", "scenario", "scenarioProcess"],
  },
  {
    key: "experiments",
    label: "실험",
    page: { name: "experiments" },
    owns: ["experiments", "newExperiment", "experiment", "run"],
  },
  { key: "benchmarks", label: "벤치마크", page: { name: "benchmarks" }, owns: ["benchmarks"] },
  {
    key: "connections",
    label: "연결",
    page: { name: "connections" },
    owns: ["connections", "agentVersions", "operationGuide"],
  },
];

/** The settings sit at the foot of the rail, under the others and beside the person's name. */
export const SETTINGS_SECTION = {
  key: "settings",
  label: "설정",
  page: { name: "settings" } as Page,
  owns: ["settings", "audit"] as readonly PageName[],
} as const;

export const sectionOf = (page: Page) =>
  [...SECTIONS, SETTINGS_SECTION].find((s) => s.owns.includes(page.name))?.key;

const ID = "([A-Za-z0-9._:-]+)";
/** A count from the address: a whole number from 1 to 1000, else none. */
const runsOf = (raw: string | null): number | undefined => {
  const n = Number(raw);
  return raw !== null && Number.isInteger(n) && n >= 1 && n <= 1000 ? n : undefined;
};

const PATTERNS: ReadonlyArray<[RegExp, (m: RegExpExecArray, q: URLSearchParams) => Page]> = [
  [/^\/$/, () => ({ name: "home" })],
  [/^\/worlds\/?$/, () => ({ name: "worlds" })],
  [
    /^\/worlds\/new$/,
    (_, q) => ({
      name: "newWorld",
      ...(q.get("template") ? { template: q.get("template") as string } : {}),
      ...(q.get("change") === "1" ? { change: true } : {}),
      ...(q.get("door") === "service" ? { door: "service" as const } : {}),
    }),
  ],
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
    new RegExp(`^/scenarios/${ID}/process$`),
    (m) => ({ name: "scenarioProcess", id: m[1] as string }),
  ],
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
      ...(q.get("world") ? { worldId: q.get("world") as string } : {}),
      ...(q.get("quick") === "1" ? { quick: true } : {}),
      ...(runsOf(q.get("runs")) ? { runs: runsOf(q.get("runs")) as number } : {}),
    }),
  ],
  [
    new RegExp(`^/experiments/${ID}$`),
    (m, q) => {
      const tab = RESULT_TABS.find((t) => t === q.get("tab") && t !== "summary");
      return { name: "experiment", id: m[1] as string, ...(tab ? { tab } : {}) };
    },
  ],
  [new RegExp(`^/runs/${ID}$`), (m) => ({ name: "run", id: m[1] as string })],
  [
    /^\/benchmarks\/?$/,
    (_, q) =>
      q.get("set") ? { name: "benchmarks", set: q.get("set") as string } : { name: "benchmarks" },
  ],
  [/^\/connections\/?$/, () => ({ name: "connections" })],
  [/^\/settings\/?$/, () => ({ name: "settings" })],
  [/^\/audit\/?$/, () => ({ name: "audit" })],
  [/^\/guides\/operation\/?$/, () => ({ name: "operationGuide" })],
  [
    new RegExp(`^/connections/${ID}/agents/${ID}/versions$`),
    (m) => ({
      name: "agentVersions",
      connectionId: m[1] as string,
      agentId: m[2] as string,
    }),
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
  newWorld: (p) =>
    withQuery("/worlds/new", {
      template: p.template,
      change: p.change ? "1" : undefined,
      door: p.door,
    }),
  scenarios: (p) => withQuery("/scenarios", { world: p.worldId }),
  scenario: (p) => `/scenarios/${enc(p.id)}`,
  scenarioProcess: (p) => `/scenarios/${enc(p.id)}/process`,
  experiments: (p) => withQuery("/experiments", { mine: p.mine ? "1" : undefined }),
  newExperiment: (p) =>
    withQuery("/experiments/new", {
      fork: p.forkOf,
      scenario: p.scenarioId,
      world: p.worldId,
      quick: p.quick ? "1" : undefined,
      runs: p.runs === undefined ? undefined : String(p.runs),
    }),
  experiment: (p) =>
    withQuery(`/experiments/${enc(p.id)}`, {
      tab: p.tab && p.tab !== "summary" ? p.tab : undefined,
    }),
  run: (p) => `/runs/${enc(p.id)}`,
  benchmarks: (p) => withQuery("/benchmarks", { set: p.set }),
  connections: () => "/connections",
  settings: () => "/settings",
  audit: () => "/audit",
  operationGuide: () => "/guides/operation",
  agentVersions: (p) => `/connections/${enc(p.connectionId)}/agents/${enc(p.agentId)}/versions`,
  notFound: (p) => p.path,
};

export function hrefOf(page: Page): string {
  return (HREFS[page.name] as (p: Page) => string)(page);
}

/** The title in the browser tab, so open tabs can be told apart. */
export function titleOf(page: Page, name?: string): string {
  const section = [...SECTIONS, SETTINGS_SECTION].find((s) => s.owns.includes(page.name))?.label;
  const parts = [name, page.name === "home" ? undefined : section, "테라리움"].filter(Boolean);
  if (page.name === "notFound") return "없는 화면 — 테라리움";
  if (page.name === "newExperiment") return "새 실험 — 테라리움";
  return parts.join(" — ");
}
