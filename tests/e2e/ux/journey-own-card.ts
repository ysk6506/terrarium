/**
 * A person's own card, alone (REQ-111): save a catalog card as "my card", take IAP out, pick the card, and go through
 * the ladders and the sizing with nothing else; then see the world that came of it. IAP is not special: with no service at
 * all 다음 waits and says why. The builder of the world is then looked at for overlaps at four widths.
 */
import type { Page } from "playwright";
import { nav } from "./driver";
import { type Context, expectPath, home, SECOND } from "./journey-kit";
import { overlapAtWidths } from "./overlap";
import { settle } from "./site";

const rows = (page: Page) => page.locator(".we-svc:not(.add)");

async function expectRows(page: Page, names: readonly string[]): Promise<void> {
  const got = await rows(page).locator(".we-svc-name b").allInnerTexts();
  if (got.join("|") !== names.join("|"))
    throw new Error(`서비스 줄이 ${JSON.stringify(got)}인데 ${JSON.stringify(names)}여야 한다`);
}

/** ①: save the 웹 API row as my card, take IAP and that row out (0 services), then pick the saved card. */
async function pickOwnCardAlone(c: Context): Promise<void> {
  const { page } = c.v;
  await c.d.click(page.getByRole("button", { name: "+ 서비스 더하기" }));
  await c.d.click(page.getByRole("dialog").getByRole("button", { name: /^웹 API/ }));
  await c.d.click(rows(page).nth(1).getByRole("button", { name: "내 카드로 저장" }));
  await rows(page)
    .nth(1)
    .getByText("저장됨")
    .waitFor({ timeout: 10 * SECOND });
  await c.d.click(rows(page).first().getByRole("button", { name: "빼기" }));
  await expectRows(page, ["웹 API"]);
  await c.d.click(rows(page).first().getByRole("button", { name: "빼기" }));
  // no service at all: the next press waits, and one line says why
  await page.getByTestId("no-services").waitFor({ timeout: 5 * SECOND });
  if (!(await page.getByRole("button", { name: "다음", exact: true }).isDisabled()))
    throw new Error("서비스가 0개인데 다음이 눌려요");
  await c.d.click(page.getByRole("button", { name: "+ 서비스 더하기" }));
  await c.d.click(page.getByRole("dialog").getByRole("button", { name: /웹 API.*나만 봐요/ }));
  await expectRows(page, ["웹 API"]);
  if ((await page.locator("body").innerText()).includes("IAP가 이미"))
    throw new Error("IAP를 뺐는데 화면이 IAP가 골라져 있다고 말한다");
}

async function throughLaddersAndSizing(c: Context): Promise<void> {
  const { page } = c.v;
  await c.d.click(page.getByRole("button", { name: "다음", exact: true }));
  await page
    .getByRole("heading", { name: "웹 API는 어떻게 돌리나요?" })
    .waitFor({ timeout: 10 * SECOND });
  await page.getByText("서비스 1 / 1", { exact: true }).waitFor({ timeout: 5 * SECOND });
  await c.d.click(page.getByRole("button", { name: "다음", exact: true }));
  const total = page.getByTestId("size-total");
  await total.waitFor({ timeout: 10 * SECOND });
  const line = (await total.innerText()).replace(/\s+/g, " ");
  if (
    !/^서버 [\d,]+대 · 랙 [\d,]+대 \(서버 랙 [\d,]+ \+ 기반 랙 [\d,]+\) · 서버룸 [\d,]+곳$/.test(
      line,
    )
  )
    throw new Error(`③의 합계가 이상하다: ${line}`);
  // only the chosen service's load counts: 웹 API alone asks for 26 servers
  const start = await page.locator(".we-sub").first().innerText();
  if (!start.includes("모두 26대쯤"))
    throw new Error(`서버 수가 웹 API만으로 세어지지 않았다: ${start}`);
  if ((await page.locator(".we-shape-n").count()) > 0)
    throw new Error("③ 오른쪽에 숫자 타일이 남아 있다");
  await page.getByRole("heading", { name: "이 크기에서 일어나는 일" }).waitFor();
}

/** The world came without IAP, and its builder keeps the bottom right clear. */
async function lookAtTheWorld(c: Context): Promise<void> {
  const { page } = c.v;
  await expectPath(c, /^\/experiments\/e-/);
  await c.d.click(nav(page, "세계"));
  await c.d.click(page.getByRole("link", { name: /웹 API 실험용/ }).first());
  await expectPath(c, /^\/worlds\/w-/);
  await page
    .locator("canvas")
    .first()
    .waitFor({ timeout: 60 * SECOND });
  await settle(page);
  // the agents of the experiment that just started show as one chip, if any are at work yet
  await page
    .locator(".run-panel > summary")
    .waitFor({ timeout: 20 * SECOND })
    .catch(() => undefined);
  const problem = await overlapAtWidths(page);
  if (problem) throw new Error(`빌더 아래 오른쪽: ${problem}`);
}

export async function ownCardOnly(c: Context): Promise<void> {
  const { page } = c.v;
  await home(c);
  await c.d.click(nav(page, "세계"));
  await c.d.click(page.getByRole("link", { name: /^새 세계/ }));
  await c.d.click(page.getByRole("button", { name: /인프라가 필요해요/ }));
  await pickOwnCardAlone(c);
  await throughLaddersAndSizing(c);
  await c.d.click(page.getByRole("button", { name: "실험 시작", exact: true }));
  await lookAtTheWorld(c);
}
