/**
 * Repeats of a seed (ADR-0158), from both ends: the form says how many runs the choice makes before anything starts,
 * and the result of an experiment that ran each seed three times says how much the same condition shook.
 */
import type { Page } from "playwright";
import type { Context } from "./journey-kit";
import { SECOND } from "./journey-kit";
import { layoutAtWidths } from "./layout";

const bar = (page: Page) => page.getByLabel("실행할 것");

async function expectText(page: Page, text: string | RegExp, where: string): Promise<void> {
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const found = typeof text === "string" ? body.includes(text) : text.test(body);
  if (!found) throw new Error(`${where}에 '${text}'가 보이지 않는다`);
}

/**
 * On the new-experiment form: nothing about repeats shows in the summary while it is once, three times makes
 * "실행 15번 (상황 5개 × 3번씩)", and going back to once puts the summary back as it was.
 */
export async function repeatsInTheForm(c: Context): Promise<void> {
  const { page } = c.v;
  await page.getByRole("button", { name: "3번", exact: true }).waitFor({ timeout: 10 * SECOND });
  await expectText(page, "같은 상황을 몇 번씩 돌릴까요", "실험 만들기");
  const first = await bar(page).innerText();
  if (!first.includes("5회 실행"))
    throw new Error(`요약 막대가 5회 실행을 말하지 않는다: ${first}`);
  await c.d.click(page.getByRole("button", { name: "3번", exact: true }));
  await bar(page)
    .getByText("실행 15번 (상황 5개 × 3번씩)")
    .waitFor({ timeout: 5 * SECOND });
  // the box for another number is there only once 직접 is chosen
  const box = page.getByLabel("몇 번씩인지 직접 정하기");
  if ((await box.count()) !== 0) throw new Error("직접을 고르기 전에 입력칸이 보인다");
  await c.d.click(page.getByRole("button", { name: "직접", exact: true }));
  await c.d.fill(box, "4");
  await bar(page)
    .getByText("실행 20번 (상황 5개 × 4번씩)")
    .waitFor({ timeout: 5 * SECOND });
  await c.d.click(page.getByRole("button", { name: "1번", exact: true }));
  await bar(page)
    .getByText("5회 실행")
    .waitFor({ timeout: 5 * SECOND });
}

/** On the finished result of five seeds run three times: the situations table and its sentence, both widths. */
export async function shakingInTheResult(c: Context): Promise<void> {
  const { page } = c.v;
  // every cell has settled: five situations, three cells each, none still waiting
  try {
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".res-situations .res-cell").length === 15 &&
        document.querySelectorAll('.res-situations .res-cell[data-state="waiting"]').length === 0,
      undefined,
      { timeout: 90 * SECOND },
    );
  } catch {
    const cells = await page.locator(".res-situations .res-cell").count();
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    throw new Error(`칸이 15개로 채워지지 않는다 (칸 ${cells}개): ${body.slice(0, 400)}`);
  }
  await page
    .getByText(
      /^같은 상황을 3번씩 돌렸어요\. (5개 중 \d+개에서 결과가 갈렸어요|5개 모두 결과가 같았어요)\.$/,
    )
    .waitFor({ timeout: 10 * SECOND });
  const rows = await page.locator(".res-situations tbody tr").count();
  if (rows !== 5) throw new Error(`상황 줄이 ${rows}개다 (5개여야 한다)`);
  // a cell is told by its words (합격, 불합격) and its outline, not by its colour alone
  const cell = (await page.locator(".res-situations .res-cell").first().innerText()).replace(
    /\s+/g,
    " ",
  );
  if (!/합격|불합격/.test(cell)) throw new Error(`칸이 글자로 구분되지 않는다: ${cell}`);
  const plot = await page.locator(".res-plot-area").getAttribute("aria-label");
  if (!plot || !/합격 \d+번, 불합격 \d+번/.test(plot))
    throw new Error(`점 그림이 개수를 말하지 않는다: ${plot}`);
  const layout = await layoutAtWidths(page, "반복 결과");
  if (layout) throw new Error(layout);
  await summaryFitsOnAPhone(page);
  await runsFitOnAPhone(page);
}

/** At 390px the 요약 tab does not scroll sideways: the page, the dot plot and the situations table fit the window. */
async function summaryFitsOnAPhone(page: Page): Promise<void> {
  const before = page.viewportSize() ?? { width: 1440, height: 900 };
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await page.waitForTimeout(600);
    const seen = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - window.innerWidth,
      main:
        (document.querySelector(".main")?.scrollWidth ?? 0) -
        (document.querySelector(".main")?.clientWidth ?? 0),
      plot:
        (document.querySelector(".res-plot")?.getBoundingClientRect().right ?? 0) -
        window.innerWidth,
    }));
    if (seen.page > 1 || seen.main > 1)
      throw new Error(`390px 요약이 옆으로 ${Math.max(seen.page, seen.main)}px 밀려나 있다`);
    if (seen.plot > 0) throw new Error("390px 점 그림이 화면 밖으로 나간다");
  } finally {
    await page.setViewportSize(before);
    await page.waitForTimeout(300);
  }
}

/**
 * On a phone the 실행 table is a few lines per run, not eight squeezed columns: it does not scroll sideways, the way
 * into the first run is inside the screen, and a run is not a tall slab (REQ-078, REQ-118).
 */
async function runsFitOnAPhone(page: Page): Promise<void> {
  const before = page.viewportSize() ?? { width: 1440, height: 900 };
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    // a look at the 실행 tab, not a step of the person's task, so it is not counted as a hand
    await page.getByRole("link", { name: /^실행 \d+번$/ }).click();
    await page.waitForTimeout(600);
    const table = page.locator("table.runs-table");
    const seen = await table.evaluate((t) => {
      const wrap = t.closest(".table-wrap");
      const link = t.querySelector("tbody a")?.getBoundingClientRect();
      const row = t.querySelector("tbody tr")?.getBoundingClientRect();
      return {
        sideways: (wrap?.scrollWidth ?? 0) - (wrap?.clientWidth ?? 0),
        linkRight: link?.right ?? Number.POSITIVE_INFINITY,
        rowHeight: row?.height ?? Number.POSITIVE_INFINITY,
        width: window.innerWidth,
      };
    });
    if (seen.sideways > 1) throw new Error(`390px 실행 표가 옆으로 ${seen.sideways}px 밀려나 있다`);
    if (seen.linkRight > seen.width)
      throw new Error("390px 첫 실행의 들여다보기 링크가 화면 밖에 있다");
    if (seen.rowHeight > 110)
      throw new Error(`390px 실행 한 줄이 ${Math.round(seen.rowHeight)}px로 너무 높다`);
  } finally {
    await page.setViewportSize(before);
    await page.waitForTimeout(300);
  }
}
