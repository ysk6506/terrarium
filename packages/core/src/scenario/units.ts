/**
 * Durations are stored in seconds and read in minutes. People think in minutes ("5분 기다려요"), so every place that
 * shows or asks for a duration goes through these three functions; nothing stored changes.
 */

/** Seconds as minutes: a whole number when the seconds are a whole number of minutes, otherwise one decimal. */
export function toMinutes(seconds: number): number {
  const m = seconds / 60;
  return Number.isInteger(m) ? m : Math.round(m * 10) / 10;
}

/** Minutes as the seconds that are stored. */
export const toSeconds = (minutes: number): number => Math.round(minutes * 60);

/** "5분", or "0.5분" when it is not a whole number of minutes. */
export const minutesText = (seconds: number): string => `${toMinutes(seconds)}분`;
