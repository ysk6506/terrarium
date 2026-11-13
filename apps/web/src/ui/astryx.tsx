/**
 * Astryx on two screens only (ADR-0198, debt TD-0007): the audit log and the experiment's sharing. This file is the one place
 * the design system is wired in, and it is imported only by those two screens, which are opened lazily, so the first screen
 * downloads none of it. Astryx's colour mode follows this app's own choice (`<html data-theme>`), and what it writes on
 * `<html>` while it is mounted is put back when it leaves.
 */
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { type ReactNode, useEffect } from "react";
import { readSettings } from "../logic";
import { applySavedTheme, browserStore } from "./browser-store";

export function AstryxScope({ children }: { readonly children: ReactNode }) {
  const mode = readSettings(browserStore()).theme;
  // The root Theme owns `data-theme` on <html> while it lives and removes it on the way out; this app's choice is set again
  // after React has run every cleanup of this commit.
  useEffect(
    () => () => {
      queueMicrotask(applySavedTheme);
    },
    [],
  );
  return (
    <Theme theme={neutralTheme} mode={mode}>
      {children}
    </Theme>
  );
}
