import type { KeyValueStore } from "../logic";

/** This browser's local storage, or nothing when it is missing or refuses (private windows, blocked site data). */
export function browserStore(): KeyValueStore | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
