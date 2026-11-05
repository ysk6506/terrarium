/**
 * 저장은 자동 (REQ-077, ADR-0083): the bar has no "저장" button, only a word for how the world stands. This is that
 * word, and the rule for when an edit is saved on its own: after a short pause, by the owner, once nothing in the
 * world is an error (the server refuses a world with errors, so trying again would only repeat the refusal).
 */
import { relativeTime } from "../format";

/** How long after the last edit a change is saved, ms. */
export const AUTOSAVE_MS = 1200;

export interface SaveState {
  /** Whether the viewer made this world; anyone else saves a copy by hand. */
  readonly mine: boolean;
  readonly dirty: boolean;
  readonly saving: boolean;
  /** Errors in the world: they stop a save until they are fixed. */
  readonly errors: number;
}

/** Whether a change should be saved now, on its own. */
export const shouldAutosave = (s: SaveState): boolean =>
  s.mine && s.dirty && !s.saving && s.errors === 0;

/** "저장됨 · 방금" and the other words the bar shows; `savedAt` is when the server last stored the world. */
export function saveStatus(s: SaveState, savedAt: string, now: number): string {
  if (s.saving) return "저장하는 중";
  if (!s.dirty) return `저장됨 · ${relativeTime(savedAt, now)}`;
  if (!s.mine) return "고친 것은 내 사본으로 저장해요";
  return s.errors > 0 ? "고칠 곳이 있어서 저장하지 못했어요" : "곧 저장돼요";
}
