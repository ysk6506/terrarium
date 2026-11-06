/**
 * The words of the replay (REQ-078 step 2): a time as people say it, and the agent's speech bubble ("누가 · 무엇을
 * · 언제"). Glossary rules: 해요체, Arabic numerals with units, "툴", no "장애".
 */
import type { ToolEvent } from "@terrarium/core/world";

/** A length of time: "46초", "4분 20초", "1시간 2분". */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const parts = [h > 0 ? `${h}시간` : "", m > 0 ? `${m}분` : "", r > 0 || s === 0 ? `${r}초` : ""];
  return parts.filter(Boolean).join(" ");
}

/** What a call is doing to the world, in a few words. */
export const EFFECT_WORDS: Readonly<Record<ToolEvent["effect"], string>> = {
  observe: "살펴보는 중",
  act: "응답 기다리는 중",
  wait: "기다리는 중",
  answer: "답을 냈어요",
};

const UNITS: Readonly<Record<string, string>> = {
  celsius: "°C",
  setpointC: "°C",
  seconds: "초",
  value: "%",
};
const MAX_LABEL = 72;

function argText(key: string, value: unknown, nameOf: (id: string) => string): string {
  if (typeof value === "string") return nameOf(value);
  if (typeof value === "number") return `${value}${UNITS[key] ?? ""}`;
  if (typeof value === "boolean") return value ? "켜기" : "끄기";
  return JSON.stringify(value) ?? "";
}

/** The call as the agent wrote it: `set_cooling_setpoint(CRAH-1F-A-2, 18°C)`, cut at 72 characters. */
export function callLabel(call: ToolEvent, nameOf: (id: string) => string = (id) => id): string {
  const args = Object.entries(call.args).map(([k, v]) => argText(k, v, nameOf));
  const text = `${call.tool}(${args.join(", ")})`;
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 2)}...)` : text;
}

/** The second line of the bubble: when in the run, and how it went. */
export function callWhen(call: ToolEvent, origin: number): string {
  const state = call.ok ? EFFECT_WORDS[call.effect] : "실패했어요";
  return `${clockText(call.t - origin)} · ${state}`;
}
