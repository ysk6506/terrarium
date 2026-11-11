/**
 * Nothing fixed on the builder's screen may sit on another thing (REQ-111): the 다음 chip, the agents chip and its opened
 * list, the moss pill, the bar at the foot, the keys card and the buttons of the top bar. The bounding boxes are read from
 * the page, frame by frame, in every state a person meets: chip closed, chip open, keys card (wide screens), and a first
 * visit on a phone.
 */
import { appendFileSync } from "node:fs";
import type { Page } from "playwright";

export const WIDTHS: ReadonlyArray<readonly [number, number]> = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [390, 844],
];

const PHONE = { width: 390, height: 844 };

/** [name, selector]; every element the selector finds is one part. */
const PARTS: ReadonlyArray<readonly [string, string]> = [
  ["다음 칩", ".next-chip"],
  ["에이전트 칩", ".run-panel > summary"],
  ["에이전트 목록", ".run-panel[open] > ul"],
  ["이끼 알약", ".moss-launch"],
  ["아래 막대", ".stage-steps"],
  ["키보드 카드", ".kb-overlay"],
  ["윗줄 단추", ".toolbar > button, .toolbar > a, .toolbar > [role=group], .toolbar > .btn"],
];

interface Box {
  readonly name: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface Frame {
  readonly at: number;
  readonly width: number;
  readonly boxes: Box[];
}

/** A person sees a frame; one that shows the parts on each other for longer than this after a change is a bug. */
export const GRACE_MS = 300;
const WATCH_MS = 2500;

const touches = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const problemOf = (all: readonly Box[], width: number): string | undefined => {
  for (const [i, a] of all.entries()) {
    if (a.left < 0 || a.right > width) return `${a.name}이 화면 밖으로 나가요`;
    for (const b of all.slice(i + 1)) if (touches(a, b)) return `${a.name}과 ${b.name}이 겹쳐요`;
  }
  return undefined;
};

/** The script that reads the parts (a string, so no build helper is injected into the page). */
const READ = `(() => {
  const parts = ${JSON.stringify(PARTS)};
  const found = [];
  for (const [name, selector] of parts) {
    document.querySelectorAll(selector).forEach((el, i) => {
      if (el.matches(".next-chip") && el.closest(".stage-steps")) return; // the 다음 chip in the bar is part of the bar
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden")
        found.push({ name: i ? name + " " + (i + 1) : name, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    });
  }
  return found;
})()`;

/** Every drawn frame for `ms` from now: when it was and where the parts were. */
const watchScript = (ms: number): string => `
  new Promise((done) => {
    const read = () => ${READ};
    const frames = [];
    const t0 = performance.now();
    function look() {
      frames.push({ at: performance.now() - t0, width: innerWidth, boxes: read() });
      if (performance.now() - t0 < ${ms}) requestAnimationFrame(look);
      else done(frames);
    }
    requestAnimationFrame(look);
  })`;

const trace = (line: string): void => {
  if (process.env.TERRARIUM_UX_TRACE) appendFileSync(process.env.TERRARIUM_UX_TRACE, `${line}\n`);
};

const names = (boxes: readonly Box[]): string =>
  boxes.map((b) => `${b.name} ${Math.round(b.top)}-${Math.round(b.bottom)}`).join(", ");

/** Look for WATCH_MS while `act` runs: the last frame and the state at the end must be clean, and no overlap may outlast GRACE_MS. */
async function watch(
  page: Page,
  label: string,
  act?: () => Promise<void>,
): Promise<string | undefined> {
  const watching = page.evaluate<Frame[]>(watchScript(WATCH_MS));
  await act?.();
  const frames = await watching;
  const bad = frames.map((f) => ({ f, why: problemOf(f.boxes, f.width) })).filter((x) => x.why);
  const gap = Math.round(
    Math.max(0, ...frames.slice(1).map((f, i) => f.at - (frames[i]?.at ?? 0))),
  );
  const end = await page.evaluate<Box[]>(READ);
  const endWhy = problemOf(end, await page.evaluate(() => window.innerWidth));
  const last = bad.at(-1);
  const seen = `프레임 ${frames.length}개, 가장 긴 틈 ${gap}ms, 부분 ${end.length}개`;
  if (endWhy) {
    const text = `${label}: ${endWhy} (끝에서도 겹쳐 있어요; ${names(end)})`;
    trace(text);
    return text;
  }
  if (!last) {
    trace(`${label}: 겹침 없음 (${seen})`);
    return undefined;
  }
  const text = `${label}: ${last.why} (바꾼 뒤 ${Math.round(last.f.at)}ms까지, 프레임 ${bad.length}/${frames.length}; ${names(last.f.boxes)})`;
  trace(text);
  return last.f.at > GRACE_MS ? text : undefined;
}

/** Open the agents list, look, close it again. A list that cannot be pressed because something covers the chip is a failure too. */
async function withListOpen(page: Page, width: number): Promise<string | undefined> {
  const chip = page.locator(".run-panel > summary");
  if ((await chip.count()) === 0) return undefined;
  let blocked: string | undefined;
  const problem = await watch(page, `${width}px 목록 열림`, async () => {
    await chip.click({ timeout: 15_000 }).catch(() => {
      blocked = `${width}px 목록 열림: 에이전트 칩을 누를 수 없어요 (다른 것이 덮고 있어요)`;
    });
  });
  await chip.click({ timeout: 5_000 }).catch(() => undefined);
  return blocked ?? problem;
}

/** A first visit on a phone: no keys card, nothing on anything. A new page of the same person, at phone size, straight on the builder. */
async function firstVisitOnPhone(page: Page): Promise<string | undefined> {
  const phone = await page.context().newPage();
  try {
    await phone.setViewportSize(PHONE);
    await phone.goto(page.url());
    await phone.locator("canvas").first().waitFor({ timeout: 120_000 });
    await phone.waitForTimeout(2_000);
    if ((await phone.locator(".kb-overlay").count()) > 0)
      return "390px 처음 온 사람: 키보드 도움말 카드가 폰 화면에 떠 있어요";
    return (await watch(phone, "390px 처음 온 사람")) ?? (await withListOpen(phone, PHONE.width));
  } finally {
    await phone.close();
  }
}

/** What overlaps (or leaves the window) at the size the page has now, or undefined when nothing does. */
export async function overlapNow(page: Page): Promise<string | undefined> {
  return problemOf(await page.evaluate<Box[]>(READ), await page.evaluate(() => window.innerWidth));
}

/** The check at every width and in every state; returns the first problem. */
export async function overlapAtWidths(page: Page): Promise<string | undefined> {
  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    const closed = await watch(page, `${width}px 칩 닫힘`);
    if (closed) return closed;
    const open = await withListOpen(page, width);
    if (open) return open;
  }
  const phone = await firstVisitOnPhone(page);
  await page.setViewportSize({ width: WIDTHS[0]?.[0] ?? 1440, height: WIDTHS[0]?.[1] ?? 900 });
  return phone;
}
