/** Finding and liking: can people get to things, does the page tell where they are, does it look and load as designed. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { asVisitor, open, pagesOf, record, type Site, settle, type Tally, tally } from "./site";

// ----------------------------------------------------------------------------- colours

const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|color-mix)\(/g;

/** Colour values in the stylesheet, and the ones written outside the blocks that define the theme tokens. */
export function colors(root: string): { literals: number; offToken: number } {
  const css = readFileSync(path.join(root, "apps/web/src/styles.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const stack: string[] = [];
  let literals = 0;
  let offToken = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      stack.push(css.slice(start, i).trim());
      start = i + 1;
    } else if (ch === "}" || ch === ";") {
      const found = (css.slice(start, i).match(COLOR) ?? []).length;
      literals += found;
      const inTheme = stack.some((s) => /:root|\[data-theme/.test(s));
      if (!inTheme) offToken += found;
      if (ch === "}") stack.pop();
      start = i + 1;
    }
  }
  return { literals, offToken };
}

// ----------------------------------------------------------------------------- load

export async function load(site: Site): Promise<{ kb: number; ms: number; sceneDrawn: boolean }> {
  return asVisitor(site, {}, async (v) => {
    let bytes = 0;
    const pending: Array<Promise<void>> = [];
    v.page.on("response", (r) => {
      if (["script", "stylesheet", "font", "image"].includes(r.request().resourceType()))
        pending.push(
          // What went over the wire (compressed), not what the browser unpacked.
          r
            .request()
            .sizes()
            .then(
              (s) => {
                bytes += s.responseBodySize;
              },
              () => undefined,
            ),
        );
    });
    const started = Date.now();
    await v.page.goto(site.base, { waitUntil: "domcontentloaded" });
    await v.page.locator("h1").first().waitFor({ timeout: 15_000 });
    const ms = Date.now() - started;
    await settle(v.page);
    await Promise.all(pending);
    // Counted before the world screen opens: the budget is for what home itself downloads.
    const kb = bytes / 1024;
    await open(v.page, site.base, `/worlds/${site.ids.world}`);
    await v.page.waitForTimeout(1500);
    const shot = await v.page.locator("canvas").first().screenshot();
    return { kb, ms, sceneDrawn: shot.length > 12_000 };
  });
}

// ----------------------------------------------------------------------------- reach

const EXPECTED: ReadonlyArray<readonly [string, RegExp]> = [
  ["홈", /^\/$/],
  ["세계 목록", /^\/worlds$/],
  ["세계", /^\/worlds\/[^/]+$/],
  ["시나리오 목록", /^\/scenarios$/],
  ["시나리오", /^\/scenarios\/[^/]+$/],
  ["실험 목록", /^\/experiments$/],
  ["새 실험", /^\/experiments\/new$/],
  ["실험", /^\/experiments\/e-[^/]+$/],
  ["실행", /^\/runs\/[^/]+$/],
  ["벤치마크", /^\/benchmarks$/],
];

const LINKS = `() => [...document.querySelectorAll("a[href]")]
  .map((a) => new URL(a.href, location.href))
  .filter((u) => u.origin === location.origin && !u.pathname.startsWith("/api/") && !u.pathname.startsWith("/r/"))
  .map((u) => u.pathname)`;

/** Pages reachable from the home page by following in-app links twice. */
export async function reach(site: Site, notes: string[]): Promise<Tally> {
  const t = tally();
  const seen = new Set<string>(["/"]);
  await asVisitor(site, {}, async (v) => {
    const linksOf = async (p: string): Promise<string[]> => {
      await open(v.page, site.base, p);
      return (await v.page.evaluate(`(${LINKS})()`)) as string[];
    };
    const first = [...new Set(await linksOf("/"))];
    for (const p of first) seen.add(p);
    for (const p of first) for (const q of await linksOf(p)) seen.add(q);
  });
  for (const [name, pattern] of EXPECTED) {
    const ok = [...seen].some((p) => pattern.test(p));
    record(t, ok);
    if (!ok) notes.push(`reach: ${name}에 홈에서 두 번 눌러 닿지 못한다`);
  }
  return t;
}

// ----------------------------------------------------------------------------- orientation

/** A page tells where you are when its title is its own, it has a heading, and the navigation marks its section. */
export async function orientation(site: Site, notes: string[]): Promise<Tally> {
  const t = tally();
  const titles = new Map<string, string[]>();
  const results: Array<{
    key: string;
    title: string;
    heading: boolean;
    marked: boolean;
    missing: boolean;
  }> = [];
  await asVisitor(site, {}, async (v) => {
    for (const p of pagesOf(site.ids)) {
      await open(v.page, site.base, p.path);
      const title = await v.page.title();
      titles.set(title, [...(titles.get(title) ?? []), p.key]);
      const heading = (await v.page.locator("main h1").count()) > 0;
      const marked = (await v.page.locator("nav [aria-current=page]").count()) > 0;
      results.push({ key: p.key, title, heading, marked, missing: Boolean(p.missing) });
    }
  });
  for (const r of results) {
    const own = (titles.get(r.title) ?? []).length === 1;
    const ok = own && r.heading && (r.marked || r.missing);
    record(t, ok);
    if (!ok)
      notes.push(
        `orientation: ${r.key}: 제목 "${r.title}"${own ? "" : "(다른 화면과 같다)"} 제목글${r.heading ? "있음" : "없음"} 현재위치${r.marked || r.missing ? "표시" : "없음"}`,
      );
  }
  return t;
}
