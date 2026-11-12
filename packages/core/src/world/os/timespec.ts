/** Time expressions of `journalctl --since`, `date -d` and friends: "10 minutes ago", "today", "2026-11-05 09:00". */
import { OS_EPOCH_MS } from "./clock";

const UNIT_S: Readonly<Record<string, number>> = {
  s: 1,
  sec: 1,
  second: 1,
  m: 60,
  min: 60,
  minute: 60,
  h: 3600,
  hour: 3600,
  hr: 3600,
  d: 86_400,
  day: 86_400,
  w: 604_800,
  week: 604_800,
};

const NAMED: Readonly<Record<string, (now: number, dayStart: number) => number>> = {
  now: (now) => now,
  today: (_now, day) => day,
  yesterday: (_now, day) => day - 86_400,
  tomorrow: (_now, day) => day + 86_400,
};

function relative(s: string, now: number): number | undefined {
  const rel = /^(-|\+)?\s*(\d+)\s*([a-z]+?)s?(?:\s+(ago|ago\.))?$/.exec(s);
  const unit = rel ? UNIT_S[rel[3] as string] : undefined;
  if (!rel || unit === undefined) return undefined;
  const secs = Number(rel[2]) * unit;
  return rel[1] === "-" || rel[4] ? now - secs : now + secs;
}

function absolute(s: string, dayStart: number): number | undefined {
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (clock)
    return dayStart + Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3] ?? 0);
  const full = /^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!full) return undefined;
  const [y, mo, d, h, mi, se] = full.slice(1).map((x) => Number(x ?? 0));
  return (Date.UTC(y as number, (mo as number) - 1, d as number, h, mi, se) - OS_EPOCH_MS) / 1000;
}

/**
 * World time (seconds) for a time expression, given the current world time `now`; undefined when it cannot be read.
 * Absolute times are read as UTC, the host's zone.
 */
export function parseTimeSpec(spec: string, now: number): number | undefined {
  const s = spec.trim().toLowerCase();
  const dayStart = Math.floor(now / 86_400) * 86_400;
  const named = NAMED[s];
  if (named) return named(now, dayStart);
  const epoch = /^@(-?\d+)$/.exec(s);
  if (epoch) return Number(epoch[1]) - OS_EPOCH_MS / 1000;
  return relative(s, now) ?? absolute(s, dayStart);
}

/** The forms of time the fake reads, for the lines of a gap. */
export const TIME_FORMS =
  "now today yesterday tomorrow, '10 minutes ago', '-2h', '+1 day', '@초', 'HH:MM[:SS]', 'YYYY-MM-DD[ HH:MM[:SS]]'";

/**
 * Whether a text `parseTimeSpec` cannot read may still be a time the real tools read (systemd.time(7), GNU date's "Date
 * input formats"): it holds a number or a word of a date. The fake reads far fewer forms than they do, so such a text
 * is treated as a gap; a text with neither is not a time to anyone and the real tool refuses it too.
 */
export const looksLikeTime = (text: string): boolean =>
  /\d|\b(mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|noon|midnight|last|next|ago|week|month|year)/i.test(
    text,
  );
