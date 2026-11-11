import { describe, expect, test } from "vitest";
import { findRoot } from "../common";
import { miniRepo } from "../test-support/mini-repo";
import { main, run } from "./moss";
import { appRoutes, buttonsIn, referencedActions, scanRegistry, tileClasses } from "./moss-scan";

const REGISTRY = `
const nav = (id: string, label: string, go: object, aliases: string[]) => ({ id, label, kind: "navigate", go, aliases });
export const GLOBAL_ACTIONS = [nav("go-home", "홈", {}, []), { id: "make", label: "만들기", kind: "change", steps: ["go-home", "do-it"] }];
export const SCREENS = {
  home: { route: "home", title: "홈", oneLine: "홈이에요.", actions: [{ id: "do-it", label: "하기", kind: "change" }, { id: "peek", label: "보기", kind: "navigate", go: { name: "home" } }] },
  settings: { route: "settings", title: "설정", oneLine: "설정이에요.", actions: [] },
};
`;
const APP = `export function view(page) { switch (page.name) { case "home": return 1; case "settings": return 2; default: return 0; } }\n`;
const HOME = `
export function Home() {
  useMossScreen("home", { run: { "do-it": () => 1 } });
  return <div><Button data-moss-action="peek">보기</Button><Button kind="primary" data-moss-action="do-it">하기</Button></div>;
}
`;

const repo = (over: Record<string, string> = {}) =>
  miniRepo({
    "apps/web/src/ui/App.tsx": APP,
    "apps/web/src/moss/registry.ts": REGISTRY,
    "apps/web/src/ui/pages/home.tsx": HOME,
    ...over,
  });
const codes = (root: string) => run(root).map((v) => `${v.code} ${v.message}`);

describe("moss check: nothing the app shows is out of 이끼's reach [REQ-103]", () => {
  test("a whole mini repo passes", () => {
    expect(codes(repo())).toEqual([]);
  });

  test("MOSS001: a route without a registry entry, and a registry entry without a route", () => {
    const missing = codes(
      repo({
        "apps/web/src/ui/App.tsx": APP.replace("default:", 'case "worlds": return 3; default:'),
      }),
    );
    expect(missing).toEqual(['MOSS001 route "worlds" has no entry in the 이끼 registry']);
    const extra = codes(
      repo({ "apps/web/src/ui/App.tsx": APP.replace('case "settings": return 2;', "") }),
    );
    expect(extra).toEqual(['MOSS001 registry names route "settings" that App.tsx does not have']);
  });

  test("MOSS001: no registry at all", () => {
    const root = miniRepo({ "apps/web/src/ui/App.tsx": APP });
    expect(codes(root)).toEqual(["MOSS001 there is no 이끼 registry"]);
  });

  test("MOSS002: an unknown action id on a button or a handler key, and a step that is not registered", () => {
    const bad = HOME.replace('data-moss-action="peek"', 'data-moss-action="nope"').replace(
      '"do-it": () => 1',
      '"do-it": () => 1, "ghost-act": () => 2',
    );
    const out = codes(repo({ "apps/web/src/ui/pages/home.tsx": bad }));
    expect(out).toContain('MOSS002 action "nope" is not in the registry');
    expect(out).toContain('MOSS002 action "ghost-act" is not in the registry');
    expect(out).toContain('MOSS002 button names unknown action "nope"');
    const steps = codes(
      repo({ "apps/web/src/moss/registry.ts": REGISTRY.replace('"do-it"]', '"do-it", "lost"]') }),
    );
    expect(steps).toContain('MOSS002 step "lost" of "make" is not a registered action');
  });

  test("MOSS002: a registered action that needs a handler and has none; a data-moss-action alone is not a handler", () => {
    const out = codes(
      repo({
        "apps/web/src/ui/pages/home.tsx": `export const Home = () => <Button data-moss-action="do-it">하기</Button>;\n`,
      }),
    );
    expect(out).toContain('MOSS002 action "do-it" has no handler');
  });

  test("MOSS002: a page button needs data-moss-action or data-moss-skip with a reason", () => {
    const page = `export const P = () => <div><Button>저장</Button><button type="button" className="btn btn-primary">확인</button><Go to={x} className="btn">가기</Go><button type="button" className="plain">쓰지 않음</button><Button data-moss-skip="폼 안">닫기</Button></div>;\n`;
    const out = codes(repo({ "apps/web/src/ui/pages/other.tsx": page }));
    expect(out.filter((m) => m.includes("has no data-moss-action"))).toEqual([
      "MOSS002 <Button> button has no data-moss-action",
      "MOSS002 <button> button has no data-moss-action",
      "MOSS002 <Go> button has no data-moss-action",
    ]);
  });

  test("MOSS004: a tile whose label is not wrapped in MossAsk fails; with MossAsk it passes", () => {
    const tile = `export const T = () => <dt className="figure-label">점수</dt>;\n`;
    expect(codes(repo({ "apps/web/src/ui/kit.tsx": tile }))).toEqual([
      'MOSS004 tile "figure-label" is drawn without MossAsk',
    ]);
    const asked = `export const T = () => <dt className="figure-label"><MossAsk question="?">점수</MossAsk></dt>;\n`;
    expect(codes(repo({ "apps/web/src/ui/kit.tsx": asked }))).toEqual([]);
  });

  test("MOSS003: an index that cannot be built is reported", () => {
    const root = repo({
      "apps/server/src/runtime/moss-index.ts": "export const x = 1;\n",
      "docs/index.md": "# 색인\n",
    });
    expect(codes(root).some((m) => m.startsWith("MOSS003 the docs index does not build"))).toBe(
      true,
    );
  });

  test("the real repository passes: every route, action, button and doc chunk is reachable", () => {
    expect(run(findRoot())).toEqual([]);
  });

  test("main prints the verdict", () => {
    const lines: string[] = [];
    expect(main(["--root", repo()], (l) => lines.push(l))).toBe(0);
    expect(lines.join("\n")).toContain("OK   moss");
  });
});

