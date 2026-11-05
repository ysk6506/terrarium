/** Shared helpers for the built-in model lists. Every vendor here is fictional (REQ-045). */
import type { ModelLook } from "../models";

export const look = (
  body: string,
  accent: string,
  finish: ModelLook["finish"],
  front: ModelLook["front"],
): ModelLook => ({ body, accent, finish, front });

/** The vendors' house styles, so a row of one vendor's boxes reads as one vendor's boxes. */
export const STYLE = {
  generic: (front: ModelLook["front"]) => look("#3a3f44", "#9aa5ab", "matte", front),
  halcyon: (front: ModelLook["front"]) => look("#2b2f33", "#19b3a1", "matte", front),
  norvik: (front: ModelLook["front"]) => look("#b4babe", "#ff7a1a", "metal", front),
  aerion: (front: ModelLook["front"]) => look("#14161a", "#76c900", "matte", front),
  cobaltica: (front: ModelLook["front"]) => look("#3b4a63", "#35c6e8", "metal", front),
  hanbit: (front: ModelLook["front"]) => look("#d9dde0", "#1f3b73", "glossy", front),
  submersa: (front: ModelLook["front"]) => look("#1f5b66", "#c8f05a", "matte", front),
  arcline: (front: ModelLook["front"]) => look("#1b1e24", "#2f7bff", "matte", front),
  nimbus: (front: ModelLook["front"]) => look("#e7e9ec", "#7a4cff", "glossy", front),
  tessera: (front: ModelLook["front"]) => look("#5b6168", "#ffd23a", "metal", front),
  ferrum: (front: ModelLook["front"]) => look("#30343a", "#ff4d4d", "matte", front),
  okapi: (front: ModelLook["front"]) => look("#c9ced3", "#00875a", "metal", front),
  voltary: (front: ModelLook["front"]) => look("#22262b", "#ffb000", "matte", front),
  rackwell: (front: ModelLook["front"]) => look("#25282c", "#8d969c", "matte", front),
  lattice: (front: ModelLook["front"]) => look("#d4d8db", "#3a4046", "metal", front),
  coolvane: (front: ModelLook["front"]) => look("#dfe5e8", "#3a8dde", "glossy", front),
  aquantis: (front: ModelLook["front"]) => look("#e9eef0", "#00a3c4", "glossy", front),
  glaciera: (front: ModelLook["front"]) => look("#cdd3d6", "#2b6cb0", "metal", front),
  dynamo: (front: ModelLook["front"]) => look("#394552", "#4cd964", "metal", front),
  openframe: (front: ModelLook["front"]) => look("#2e3a44", "#f2a900", "matte", front),
  switchyard: (front: ModelLook["front"]) => look("#8c969e", "#d9381e", "metal", front),
};
