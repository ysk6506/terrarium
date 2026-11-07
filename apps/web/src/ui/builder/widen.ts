import type { Builder } from "./useBuilder";

/** Set when "방 넓히기" was pressed: the room's card, when it appears, opens its size boxes (read once). */
let sizeAsked = false;

/** Whether the size boxes were asked for since the last look; asking again needs a new press. */
export function takeSizeAsk(): boolean {
  const asked = sizeAsked;
  sizeAsked = false;
  return asked;
}

/**
 * The way on from a full server room: pick the room so its card shows, with the size boxes open and the cursor in
 * the width box (the card does that when it opens).
 */
export function widenRoom(b: Builder): void {
  const { level } = b.state;
  if (level.kind === "room") {
    sizeAsked = true;
    b.setSelected([level.id]);
  }
}
