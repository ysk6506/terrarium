/**
 * The things people come to Terrarium to do, done the way a person does them: from the home page,
 * through the screen's own buttons. Each journey throws when it cannot be finished; the runner turns
 * that into "not ok" and counts the actions it took.
 */
import type { Browser, Page } from "playwright";
import { Driver, nav, type Visitor, visitor } from "./driver";

export type JourneyId =
  | "build"
  | "design"
  | "run"
  | "cancel"
  | "share"
  | "fork"
  | "compare"
  | "import";

export interface Outcome {
  readonly ok: boolean;
  readonly actions: number;
  readonly note?: string;
  /** Problems the browser reported while the journey ran. */
  readonly problems: readonly string[];
  /** Screens the journey passed through. */
  readonly screens: number;
}

interface Context {
  readonly browser: Browser;
  readonly base: string;
  readonly v: Visitor;
  readonly d: Driver;
}

const SECOND = 1000;

async function home(c: Context): Promise<void> {
  await c.v.page.goto(c.base, { waitUntil: "networkidle" });
}

async function expectPath(c: Context, pattern: RegExp): Promise<void> {
  await c.v.page.waitForURL((url) => pattern.test(url.pathname), { timeout: 15 * SECOND });
}

/** The experiment page is done when the pass rate shows a number. */
async function waitForResult(page: Page): Promise<void> {
  await page
    .locator(".figure", { hasText: "합격률" })
    .locator(".figure-value", { hasText: /\d/ })
    .waitFor({ timeout: 90 * SECOND });
}

async function hudText(page: Page): Promise<string> {
  return (await page.locator(".hud").innerText()).replace(/\s+/g, " ");
}

async function build(c: Context): Promise<void> {
  const { page } = c.v;
  await home(c);
  await c.d.click(nav(page, "세계"));
  await c.d.click(page.getByRole("button", { name: "새 세계" }));
  await c.d.click(page.getByRole("button", { name: "사업장으로 생성" }));
  await c.d.click(page.getByRole("button", { name: "생성하기" }));
  await expectPath(c, /^\/worlds\/w-/);
  await page
    .locator("canvas")
    .first()
    .waitFor({ timeout: 30 * SECOND });
  await page.waitForTimeout(1500);
  await c.d.click(page.getByRole("button", { name: /^랙/ }).first());
  const before = await hudText(page);
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("3D 장면의 자리를 찾지 못했다");
  let placed = false;
  for (const [fx, fy] of [
    [0.5, 0.75],
    [0.4, 0.8],
    [0.6, 0.7],
    [0.3, 0.6],
    [0.7, 0.8],
    [0.5, 0.6],
  ] as const) {
    const x = box.x + box.width * fx;
    const y = box.y + box.height * fy;
    await page.mouse.move(x, y);
    await page.waitForTimeout(200);
    await page.mouse.click(x, y);
    await page.waitForTimeout(250);
    if ((await hudText(page)) !== before) {
      placed = true;
      break;
    }
  }
  // The person points at the floor where the cursor shows a green spot: one click, however many we tried.
  c.d.actions++;
  if (!placed) throw new Error("랙을 놓지 못했다");
  await c.d.press("Control+z");
  await page.waitForTimeout(300);
  if ((await hudText(page)) !== before) throw new Error("되돌리기가 랙을 지우지 못했다");
}

async function design(c: Context): Promise<void> {
  const { page } = c.v;
  await home(c);
  await c.d.click(nav(page, "시나리오"));
  await c.d.click(page.getByRole("button", { name: "새 시나리오" }));
  const dialog = page.getByRole("dialog");
  await c.d.choose(dialog.locator("select").nth(1), "냉방기 정지");
  await c.d.click(dialog.getByRole("button", { name: "만들고 편집하기" }));
  await expectPath(c, /^\/scenarios\/s-/);
  await page
    .locator(".react-flow__node")
    .first()
    .waitFor({ timeout: 30 * SECOND });
  const before = await page.locator(".react-flow__node").count();
  await c.d.drag(
    page.locator(".palette-item", { hasText: "메모" }).first(),
    page.locator(".react-flow__pane"),
    { x: 320, y: 520 },
  );
  await page.waitForTimeout(400);
  if ((await page.locator(".react-flow__node").count()) <= before)
    throw new Error("끌어다 놓은 블록이 캔버스에 생기지 않았다");
  await c.d.click(page.getByRole("button", { name: "저장", exact: true }));
  await page.getByRole("button", { name: "저장됨" }).waitFor({ timeout: 10 * SECOND });
}

async function run(c: Context): Promise<void> {
  const { page } = c.v;
  await home(c);
  await c.d.click(page.getByRole("link", { name: "새 실험" }).first());
  await c.d.click(page.getByRole("button", { name: "실험 시작" }));
  await expectPath(c, /^\/experiments\/e-/);
  await waitForResult(page);
}

