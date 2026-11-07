/**
 * Where a card over the 3D view opens (REQ-109, ADR-0132): one rule for the "놓기" sheet and for the card of what is
 * picked. The sheet opens under its button; the card opens beside the thing's place in the picture. Either way it stays
 * inside the stage with a 16 px margin and never wider than `min(320, stage - 32)`, so nothing is cut off and the page
 * never scrolls sideways. Under 900 px of screen it is a sheet at the foot instead.
 */

export const CARD_MARGIN = 16;
export const CARD_MAX_WIDTH = 320;
export const SHEET_BELOW = 900;
/** The bar at the foot of the stage, which a card must not cover. */
export const BAR_HEIGHT = 56;
const GAP = 16;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly w: number;
  readonly h: number;
}

export interface Placement {
  readonly left: number;
  readonly top: number;
  /** The card sits at the foot as a sheet (narrow screens); `left`/`top` are then ignored. */
  readonly sheet: boolean;
}

/** The card's width on this stage: 320 px, or the stage less the two margins. */
export const cardWidth = (stageW: number): number =>
  Math.max(0, Math.min(CARD_MAX_WIDTH, stageW - 2 * CARD_MARGIN));

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(n, Math.max(lo, hi)));

export function placeCard(input: {
  /** In stage pixels: the thing's place (`beside`) or the corner under the button (`below`). Absent: the top right. */
  readonly anchor: Point | undefined;
  readonly stage: Size;
  readonly card: Size;
  /** The width of the screen, for the bottom sheet. */
  readonly viewport: number;
  readonly mode?: "beside" | "below";
}): Placement {
  const { anchor, stage, card, viewport } = input;
  if (viewport < SHEET_BELOW) return { left: CARD_MARGIN, top: 0, sheet: true };
  const w = Math.min(card.w, cardWidth(stage.w));
  const maxLeft = stage.w - w - CARD_MARGIN;
  const maxTop = stage.h - card.h - CARD_MARGIN - BAR_HEIGHT;
  if (!anchor)
    return { left: clamp(maxLeft, CARD_MARGIN, maxLeft), top: CARD_MARGIN, sheet: false };
  if (input.mode === "below")
    return {
      left: clamp(anchor.x, CARD_MARGIN, maxLeft),
      top: clamp(anchor.y, CARD_MARGIN, maxTop),
      sheet: false,
    };
  // beside the thing: to its right when there is room, else to its left
  const x = clamp(anchor.x, 0, stage.w);
  const right = x + GAP;
  const left = right + w + CARD_MARGIN <= stage.w ? right : x - GAP - w;
  return {
    left: clamp(left, CARD_MARGIN, maxLeft),
    top: clamp(anchor.y - card.h / 3, CARD_MARGIN, maxTop),
    sheet: false,
  };
}

/** A place that moves with the camera, held outside React so a turning view does not re-draw the page each frame. */
export interface AnchorStore {
  get(): Point | undefined;
  set(next: Point | undefined): void;
  subscribe(listener: () => void): () => void;
}

export function anchorStore(): AnchorStore {
  let at: Point | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => at,
    set(next) {
      const same =
        (next === undefined && at === undefined) ||
        (next !== undefined && at !== undefined && next.x === at.x && next.y === at.y);
      if (same) return;
      at = next;
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
