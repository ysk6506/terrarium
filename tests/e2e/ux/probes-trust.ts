/** Trust and usability: answers to mistakes and to emptiness, progress, what the numbers say, and what a result is good for. */
import type { Page } from "playwright";
import { VIEWPORT } from "./driver";
import { asVisitor, open, record, type Site, type Tally, tally } from "./site";

/** Words that mean the screen is showing the machine's insides, not an explanation. */
const LEAKS = /\b(HTTP|undefined|null|NaN|stack|Exception)\b|\[object|Error:|\{"/;

async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").innerText()).replace(/\s+/g, " ").trim();
}

/** The ways forward a screen offers inside the page body (the navigation rail does not count). */
async function exits(page: Page): Promise<number> {
  return page.locator("main a[href], main button:not([disabled])").count();
}

export async function failures(site: Site, notes: string[]): Promise<Tally> {
  const t = tally();
  const cases = [
    "/worlds/w-nope",
    "/scenarios/s-nope",
    "/experiments/e-nope",
    "/runs/r-nope",
    "/nowhere",
  ];
  await asVisitor(site, {}, async (v) => {
    for (const path of cases) {
      await open(v.page, site.base, path);
      const text = await mainText(v.page);
      const ok = text.length >= 12 && !LEAKS.test(text) && (await exits(v.page)) > 0;
      record(t, ok);
      if (!ok) notes.push(`failure: ${path}: ${text.slice(0, 80)} (길 ${await exits(v.page)}개)`);
    }
    // The server cannot be reached at all.
    await open(v.page, site.base, "/");
    await v.context.setOffline(true);
    await v.page.getByRole("navigation").getByRole("link", { name: "세계", exact: true }).click();
    await v.page.waitForTimeout(1200);
    const text = await mainText(v.page);
    const ok = text.length >= 12 && !LEAKS.test(text) && (await exits(v.page)) > 0;
    record(t, ok);
    if (!ok) notes.push(`failure: 서버에 닿지 않을 때: ${text.slice(0, 80)}`);
  });
  return t;
}

/** Run on a server with nothing on it yet. */
export async function empties(site: Site, notes: string[]): Promise<Tally> {
  const t = tally();
  await asVisitor(site, {}, async (v) => {
    for (const path of ["/worlds", "/scenarios", "/experiments", "/benchmarks"]) {
      await open(v.page, site.base, path);
      const empty = v.page.locator(".empty").first();
      const text = (await empty.innerText().catch(() => "")).replace(/\s+/g, " ");
      const ways = await empty
        .locator("a[href], button")
        .count()
        .catch(() => 0);
      const ok = text.length >= 25 && ways > 0;
      record(t, ok);
      if (!ok) notes.push(`empty: ${path}: "${text.slice(0, 60)}" (길 ${ways}개)`);
    }
  });
  return t;
}

async function rejects(page: Page, submit: string): Promise<boolean> {
  const alerts = page.locator("[role=alert], .field-error, .note-bad, .note.bad").first();
  const shown = await alerts.waitFor({ timeout: 2500 }).then(
    () => true,
    () => false,
  );
  const text = shown ? ((await alerts.innerText()) ?? "").trim() : "";
  const button = page.getByRole("button", { name: submit, exact: true }).first();
  const blocked = (await button.isDisabled().catch(() => false)) || shown;
  return shown && text.length >= 6 && !LEAKS.test(text) && blocked;
}

export async function invalid(site: Site, notes: string[]): Promise<Tally> {
  const t = tally();
  const note = (name: string, ok: boolean) => {
    record(t, ok);
    if (!ok) notes.push(`invalid: ${name}: 잘못 넣어도 알려 주지 않는다`);
  };
  await asVisitor(site, {}, async (v) => {
    const { page } = v;
    await open(page, site.base, "/worlds");
    await page.getByRole("button", { name: "새 세계" }).click();
    await page.getByRole("button", { name: "사업장으로 생성" }).click();
    await page
      .getByLabel(/건물 수|동 수|랙/)
      .first()
      .fill("99999")
      .catch(() => undefined);
    note("세계 만들기에 말이 안 되는 크기", await rejects(page, "생성하기"));
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "새 세계" }).click();
    await page.getByRole("button", { name: "현실에서 가져오기" }).click();
    await page.getByLabel(/서버룸/).fill("없는방-zzz");
    await page.getByRole("button", { name: "가져오기", exact: true }).click();
    note("가져올 서버룸이 없을 때", await rejects(page, "가져오기"));
    await open(page, site.base, "/experiments/new");
    await page.getByLabel("실행 횟수").fill("99");
    note("실행 횟수가 너무 많을 때", await rejects(page, "실험 시작"));
  });
  await asVisitor(site, { name: null }, async (v) => {
    await open(v.page, site.base, "/");
    const dialog = v.page.getByRole("dialog");
    await dialog.getByLabel("이름").fill("");
    await dialog.getByRole("button", { name: "이 이름 쓰기" }).click();
    note("이름을 비워 둘 때", await rejects(v.page, "이 이름 쓰기"));
  });
  return t;
}

