/**
 * The sounds of the animals (REQ-105, ADR-0128), described as plain numbers so they can be tested without
 * an audio device: a meow is two short sweeps from about 600 down to 400 Hz, half a second in all; a chirp
 * is two blips at 1.6 kHz. The view turns the notes into oscillators when, and only when, someone clicks.
 */
import type { ReactiveKind } from "./animal-react";

export interface Note {
  readonly wave: "sine" | "triangle";
  /** Frequency at the start and at the end, Hz. */
  readonly from: number;
  readonly to: number;
  /** Seconds from the start of the sound, and how long it lasts. */
  readonly start: number;
  readonly dur: number;
  /** Loudest gain (0..1), and the seconds it takes to get there and to fade out. */
  readonly peak: number;
  readonly attack: number;
  readonly release: number;
}

const MEOW: readonly Note[] = [
  {
    wave: "triangle",
    from: 600,
    to: 420,
    start: 0,
    dur: 0.26,
    peak: 0.16,
    attack: 0.04,
    release: 0.12,
  },
  {
    wave: "sine",
    from: 560,
    to: 400,
    start: 0.26,
    dur: 0.24,
    peak: 0.13,
    attack: 0.03,
    release: 0.14,
  },
];

const CHIRP: readonly Note[] = [
  {
    wave: "sine",
    from: 1600,
    to: 1600,
    start: 0,
    dur: 0.07,
    peak: 0.1,
    attack: 0.01,
    release: 0.03,
  },
  {
    wave: "sine",
    from: 1600,
    to: 1600,
    start: 0.12,
    dur: 0.07,
    peak: 0.1,
    attack: 0.01,
    release: 0.03,
  },
];

export const notesOf = (kind: ReactiveKind): readonly Note[] => (kind === "cat" ? MEOW : CHIRP);

/** Seconds from the start to the end of the last note. */
export const lengthOf = (notes: readonly Note[]): number =>
  Math.max(0, ...notes.map((n) => n.start + n.dur));

/** The gain of a note as straight lines: silent, up to its peak, held, down to silent (times relative to the note). */
export function envelopeOf(n: Note): ReadonlyArray<{ readonly t: number; readonly v: number }> {
  return [
    { t: 0, v: 0 },
    { t: n.attack, v: n.peak },
    { t: Math.max(n.attack, n.dur - n.release), v: n.peak },
    { t: n.dur, v: 0 },
  ];
}

/** The gain of a note `t` seconds after it starts. */
export function gainAt(n: Note, t: number): number {
  const pts = envelopeOf(n);
  if (t <= 0 || t >= n.dur) return 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as { t: number; v: number };
    const b = pts[i] as { t: number; v: number };
    if (t <= b.t) return b.t === a.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  }
  return 0;
}
