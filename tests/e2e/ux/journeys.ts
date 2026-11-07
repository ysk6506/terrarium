/**
 * The things people come to Terrarium to do, done the way a person does them: from the home page,
 * through the screen's own buttons. Each journey throws when it cannot be finished; the runner turns
 * that into "not ok" and counts the actions it took.
 */
import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus, SITE_CAMPUS_MIX } from "@terrarium/core/sources/worldgen";
import type { Browser, Page } from "playwright";
import { Driver, nav, type Visitor, visitor } from "./driver";
import { settle } from "./site";

export type JourneyId =
  | "build"
  | "design"
  | "author"
  | "run"
  | "cancel"
  | "share"
  | "fork"
  | "compare"
  | "site"
  | "build-small"
  | "topology";

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
  await c.v.page.goto(c.base, { waitUntil: "load" });
  await settle(c.v.page);
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

/** The sums in the bar at the foot of the 3D view: they change when a rack is put down. */
async function hudText(page: Page): Promise<string> {
  return (await page.locator(".step-sum").innerText()).replace(/\s+/g, " ");
}

/** From the 세계 page: 새 세계 → "데이터센터를 직접 지어요" → 작은 사업장 만들기 (the entry has two doors, ADR-0107). */
async function startSmallSite(c: Context): Promise<void> {
  const { page } = c.v;
  await c.d.click(page.getByRole("link", { name: /^새 세계/ }));
  await c.d.click(page.getByRole("button", { name: /직접 지어요/ }));
  await c.d.click(page.getByRole("button", { name: "작은 사업장 만들기" }));
}

/** A site as it is, at the smallest scale; then a rack in the first server room, and undo. */
async function build(c: Context): Promise<void> {
  const { page } = c.v;
  await home(c);
  await c.d.click(nav(page, "세계"));
  await startSmallSite(c);
  await expectPath(c, /^\/worlds\/w-/);
  await page
    .locator("canvas")
    .first()
    .waitFor({ timeout: 60 * SECOND });
  await page.waitForTimeout(1500);
  // "랙" is on the sheet inside a server room: fill the empty one first.
  await c.d.click(page.getByRole("button", { name: /^다음: 서버룸 채우기/ }));
  await c.d.click(page.getByTestId("pick-card").getByRole("button", { name: "서버룸 채우기" }));
  await page
    .locator(".step-sum")
    .getByText(/랙 24대/)
    .first()
    .waitFor({ timeout: 20 * SECOND });
  await c.d.click(page.getByRole("button", { name: "놓기", exact: true }));
  await c.d.click(page.getByRole("menuitem", { name: /^랙/ }));
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
  // REQ-109: the sheet and the cards sit beside what is picked, and the page never scrolls sideways.
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (wide > 0) throw new Error(`빌더가 가로로 ${wide}px 넘쳐요`);
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
  await c.d.click(dialog.getByRole("radio", { name: /냉방기 정지/ }));
  await c.d.click(dialog.getByRole("button", { name: "만들고 편집하기" }));
  await expectPath(c, /^\/scenarios\/s-/);
  await page
    .locator(".react-flow__node")
    .first()
    .waitFor({ timeout: 30 * SECOND });
  const before = await page.locator(".react-flow__node").count();
  // the palette opens the question the scenario is furthest along in; 메모 is a flow block
  const memo = page.locator(".palette-item", { hasText: "메모" }).first();
  if ((await memo.count()) === 0)
    await c.d.click(page.getByRole("button", { name: /에이전트가 뭘 하면 되나요/ }));
  await c.d.drag(memo, page.locator(".react-flow__pane"), { x: 320, y: 520 });
  await page.waitForTimeout(400);
  if ((await page.locator(".react-flow__node").count()) <= before)
    throw new Error("끌어다 놓은 블록이 캔버스에 생기지 않았다");
  await c.d.click(page.getByRole("button", { name: "저장", exact: true }));
  await page.getByRole("button", { name: "저장됨" }).waitFor({ timeout: 10 * SECOND });
}

