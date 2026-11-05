import { type KeyValueStore, readSettings, type ThemeChoice, themeAttribute } from "../logic";

/** Put the chosen colours on the page: `<html data-theme>`, or nothing so the computer's own setting decides. */
export function applyTheme(theme: ThemeChoice): void {
  const value = themeAttribute(theme);
  if (value) document.documentElement.dataset.theme = value;
  else delete document.documentElement.dataset.theme;
}

/** The saved colour choice, put on the page before the first screen is drawn. */
export function applySavedTheme(): void {
  applyTheme(readSettings(browserStore()).theme);
}

/** This browser's local storage, or nothing when it is missing or refuses (private windows, blocked site data). */
export function browserStore(): KeyValueStore | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
