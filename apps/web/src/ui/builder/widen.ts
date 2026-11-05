import type { Builder } from "./useBuilder";

/**
 * The way on from a full server room: show the size boxes. The room is picked first so the panel is about it, the
 * folded "크기와 모양" is opened, and the cursor lands in the width box.
 */
export function widenRoom(b: Builder): void {
  const { level, selected } = b.state;
  if (level.kind === "room" && selected.length > 0) b.setSelected([]);
  const fold = document.querySelector<HTMLDetailsElement>('[data-fold="size"]');
  if (fold) fold.open = true;
  requestAnimationFrame(() => {
    const box = document.querySelector<HTMLInputElement>('[data-testid="size-w"]');
    box?.scrollIntoView({ block: "center" });
    box?.focus();
  });
}