export async function progress(site: Site, notes: string[]): Promise<Tally> {
  const t = tally();
  const check = (name: string, ok: boolean) => {
    record(t, ok);
    if (!ok) notes.push(`progress: ${name}: 기다리는 동안 진행이 보이지 않는다`);
  };
  await asVisitor(site, {}, async (v) => {
    const { page } = v;
    const slow = async (pattern: string) =>
      page.route(pattern, async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await route.continue();
      });
    await slow("**/api/worlds/generate");
    await open(page, site.base, "/worlds");
    await page.getByRole("button", { name: "새 세계" }).click();
    await page.getByRole("button", { name: "사업장으로 생성" }).click();
    await page.getByRole("button", { name: "생성하기" }).click();
    await page.waitForTimeout(400);
    check("세계 생성", (await page.locator("[aria-busy=true]").count()) > 0);
    await page.waitForURL(/\/worlds\/w-/, { timeout: 30_000 });
    await page.unroute("**/api/worlds/generate");

    await slow("**/api/scenarios/*/dry-run");
    await open(page, site.base, `/scenarios/${site.ids.scenario}`);
    await page.getByRole("button", { name: "미리 돌려 보기" }).click();
    await page.waitForTimeout(400);
    check("시나리오 미리 돌려 보기", (await page.locator("[aria-busy=true]").count()) > 0);
    await page.waitForTimeout(2000);
    await page.unroute("**/api/scenarios/*/dry-run");

    await open(page, site.base, `/experiments/new?scenario=${site.ids.scenario}`);
    await page.getByLabel("실행 횟수").fill("20");
    await page.getByRole("button", { name: "실험 시작" }).click();
    await page.waitForURL(/\/experiments\/e-/, { timeout: 15_000 });
    // A small experiment can finish in a second or two, so look for the progress while it runs, not after.
    let shown = false;
    for (let waited = 0; !shown && waited < 1500; waited += 100) {
      await page.waitForTimeout(100);
      const meter = await page.locator("[role=meter], [role=progressbar], progress").count();
      shown = meter > 0 || /\d+\s*\/\s*\d+|\d+번째|\d+회 (중|끝)/.test(await mainText(page));
    }
    check("실험이 도는 동안", shown);
    const stop = page.getByRole("button", { name: "멈추기", exact: true });
    if (await stop.isVisible()) {
      await stop.click({ timeout: 3_000 }).catch(() => undefined);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /회 멈추기$/ })
        .click({ timeout: 3_000 })
        .catch(() => undefined);
    }
    // stopped, or it had already finished by itself
    await page
      .getByText(/멈췄어요|멈춤|취소됨|완료/)
      .first()
      .waitFor({ timeout: 20_000 });
  });
  return t;
}

const inFirstScreen = async (page: Page, selector: string) => {
  const box = await page
    .locator(selector)
    .first()
    .boundingBox()
    .catch(() => null);
  return box !== null && box.y >= 0 && box.y + box.height <= VIEWPORT.height;
};

/** What the numbers on the result screens say about themselves. */
export async function provenance(site: Site, notes: string[]): Promise<Tally> {
  const t = tally();
  await asVisitor(site, {}, async (v) => {
    for (const path of [`/experiments/${site.ids.experiment}`, `/runs/${site.ids.run}`]) {
      await open(v.page, site.base, path);
      const figures = v.page.locator(".figure");
      for (let i = 0; i < (await figures.count()); i++) {
        const figure = figures.nth(i);
        const label = (await figure.locator(".figure-label").innerText()).trim();
        const said = (await figure.locator(".figure-hint").count()) > 0;
        record(t, said);
        if (!said) notes.push(`provenance: ${path} "${label}"가 무엇인지 글로 밝히지 않았다`);
      }
    }
    await open(v.page, site.base, `/experiments/${site.ids.experiment}`);
    const text = await mainText(v.page);
    const stated = /재현됨|재현되지 않음/.test(text);
    record(t, stated);
    if (!stated) notes.push("provenance: 재현되는 결과인지 말하지 않는다");
  });
  return t;
}

/** What a person deciding something needs from a result, without hunting for it. */
export async function value(site: Site, notes: string[]): Promise<Tally> {
  const t = tally();
  const check = (name: string, ok: boolean) => {
    record(t, ok);
    if (!ok) notes.push(`value: ${name}`);
  };
  await asVisitor(site, {}, async (v) => {
    const { page } = v;
    await open(page, site.base, `/experiments/${site.ids.experiment}`);
    check("합격률이 첫 화면에 없다", await inFirstScreen(page, ".figure"));
    check(
      "조건을 바꿔 다시 돌리는 길이 첫 화면에 없다",
      await inFirstScreen(page, "a:has-text('조건 바꿔 다시 돌리기')"),
    );
    const text = await mainText(page);
    check("몇 번 돌린 결과인지 말하지 않는다", /\d+\s*회|\d+\s*\/\s*\d+/.test(text));
    check("오차나 믿을 만한 정도를 말하지 않는다", /오차|신뢰|±|표본|실행이 적/.test(text));
    await open(page, site.base, `/experiments/${site.ids.fork}`);
    check("원본과 견준 결과가 첫 두 화면에 없다", await twoScreens(page, "text=원본과 견주면"));
    await open(page, site.base, `/runs/${site.ids.run}`);
    check("진단의 정답과 견준 것이 없다", /정답|실제 원인|맞혔|틀렸/.test(await mainText(page)));
    await open(page, site.base, "/benchmarks");
    check("벤치마크가 순위의 근거를 말하지 않는다", /회|순위|실행/.test(await mainText(page)));
  });
  return t;
}

const twoScreens = async (page: Page, selector: string) => {
  const box = await page
    .locator(selector)
    .first()
    .boundingBox()
    .catch(() => null);
  return box !== null && box.y >= 0 && box.y < VIEWPORT.height * 2;
};