async function cancel(c: Context): Promise<void> {
  const { page } = c.v;
  await home(c);
  await c.d.click(page.getByRole("link", { name: "새 실험" }).first());
  await c.d.fill(page.getByLabel("실행 횟수"), "20");
  await c.d.click(page.getByRole("button", { name: "실험 시작" }));
  await expectPath(c, /^\/experiments\/e-/);
  await c.d.click(page.getByRole("button", { name: "취소", exact: true }));
  await c.d.click(page.getByRole("dialog").getByRole("button", { name: /회 취소$/ }));
  await page
    .getByText(/취소했다|취소됨/)
    .first()
    .waitFor({ timeout: 20 * SECOND });
}

async function openFinishedExperiment(c: Context): Promise<void> {
  const { page } = c.v;
  await home(c);
  await c.d.click(nav(page, "실험"));
  await c.d.click(page.getByRole("button", { name: "완료", exact: true }));
  const row = page.getByRole("link", { name: /알람 추적/ }).first();
  await c.d.click(row);
  await expectPath(c, /^\/experiments\/e-/);
  await waitForResult(page);
}

async function share(c: Context): Promise<void> {
  const { page } = c.v;
  await openFinishedExperiment(c);
  await c.d.click(page.getByRole("button", { name: "공유" }));
  await c.d.click(page.getByRole("menuitem", { name: /링크 복사/ }));
  await page
    .getByText("링크를 복사했다")
    .first()
    .waitFor({ timeout: 10 * SECOND });
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const guest = await visitor(c.browser, { name: null });
  try {
    const response = await guest.page.goto(link, { waitUntil: "networkidle" });
    if (!response?.ok()) throw new Error("받은 사람이 링크를 열지 못했다");
    if (!(await guest.page.locator("body").innerText()).includes("합격률"))
      throw new Error("받은 사람의 화면에 결과가 없다");
  } finally {
    await guest.context.close();
  }
}

async function fork(c: Context): Promise<void> {
  const { page } = c.v;
  await openFinishedExperiment(c);
  await c.d.click(page.getByRole("link", { name: "조건 바꿔 다시 돌리기" }));
  await expectPath(c, /^\/experiments\/new$/);
  await c.d.choose(page.getByLabel("에이전트"), "무작위 추측");
  await c.d.click(page.getByRole("button", { name: /조건 바꿔 다시 돌리기|실험 시작/ }));
  await expectPath(c, /^\/experiments\/e-/);
  await waitForResult(page);
  await page
    .getByText("원본과 견주면")
    .first()
    .waitFor({ timeout: 10 * SECOND });
}

async function compare(c: Context): Promise<void> {
  const { page } = c.v;
  await home(c);
  await c.d.click(nav(page, "벤치마크"));
  await page
    .getByRole("link", { name: "조건 바꿔 해 보기" })
    .first()
    .waitFor({ timeout: 15 * SECOND });
  await c.d.click(page.getByRole("link", { name: "조건 바꿔 해 보기" }).first());
  await expectPath(c, /^\/experiments\/new$/);
  await page.getByRole("button", { name: /조건 바꿔 다시 돌리기|실험 시작/ }).waitFor();
}

async function importWorld(c: Context): Promise<void> {
  const { page } = c.v;
  await home(c);
  await c.d.click(nav(page, "세계"));
  await c.d.click(page.getByRole("button", { name: "새 세계" }));
  await c.d.click(page.getByRole("button", { name: "현실에서 가져오기" }));
  await c.d.click(page.getByRole("button", { name: "가져오기", exact: true }));
  await expectPath(c, /^\/worlds\/w-/);
  await page
    .locator("canvas")
    .first()
    .waitFor({ timeout: 30 * SECOND });
}

/** In the order they depend on each other: later ones use what earlier ones made. */
export const JOURNEYS: ReadonlyArray<readonly [JourneyId, (c: Context) => Promise<void>]> = [
  ["build", build],
  ["design", design],
  ["run", run],
  ["cancel", cancel],
  ["share", share],
  ["fork", fork],
  ["compare", compare],
  ["import", importWorld],
];

export async function perform(
  browser: Browser,
  base: string,
  work: (c: Context) => Promise<void>,
): Promise<Outcome> {
  const v = await visitor(browser);
  const d = new Driver(v.page);
  const screens = new Set<string>();
  v.page.on(
    "framenavigated",
    (f) => f === v.page.mainFrame() && screens.add(new URL(f.url()).pathname),
  );
  try {
    await work({ browser, base, v, d });
    return {
      ok: true,
      actions: d.actions,
      problems: v.problems,
      screens: Math.max(1, screens.size),
    };
  } catch (err) {
    const note = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return {
      ok: false,
      actions: d.actions,
      note,
      problems: v.problems,
      screens: Math.max(1, screens.size),
    };
  } finally {
    await v.context.close();
  }
}
