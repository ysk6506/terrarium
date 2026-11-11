/**
 * The voice of the screens (REQ-058, ADR-0050): do they speak in one friendly tone (해요체), and does each
 * screen ask for one main thing? The browser only counts; harness/src/ux/score.ts scores.
 */
import { eachPage, open, type Site, type Tally } from "./site";

/** Every line of visible text on the page, and how many primary buttons are in view. */
export const READ_SCREEN = `() => {
  const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "OPTION", "CANVAS", "CODE", "PRE", "TEXTAREA", "INPUT"]);
  const lines = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const text = (child.textContent || "").replace(/\\s+/g, " ").trim();
        if (text.length >= 2) lines.push(text);
      } else if (child.nodeType === 1 && !skip.has(child.tagName)) {
        const s = getComputedStyle(child);
        if (s.display === "none" || s.visibility === "hidden") continue;
        if (child.hasAttribute("data-user-text")) continue;
        walk(child);
      }
    }
  };
  walk(document.body);
  const primary = [...document.querySelectorAll(".btn-primary")].filter((b) => b.getClientRects().length > 0 && !b.disabled).length;
  const labels = [...document.querySelectorAll("button, a.btn")].filter((b) => b.getClientRects().length > 0).map((b) => (b.getAttribute("aria-label") || b.textContent || "").replace(/\\s+/g, " ").trim());
  return { lines, primary, labels };
}`;

/** A sentence in the plain "-다" form (한다체) or the formal "-ㅂ니다" form: not the friendly tone. */
const PLAIN = /[가-힣]다[.?!…]*$/;
/** Everyday words that end in 다 without being a plain-form sentence. */
const NOUNS = new Set(["바다", "다다", "사다", "하다"]);

export function isPlain(line: string): boolean {
  const sentences = line.split(/(?<=[.?!])\s+/).map((s) => s.trim());
  return sentences.some((s) => {
    const last = s.split(" ").at(-1) ?? s;
    return PLAIN.test(s) && !NOUNS.has(last.replace(/[.?!…]+$/, ""));
  });
}

export interface Voice {
  /** Lines of text in the friendly tone out of all lines. */
  readonly voice: Tally;
  /** Screens that ask for one main thing at a time. */
  readonly oneThing: Tally;
  /** Buttons named for what they do, not "취소" or a plain-form sentence. */
  readonly buttons: Tally;
}

interface Screen {
  lines: string[];
  primary: number;
  labels: string[];
}

export async function voice(site: Site, notes: string[]): Promise<Voice> {
  const out = {
    voice: { tried: 0, ok: 0 },
    oneThing: { tried: 0, ok: 0 },
    buttons: { tried: 0, ok: 0 },
  };
  await eachPage(site, {}, async (v, p) => {
    if (p.missing) return;
    await open(v.page, site.base, p.path);
    const screen = (await v.page.evaluate(`(${READ_SCREEN})()`)) as Screen;
    const lines = [...new Set(screen.lines)];
    const plain = lines.filter(isPlain);
    out.voice.tried += lines.length;
    out.voice.ok += lines.length - plain.length;
    if (plain.length > 0)
      notes.push(
        `voice: ${p.key}에서 해요체가 아닌 글 ${plain.length}개: ${plain[0]?.slice(0, 40)}`,
      );
    out.oneThing.tried++;
    if (screen.primary <= 1) out.oneThing.ok++;
    else notes.push(`one-thing: ${p.key}에 주된 버튼이 ${screen.primary}개`);
    const labels = [...new Set(screen.labels.filter(Boolean))];
    const bad = labels.filter((l) => isPlain(l) || l === "취소");
    out.buttons.tried += labels.length;
    out.buttons.ok += labels.length - bad.length;
    if (bad.length > 0) notes.push(`buttons: ${p.key}의 버튼 이름 ${bad.slice(0, 3).join(", ")}`);
  });
  return out;
}
