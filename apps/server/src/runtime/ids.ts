/** Ids and timestamps for records. Injected, so tests can make them predictable. */
import { isoNow, randomToken, wallClockMs } from "@terrarium/core/kernel";

export interface Stamps {
  /** A new id with a readable prefix: w (world), s (scenario), e (experiment), r (run). */
  id(prefix: string): string;
  /** Now, as ISO 8601. */
  now(): string;
}

/** Time-ordered ids: sorting ids sorts by creation, and they are hard to guess. */
export const SYSTEM_STAMPS: Stamps = {
  id: (prefix) => `${prefix}-${wallClockMs().toString(36)}${randomToken(4)}`,
  now: isoNow,
};
