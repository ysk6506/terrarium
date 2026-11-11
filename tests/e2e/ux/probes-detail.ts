/**
 * The small details of every screen (REQ-058, ADR-0050): can a finger hit the control, does a switched-off
 * button say why, does a number say what it counts, does a button answer the pointer. The browser only
 * counts; harness/src/ux/score.ts scores.
 */
import { eachPage, open, type Site, type Tally } from "./site";

/** Controls in view that are too small, switched-off buttons, and bare numbers. */
export const READ_DETAILS = `() => {
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && !e.closest('[hidden], [aria-hidden="true"]');
  };
  const text = (e) => (e.textContent || "").replace(/\\s+/g, " ").trim();
  const name = (e) => (e.getAttribute("aria-label") || text(e) || e.getAttribute("title") || e.tagName).slice(0, 30);
  // A link inside a sentence is as big as the sentence: the rule for target size leaves it out.
  const inSentence = (a) => {
    if (a.tagName !== "A") return false;
    const p = a.parentElement;
    return Boolean(p) && text(p).length > text(a).length + 8 && getComputedStyle(a).display === "inline";
  };
  const boxOf = (e) => {
    if (e.tagName === "INPUT" && /checkbox|radio/.test(e.type)) {
      const l = e.closest("label");
      if (l) return l.getBoundingClientRect();
    }
    return e.getBoundingClientRect();
  };
  const controls = [...document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"]')]
    .filter((e) => shown(e) && !inSentence(e) && !e.classList.contains("skip-link"))
    .map((e) => { const r = boxOf(e); return { name: name(e), w: Math.round(r.width), h: Math.round(r.height) }; });
  const off = [...document.querySelectorAll('button:disabled, [aria-disabled="true"]')]
    .filter((e) => shown(e) && !e.closest("[aria-busy]") && e.getAttribute("aria-busy") !== "true")
    .map((e) => {
      const ref = (e.getAttribute("aria-describedby") || "").split(" ").map((id) => document.getElementById(id)).find(Boolean);
      return { name: name(e), why: Boolean((e.getAttribute("title") || "").trim() || (ref && text(ref))) };
    });
  const NUMBER = /^[-+−]?\\d[\\d,.]*$/;
  const numbers = [...document.querySelectorAll("body *")]
    .filter((e) => e.children.length === 0 && shown(e) && NUMBER.test(text(e)) && !e.closest("input, select, textarea, option, code, pre, canvas, [data-user-text]"))
    .map((e) => {
      const cell = e.closest("td, th");
      const table = e.closest("table");
      const rest = e.parentElement ? text(e.parentElement).replace(text(e), "") : "";
      const said = /[가-힣A-Za-z]/.test(rest) || Boolean(e.getAttribute("aria-label")) || Boolean(e.getAttribute("title"));
      const headed = Boolean(cell && table && table.querySelector("th"));
      return { value: text(e), said: said || headed };
    });
  return { controls, off, numbers };
}`;

/** The least height, and the least width, of a control that a finger or a pointer can be expected to hit (CSS pixels). */
export const TARGET_H = 32;
export const TARGET_W = 24;

interface Details {
  controls: Array<{ name: string; w: number; h: number }>;
  off: Array<{ name: string; why: boolean }>;
  numbers: Array<{ value: string; said: boolean }>;
}

export interface Detail {
  /** Controls big enough to hit out of all controls. */
  readonly targets: Tally;
  /** Switched-off buttons that say why, out of all switched-off buttons. */
  readonly disabledWhy: Tally;
  /** Numbers that say what they count out of all lone numbers. */
  readonly units: Tally;
  /** Buttons whose look changes under the pointer out of the buttons tried. */
  readonly hover: Tally;
}

/** How many buttons per screen are moved over with the pointer. */
const HOVERED_PER_PAGE = 3;

/** How a control looks right now, as one string, so two looks can be compared. */
const look = (e: Element): string => {
  const s = getComputedStyle(e);
  return [
    s.backgroundColor,
    s.color,
    s.borderColor,
    s.boxShadow,
    s.transform,
    s.filter,
    s.textDecorationLine,
    s.opacity,
  ].join("|");
};

export async function detail(site: Site, notes: string[]): Promise<Detail> {
  const out: Detail = {
    targets: { tried: 0, ok: 0 },
    disabledWhy: { tried: 0, ok: 0 },
    units: { tried: 0, ok: 0 },
    hover: { tried: 0, ok: 0 },
  };
  await eachPage(site, {}, async (v, p) => {
    if (p.missing) return;
    await open(v.page, site.base, p.path);
    const found = (await v.page.evaluate(`(${READ_DETAILS})()`)) as Details;
    const small = found.controls.filter((c) => c.h < TARGET_H || c.w < TARGET_W);
    out.targets.tried += found.controls.length;
    out.targets.ok += found.controls.length - small.length;
    if (small.length > 0)
      notes.push(
        `targets: ${p.key}에 ${TARGET_W}×${TARGET_H}px보다 작은 컨트롤 ${small.length}개: ${small
          .slice(0, 3)
          .map((c) => `${c.name}(${c.w}×${c.h})`)
          .join(", ")}`,
      );
    const silent = found.off.filter((b) => !b.why);
    out.disabledWhy.tried += found.off.length;
    out.disabledWhy.ok += found.off.length - silent.length;
    if (silent.length > 0)
      notes.push(
        `disabled: ${p.key}의 꺼진 버튼이 이유를 말하지 않음: ${silent.map((b) => b.name).join(", ")}`,
      );
    const bare = found.numbers.filter((n) => !n.said);
    out.units.tried += found.numbers.length;
    out.units.ok += found.numbers.length - bare.length;
    if (bare.length > 0)
      notes.push(
        `units: ${p.key}에 무엇인지 말하지 않는 숫자: ${bare
          .slice(0, 4)
          .map((n) => n.value)
          .join(", ")}`,
      );
    await hoverSome(v.page, p.key, out.hover, notes);
  });
  return out;
}

async function hoverSome(
  page: import("playwright").Page,
  key: string,
  hover: Tally,
  notes: string[],
): Promise<void> {
  const buttons = page.locator("button:not(:disabled), a.btn");
  const count = Math.min(await buttons.count(), 12);
  let tried = 0;
  for (let i = 0; i < count && tried < HOVERED_PER_PAGE; i++) {
    const b = buttons.nth(i);
    if (!(await b.isVisible())) continue;
    const box = await b.boundingBox();
    if (!box || box.y < 0 || box.y > 700) continue;
    // Look once with the pointer far away, once with it on the button, after the transition ends.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(220);
    const before = await b.evaluate(look);
    // The pointer goes to the middle of the button directly: `hover()` waits for animation frames to settle, which a
    // software-rendered 3D screen cannot give in time, and the wait is not what is being measured.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(260);
    const after = await b.evaluate(look);
    tried++;
    hover.tried++;
    if (before !== after) hover.ok++;
    else
      notes.push(
        `hover: ${key}의 버튼 "${((await b.textContent()) ?? "").trim().slice(0, 20)}"이 포인터에 반응하지 않음`,
      );
  }
  await page.mouse.move(0, 0);
}