describe("moss scanners read the sources the way the check says [REQ-103]", () => {
  test("the registry scan finds routes, actions with their kind, and which need no handler", () => {
    const scan = scanRegistry("r.ts", REGISTRY);
    expect([...scan.routes].sort()).toEqual(["home", "settings"]);
    const byId = Object.fromEntries(scan.actions.map((a) => [a.id, a]));
    expect(byId["go-home"]).toMatchObject({ kind: "navigate", isStatic: true });
    expect(byId.make).toMatchObject({
      kind: "change",
      isStatic: true,
      steps: ["go-home", "do-it"],
    });
    expect(byId["do-it"]).toMatchObject({ kind: "change", isStatic: false });
  });

  test("App routes are the case labels; references say whether they are handlers or attributes", () => {
    expect(appRoutes("a.tsx", APP)).toEqual(["home", "settings"]);
    expect(
      referencedActions("p.tsx", HOME)
        .map((r) => `${r.id}:${r.via}`)
        .sort(),
    ).toEqual(["do-it:attr", "do-it:handler", "peek:attr"]);
  });

  test("buttons and tiles are found with their attributes", () => {
    const b = buttonsIn(
      "p.tsx",
      `export const P = () => <><Button data-moss-action="a" /><Button data-moss-skip>x</Button></>;`,
    );
    expect(b).toMatchObject([
      { tag: "Button", action: "a", skip: false },
      { tag: "Button", skip: true },
    ]);
    expect(
      tileClasses("t.tsx", `export const T = () => <b className={"score-tile x"} />;`, [
        "score-tile",
      ]),
    ).toEqual({ usesAsk: false, hits: [{ id: "score-tile", line: 1 }] });
  });
});

describe("the registry may be split into per-area files [REQ-114]", () => {
  const SPLIT_GLOBAL = `export const GLOBAL_ACTIONS = [{ id: "go-home", label: "홈", kind: "navigate", go: { name: "home" } }];`;
  const SPLIT_HOME = `export const HOME = { home: { route: "home", title: "홈", oneLine: "홈이에요.", actions: [{ id: "do-it", label: "하기", kind: "change" }, { id: "peek", label: "보기", kind: "navigate", go: { name: "home" } }] } };`;
  const SPLIT_SETTINGS = `export const OTHER = { settings: { route: "settings", title: "설정", oneLine: "설정이에요.", actions: [] } };`;
  const split = (over: Record<string, string> = {}) =>
    repo({
      "apps/web/src/moss/registry.ts": "export const SCREENS = { ...HOME, ...OTHER };",
      "apps/web/src/moss/registry-global.ts": SPLIT_GLOBAL,
      "apps/web/src/moss/registry-world.ts": SPLIT_HOME,
      "apps/web/src/moss/registry-other.ts": SPLIT_SETTINGS,
      ...over,
    });

  test("routes and actions spread over registry-*.ts count as one registry", () => {
    expect(codes(split())).toEqual([]);
  });

  test("a route missing from every part is still MOSS001", () => {
    const root = split({ "apps/web/src/moss/registry-other.ts": "export const OTHER = {};" });
    expect(codes(root).join("\n")).toContain('route "settings" has no entry');
  });
});
