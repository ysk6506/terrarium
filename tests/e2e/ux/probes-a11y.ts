/** Accessibility: axe, the keyboard alone, a visible focus, and less motion when asked. */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "playwright";
import { asVisitor, eachPage, type Ids, open, record, type Site, type Tally, tally } from "./site";

export interface AxeCounts {
  pages: number;
  critical: number;
  serious: number;
  moderate: number;
}

export async function axe(site: Site, notes: string[]): Promise<AxeCounts> {
  const counts: AxeCounts = { pages: 0, critical: 0, serious: 0, moderate: 0 };
  for (const dark of [false, true]) {
    await eachPage(site, { dark }, async (v, p) => {
      await open(v.page, site.base, p.path);
      const result = await new AxeBuilder({ page: v.page }).analyze();
      counts.pages++;
      for (const violation of result.violations) {
        const impact = violation.impact ?? "minor";
        if (impact === "critical" || impact === "serious" || impact === "moderate")
          counts[impact]++;
        notes.push(
          `axe ${dark ? "dark" : "light"} ${p.key} ${impact} ${violation.id} (${violation.nodes.length}): ${violation.nodes[0]?.target.join(" ")}`,
        );
      }
    });
  }
  return counts;
}

const FOCUS_VISIBLE = `() => {
  const e = document.activeElement;
  if (!e || e === document.body) return null;
  const s = getComputedStyle(e);
  const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
  const ring = s.boxShadow !== "none";
  return { name: (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 60), visible: outline || ring };
}`;

interface Stop {
  name: string;
  visible: boolean;
}

/** Press Tab until the focus is on something called `name`; reports every stop on the way. */
export async function tabTo(
  page: Page,
  name: string,
  max = 90,
  stops: Stop[] = [],
): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const stop = (await page.evaluate(`(${FOCUS_VISIBLE})()`)) as Stop | null;
    if (!stop) continue;
    stops.push(stop);
    if (stop.name.includes(name)) return true;
  }
  return false;
}

async function task(
  site: Site,
  path: string,
  work: (page: Page, stops: Stop[]) => Promise<boolean>,
) {
  return asVisitor(site, {}, async (v) => {
    const stops: Stop[] = [];
    await open(v.page, site.base, path);
    try {
      return { ok: await work(v.page, stops), stops };
    } catch {
      return { ok: false, stops };
    }
  });
}

type Work = (page: Page, stops: Stop[]) => Promise<boolean>;
const TASKS: ReadonlyArray<readonly [string, (ids: Ids) => string, Work]> = [
  [
    "rail",
    () => "/",
    async (page, stops) => {
      if (!(await tabTo(page, "벤치마크", 40, stops))) return false;
      await page.keyboard.press("Enter");
      await page.waitForURL(/\/benchmarks/, { timeout: 5000 });
      return true;
    },
  ],
  [
    "start",
    (ids) => `/experiments/new?scenario=${ids.scenario}`,
    async (page, stops) => {
      if (!(await tabTo(page, "실험 시작", 120, stops))) return false;
      await page.keyboard.press("Enter");
      await page.waitForURL(/\/experiments\/e-/, { timeout: 15_000 });
      return true;
    },
  ],
  [
    "menu",
    (ids) => `/experiments/${ids.experiment}`,
    async (page, stops) => {
      if (!(await tabTo(page, "공유", 60, stops))) return false;
      await page.keyboard.press("Enter");
      await page.getByRole("menuitem").first().waitFor({ timeout: 3000 });
      await page.keyboard.press("Escape");
      await page.getByRole("menuitem").first().waitFor({ state: "detached", timeout: 3000 });
      return (
        ((await page.evaluate(`(${FOCUS_VISIBLE})()`)) as Stop | null)?.name.includes("공유") ??
        false
      );
    },
  ],
  [
    "dialog",
    () => "/scenarios",
    async (page, stops) => {
      if (!(await tabTo(page, "새 시나리오", 40, stops))) return false;
      await page.keyboard.press("Enter");
      await page.getByRole("dialog").waitFor({ timeout: 3000 });
      const inside = await page.evaluate(() =>
        Boolean(document.activeElement?.closest("[role=dialog]")),
      );
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached", timeout: 3000 });
      const back =
        ((await page.evaluate(`(${FOCUS_VISIBLE})()`)) as Stop | null)?.name.includes(
          "새 시나리오",
        ) ?? false;
      return inside && back;
    },
  ],
  [
    "tabs",
    (ids) => `/scenarios/${ids.scenario}`,
    async (page, stops) => {
      if (!(await tabTo(page, "흐름", 60, stops))) return false;
      await page.keyboard.press("ArrowRight");
      await page
        .getByRole("tab", { selected: true })
        .filter({ hasText: "채점표" })
        .waitFor({ timeout: 3000 });
      return true;
    },
  ],
];

export async function keyboard(
  site: Site,
  notes: string[],
): Promise<{ keyboard: Tally; focus: Tally }> {
  const done = tally();
  const focus = tally();
  for (const [name, pathOf, work] of TASKS) {
    const result = await task(site, pathOf(site.ids), work);
    record(done, result.ok);
    if (!result.ok) notes.push(`keyboard: ${name} 못 했다`);
    for (const stop of result.stops) {
      record(focus, stop.visible);
      if (!stop.visible) notes.push(`focus: ${name}에서 초점이 안 보인다: ${stop.name}`);
    }
  }
  return { keyboard: done, focus };
}

const ANIMATED = `() => {
  let n = 0;
  for (const e of document.querySelectorAll("*")) {
    const s = getComputedStyle(e);
    const longest = (list) => Math.max(0, ...list.split(",").map((x) => parseFloat(x) * (x.trim().endsWith("ms") ? 0.001 : 1)));
    const animates = s.animationName !== "none" && longest(s.animationDuration) > 0.05;
    const moves = s.transitionProperty !== "none" && longest(s.transitionDuration) > 0.05;
    if (animates || moves) n++;
  }
  return n;
}`;

export async function motion(site: Site, notes: string[]): Promise<number> {
  let animated = 0;
  await eachPage(site, { reducedMotion: true }, async (v, p) => {
    await open(v.page, site.base, p.path);
    const n = (await v.page.evaluate(`(${ANIMATED})()`)) as number;
    if (n > 0) notes.push(`motion: ${p.key}에서 ${n}개가 줄이기를 켜도 움직인다`);
    animated += n;
  });
  return animated;
}
