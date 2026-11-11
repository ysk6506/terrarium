/**
 * What the overlap check of the builder (`overlap.ts`) cannot see (ADR-0146), read on any screen at rest:
 *  (a) a fixed or sticky thing that sits on the text of the page (only the screen's one primary action bar may float);
 *  (b) a line of the topology board that runs through the name or status text of a tile with no backing under the text;
 *  (c) a title that is cut: clipped without an ellipsis, covered by a neighbour, or out of the window.
 * Each check reads boxes and the topmost element from the page itself, so a screen that is right stays right.
 */
import type { Page } from "playwright";

/** The bars that may float over content: the screen's one primary action bar, and what is modal or short-lived. */
const MAY_FLOAT =
  ".we-bar, .stage-steps, .pt-foot, .dialog-actions, .scrim, .toasts, .summary-card";
/** Besides fixed and sticky: the help cards laid over the 3D stage. */
const ALSO_FLOATS = ".kb-overlay";
const TITLES = "h1, h2, h3, .toolbar-title b, .page-title, [class*='title']";

const SCRIPT = `(() => {
  const out = [];
  const short = (s) => s.replace(/\\s+/g, " ").trim().slice(0, 24);
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };

  // The part of the window an element can be seen in: its scrolling and clipping boxes cut it, so text at their edge is at a fold.
  const atFold = (el, r) => {
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const o = getComputedStyle(a);
      if (o.overflowY === "visible" && o.overflowX === "visible") continue;
      const b = a.getBoundingClientRect();
      if (r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5 || r.left < b.left - 0.5 || r.right > b.right + 0.5) return true;
    }
    return r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth;
  };

  // (a) floating things on text
  const floats = [...document.querySelectorAll("body *")].filter((el) => {
    if (el.matches(${JSON.stringify(MAY_FLOAT)}) || el.closest(${JSON.stringify(MAY_FLOAT)})) return false;
    const pos = getComputedStyle(el).position;
    return (pos === "fixed" || pos === "sticky" || el.matches(${JSON.stringify(ALSO_FLOATS)})) && shown(el);
  });
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent || "";
    const host = node.parentElement;
    if (!host || !text.trim() || host.closest("script, style, canvas, svg") || !shown(host)) continue;
    if (floats.some((f) => f.contains(host))) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    if (atFold(host, r)) continue;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    const on = top && floats.find((f) => f.contains(top));
    if (on) {
      out.push("떠 있는 " + (on.className && typeof on.className === "string" ? "." + on.className.split(" ")[0] : on.tagName.toLowerCase()) + "이 글자 \\"" + short(text) + "\\"를 덮어요");
      break;
    }
  }

  // (b) board lines through tile text
  const svg = document.querySelector(".topo-board svg");
  if (svg) {
    const paths = [...svg.querySelectorAll("path")].filter((p) => !p.closest(".topo-tile") && p.getAttribute("d"));
    for (const t of svg.querySelectorAll(".topo-tile text.lbl, .topo-tile text.st")) {
      const r = t.getBoundingClientRect();
      if (r.width === 0) continue;
      const backs = [...(t.closest(".topo-tile")?.querySelectorAll("rect.lbl-bg") ?? [])].map((b) => b.getBoundingClientRect());
      for (let i = 0; i <= 8; i++) for (let j = 0; j <= 2; j++) {
        const x = r.left + (r.width * i) / 8;
        const y = r.top + (r.height * (j + 0.5)) / 3;
        const hit = paths.find((p) => {
          const m = p.getScreenCTM();
          if (!m) return false;
          const pt = new DOMPoint(x, y).matrixTransform(m.inverse());
          return p.isPointInStroke(pt);
        });
        if (!hit) continue;
        const backed = backs.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) &&
          paths.every((p) => !(t.closest(".topo-tile").compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING));
        if (!backed) { out.push("보드의 선이 글자 \\"" + short(t.textContent || "") + "\\"를 가로질러요"); i = 9; break; }
      }
    }
  }

  // (c) titles cut
  for (const el of document.querySelectorAll(${JSON.stringify(TITLES)})) {
    if (!shown(el) || !(el.textContent || "").trim() || el.closest(".sr-only")) continue;
    const s = getComputedStyle(el);
    const label = short(el.textContent || "");
    const clipped = (s.overflowX === "hidden" || s.overflowX === "clip") && el.scrollWidth > el.clientWidth + 1;
    if (clipped && s.textOverflow !== "ellipsis") { out.push("제목 \\"" + label + "\\"이 줄임표 없이 잘려요"); continue; }
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((q) => q.width > 0);
    if (!rects.length) continue;
    const first = rects[0], last = rects[rects.length - 1];
    if (!clipped && (last.right > innerWidth + 1 || first.left < -1)) { out.push("제목 \\"" + label + "\\"이 화면 밖으로 나가요"); continue; }
    if (clipped) continue;
    for (const q of [first, last]) {
      if (atFold(el, q)) continue;
      const x = q.left + Math.min(q.width, 6) / 2;
      const y = q.top + q.height / 2;
      const top = document.elementFromPoint(x, y);
      if (top && !el.contains(top) && !top.contains(el) && !top.closest("canvas, .scrim")) {
        out.push("제목 \\"" + label + "\\"의 끝이 다른 것에 가려요 (" + top.tagName.toLowerCase() + "." + String(top.className).slice(0, 40) + ")"); break;
      }
    }
    let anc = el.parentElement;
    while (anc && anc !== document.body) {
      const a = getComputedStyle(anc);
      if (a.overflowX === "hidden" || a.overflowX === "clip") {
        const b = anc.getBoundingClientRect();
        if (last.right > b.right + 1 || first.left < b.left - 1) { out.push("제목 \\"" + label + "\\"이 상자 끝에서 잘려요"); break; }
      }
      anc = anc.parentElement;
    }
  }
  return out;
})()`;

/** What is wrong on the screen as it is now (empty when nothing is). */
export async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(SCRIPT);
}

/** The screen at 1440 and at 390 wide, with the page left as it was; returns the first problem, named by its width. */
export async function layoutAtWidths(page: Page, label: string): Promise<string | undefined> {
  const before = page.viewportSize() ?? { width: 1440, height: 900 };
  try {
    for (const size of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(600);
      const found = await layoutProblems(page);
      if (found.length > 0) return `${label} ${size.width}px: ${found[0]}`;
    }
    return undefined;
  } finally {
    await page.setViewportSize(before);
    await page.waitForTimeout(300);
  }
}