/** From an empty canvas: one press adds the agent block already wired, then the exam-paper check runs. */
async function author(c: Context): Promise<void> {
  const { page } = c.v;
  await home(c);
  await c.d.click(nav(page, "시나리오"));
  await c.d.click(page.getByRole("button", { name: "새 시나리오" }));
  const dialog = page.getByRole("dialog");
  await c.d.click(dialog.getByRole("radio", { name: /빈 캔버스/ }));
  await c.d.click(dialog.getByRole("button", { name: "만들고 편집하기" }));
  await expectPath(c, /^\/scenarios\/s-/);
  await page
    .locator(".react-flow__node")
    .first()
    .waitFor({ timeout: 30 * SECOND });
  await c.d.click(page.getByRole("button", { name: "블록 더하기" }));
  await page.waitForTimeout(400);
  const nodes = await page.locator(".react-flow__node").count();
  const wires = await page.locator(".react-flow__edge").count();
  if (nodes < 2 || wires < nodes - 1) throw new Error("누른 블록이 줄에 이어지지 않았다");
  // the new block is selected, so its form is open: say what the agent is asked
  await c.d.fill(page.getByLabel("상황 설명"), "서버룸 온도 알람이 이어지고 있어요.");
  // the check lives in the panel for the whole scenario
  await c.d.click(page.locator(".react-flow__pane"), { x: 60, y: 600 });
  await c.d.click(page.getByRole("button", { name: "점검하기" }));
  await page
    .locator(".baseline")
    .first()
    .waitFor({ timeout: 60 * SECOND });
  if ((await page.locator(".baseline").count()) < 2)
    throw new Error("변별력 점검이 기준선 점수를 보여 주지 않았다");
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
  await c.d.fill(page.getByLabel("몇 번 돌릴까요"), "20");
  await c.d.click(page.getByRole("button", { name: "실험 시작" }));
  await expectPath(c, /^\/experiments\/e-/);
  await c.d.click(page.getByRole("button", { name: "멈추기", exact: true }));
  await c.d.click(page.getByRole("dialog").getByRole("button", { name: /회 멈추기$/ }));
  await page
    .getByText(/멈췄어요|멈춤|취소됨/)
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
    .getByText("링크를 복사했어요")
    .first()
    .waitFor({ timeout: 10 * SECOND });
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const guest = await visitor(c.browser, { name: null });
  try {
    const response = await guest.page.goto(link, { waitUntil: "load" });
    await settle(guest.page);
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

/** A small site: name it, make it, then buy the land beside it and see the land for sale shrink. */
async function site(c: Context): Promise<void> {
  const { page } = c.v;
  await home(c);
  await c.d.click(nav(page, "세계"));
  await startSmallSite(c);
  await expectPath(c, /^\/worlds\/w-/);
  await page
    .locator("canvas")
    .first()
    .waitFor({ timeout: 30 * SECOND });
  // "놓기" → "땅 사기" lists the land for sale, one line each.
  const buy = page.getByRole("menuitem", { name: /에 사기$/ });
  const forSale = async (): Promise<number> => {
    await page.getByRole("button", { name: "놓기", exact: true }).click();
    await page.getByRole("menuitem", { name: /^땅 사기/ }).click();
    const n = await buy.count();
    await page.keyboard.press("Escape");
    return n;
  };
  await page.getByRole("button", { name: "놓기", exact: true }).waitFor({ timeout: 15 * SECOND });
  const before = await forSale();
  await c.d.click(page.getByRole("button", { name: "놓기", exact: true }));
  await c.d.click(page.getByRole("menuitem", { name: /^땅 사기/ }));
  await c.d.click(buy.first());
  await page.waitForTimeout(500);
  if ((await forSale()) !== before - 1) throw new Error("땅을 사도 팔고 있는 땅이 줄지 않았다");
  await c.d.press("Control+z");
  await page.waitForTimeout(400);
  if ((await forSale()) !== before) throw new Error("되돌리기가 산 땅을 물리지 못했다");
}

/** 작게 시작 → 서버룸 채우기 → 시운전: the three things a first world needs, led by the 다음 할 일 chip. */
async function buildSmall(c: Context): Promise<void> {
  const { page } = c.v;
  await home(c);
  await c.d.click(nav(page, "세계"));
  await startSmallSite(c);
  await expectPath(c, /^\/worlds\/w-/);
  await page
    .locator("canvas")
    .first()
    .waitFor({ timeout: 30 * SECOND });
  await c.d.click(page.getByRole("button", { name: /^다음: 서버룸 채우기/ }));
  await c.d.click(page.getByTestId("pick-card").getByRole("button", { name: "서버룸 채우기" }));
  await page
    .locator(".step-sum")
    .getByText(/랙 24대/)
    .first()
    .waitFor({ timeout: 20 * SECOND });
  await c.d.click(page.getByRole("button", { name: /^시운전/ }).first());
  await page.getByTestId("trial-result").waitFor({ timeout: 90 * SECOND });
}

/** Most tiles the topology view may draw (ADR-0084), and the longest a person waits for the first picture. */
const MAX_TILES = 150;
const FIRST_PICTURE_MS = 3 * SECOND;

const HWASEONG = "화성 실제 그대로";

const asViewer = { "content-type": "application/json", "x-terrarium-user": "%EC%97%B0%EC%88%98" };

/** Hwaseong as it really is, made the way a person who had built it earlier would have it: it is in the list. */
async function makeHwaseong(c: Context): Promise<string> {
  const blueprint = generateCampus(
    { ...DEFAULT_CAMPUS, ...SITE_CAMPUS_MIX.hwaseong, site: "hwaseong", seed: 1, name: HWASEONG },
    new Catalog(),
  ).blueprint;
  const response = await fetch(`${c.base}/api/worlds`, {
    method: "POST",
    headers: asViewer,
    body: JSON.stringify({ name: HWASEONG, blueprint }),
  });
  if (!response.ok) throw new Error(`화성 세계를 올리지 못했다 (${response.status})`);
  return ((await response.json()) as { world: { id: string } }).world.id;
}

/** The topology view of the whole of Hwaseong: open it, change the layer, open a folded group (REQ-078). */
async function topology(c: Context): Promise<void> {
  const id = await makeHwaseong(c);
  try {
    await openTopology(c);
  } finally {
    // The probes that follow take the first world in the list: that must not be the biggest one.
    await fetch(`${c.base}/api/worlds/${id}`, { method: "DELETE", headers: asViewer }).catch(
      () => undefined,
    );
  }
}

async function openTopology(c: Context): Promise<void> {
  const { page } = c.v;
  await home(c);
  await c.d.click(nav(page, "세계"));
  await c.d.click(page.getByRole("link", { name: HWASEONG, exact: true }).first());
  await expectPath(c, /^\/worlds\/w-/);
  const open = page.getByRole("button", { name: "토폴로지", exact: true });
  await open.waitFor({ timeout: 60 * SECOND });
  // A person looks at the 3D world before pressing the eye; on a software-rendered browser the stage of this biggest
  // world takes seconds to settle, and the picture's clock starts when the press does, not while the stage still loads.
  await settle(page);
  await page.waitForTimeout(3 * SECOND);
  const started = Date.now();
  await c.d.click(open);
  const board = page.locator(".topo-board svg");
  await board.waitFor({ timeout: 60 * SECOND });
  const waited = Date.now() - started;
  if (waited > FIRST_PICTURE_MS)
    throw new Error(`첫 그림까지 ${Math.round(waited / 100) / 10}초 걸렸다`);
  const tiles = await page.locator(".topo-hits li").count();
  if (tiles === 0 || tiles > MAX_TILES)
    throw new Error(`타일이 ${tiles}개다 (1~${MAX_TILES}개여야 한다)`);
  const before = await page.locator(".topo-board").innerText();
  await c.d.click(page.getByRole("button", { name: "전원", exact: true }));
  await page.waitForFunction(
    (text) => document.querySelector(".topo-board")?.textContent !== text,
    before,
    { timeout: 10 * SECOND },
  );
  const group = page.locator(".topo-hits button[aria-label*='누르면']").first();
  await group.waitFor({ timeout: 10 * SECOND });
  // A group of one kind opens in place (more tiles), a container adds a crumb; either way the board goes one level down.
  const crumbs = await page.locator(".topo-crumbs button").count();
  const tilesBefore = await page.locator(".topo-hits li").count();
  await c.d.click(group);
  await page.waitForFunction(
    ([n, t]) =>
      document.querySelectorAll(".topo-crumbs button").length > (n as number) ||
      document.querySelectorAll(".topo-hits li").length !== t,
    [crumbs, tilesBefore],
    { timeout: 10 * SECOND },
  );
  const after = await page.locator(".topo-hits li").count();
  if (after > MAX_TILES) throw new Error(`펼치고 나서 타일이 ${after}개다`);
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
  ["site", site],
  // last: it leaves a bare scenario behind, and the journeys above want the default one to be a real scenario
  ["author", author],
  ["build-small", buildSmall],
  // last: it uses no scenario, and the Hwaseong world it uploads is the biggest one in the list (it is deleted after)
  ["topology", topology],
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
