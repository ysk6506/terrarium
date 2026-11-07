/**
 * The floating 이끼 button sits above any bottom bar (REQ-104, ADR-0127): `we-bar` of the world screens, the builder's
 * step bar, the new experiment's summary. A bar marks itself with `data-bottom-bar`; the tallest one's height goes to
 * the CSS variable `--bottom-bar-h`, and the launcher's `bottom` is `max(22px, var(--bottom-bar-h) + 16px)`.
 */
export const BAR_VAR = "--bottom-bar-h";
export const BAR_SELECTOR = "[data-bottom-bar]";
/** Space between the bar and the button. */
export const BAR_GAP = 16;
/** Where the button rests with no bar. */
export const REST_BOTTOM = 22;

/** The height the variable carries: the tallest bar on the page, 0 for none. */
export const barHeight = (heights: readonly number[]): number =>
  Math.round(Math.max(0, ...heights.filter(Number.isFinite)));

/** Where the button's bottom edge is for a bar of this height (what the CSS computes). */
export const launcherBottom = (height: number): number => Math.max(REST_BOTTOM, height + BAR_GAP);

/** Keep the variable in step with the bars on the page; returns the stop function. */
export function watchBottomBars(
  root: HTMLElement = document.documentElement,
  doc: Document = document,
): () => void {
  const measure = () => {
    const heights = [...doc.querySelectorAll<HTMLElement>(BAR_SELECTOR)].map(
      (el) => el.getBoundingClientRect().height,
    );
    root.style.setProperty(BAR_VAR, `${barHeight(heights)}px`);
  };
  measure();
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : undefined;
  const watchAll = () => {
    resize?.disconnect();
    for (const el of doc.querySelectorAll(BAR_SELECTOR)) resize?.observe(el);
    measure();
  };
  watchAll();
  const mutations =
    typeof MutationObserver === "function" ? new MutationObserver(watchAll) : undefined;
  mutations?.observe(doc.body, { childList: true, subtree: true });
  window.addEventListener("resize", measure);
  return () => {
    resize?.disconnect();
    mutations?.disconnect();
    window.removeEventListener("resize", measure);
    root.style.removeProperty(BAR_VAR);
  };
}
