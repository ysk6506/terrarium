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
 * "실행 15번 (시드 5개 × 3번)", and going back to once puts the summary back as it was.
 */
export async function repeatsInTheForm(c: Context): Promise<void> {
  const { page } = c.v;
  await page.getByRole("button", { name: "3번", exact: true }).waitFor({ timeout: 10 * SECOND });
  await expectText(page, "같은 조건을 몇 번씩 돌릴까요", "실험 만들기");
  const first = await bar(page).innerText();
  if (!first.includes("5회 실행"))
    throw new Error(`요약 막대가 5회 실행을 말하지 않는다: ${first}`);
  await c.d.click(page.getByRole("button", { name: "3번", exact: true }));
  await bar(page)
    .getByText("실행 15번 (시드 5개 × 3번)")
    .waitFor({ timeout: 5 * SECOND });
  await c.d.click(page.getByRole("button", { name: "1번", exact: true }));
  await bar(page)
    .getByText("5회 실행")
    .waitFor({ timeout: 5 * SECOND });
}

/** On the finished result of a fork that ran each of five seeds three times: the shaking, the seed rows, both widths. */
export async function shakingInTheResult(c: Context): Promise<void> {
  const { page } = c.v;
  // every dot has settled: five seeds, three dots each, none still waiting
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".seed-dot").length === 15 &&
      document.querySelectorAll('.seed-dot[data-state="waiting"]').length === 0,
    undefined,
    { timeout: 90 * SECOND },
  );
  await page
    .getByText(/^시드 5개 × 3번$/)
    .first()
    .waitFor({ timeout: 10 * SECOND });
  await page.getByText(/^같은 조건에서 ±[\d.]+점 흔들려요$/).waitFor({ timeout: 10 * SECOND });
  await page.getByText(/^시드 5개 중 \d+개에서 결과가 갈렸어요$/).waitFor({ timeout: 10 * SECOND });
  const rows = await page.locator(".seed-row").count();
  if (rows !== 5) throw new Error(`시드별 줄이 ${rows}개다 (5개여야 한다)`);
  // a dot is told by its mark and its words, not by its colour alone
  const dot = page.locator(".seed-dot").first();
  const label = await dot.getAttribute("aria-label");
  const mark = (await dot.innerText()).trim();
  if (!label || !/합격|불합격/.test(label) || !/[✓✕]/.test(mark))
    throw new Error(`점이 모양이나 글자로 구분되지 않는다: ${label} / ${mark}`);
  const layout = await layoutAtWidths(page, "반복 결과");
  if (layout) throw new Error(layout);
}
