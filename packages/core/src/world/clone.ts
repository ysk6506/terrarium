/**
 * Copies of world state. State is plain data (numbers, strings, booleans, arrays and records of them), so a
 * hand-written copy is several times faster than `structuredClone`, which every session pays once to
 * start from a warm world and once per checkpoint.
 */
import type { WorldState } from "./state";

function copy(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) {
    const out = new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i++) out[i] = copy(value[i]);
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const key in value) out[key] = copy((value as Record<string, unknown>)[key]);
  return out;
}

/** An independent copy of a world's state: changing the copy never changes the original. */
export const cloneState = (state: WorldState): WorldState => copy(state) as WorldState;
