/**
 * The card of one choice on a ladder (ADR-0108 item 4): a picture, a paragraph, and four short facts. The picture is
 * data, not markup: rows of boxes, lines between rows, and the one box (or none) that breaks. One drawing routine
 * (`ui/pages/chip-art.tsx`) turns it into an SVG in the app's colours, so all 46 pictures look like one set.
 */
import type { LayerId } from "@terrarium/core/world";

/** How a row of boxes is joined to the row above it. */
export type Join = "mesh" | "one" | "bus" | "none";

export interface DiagramRow {
  readonly label: string;
  readonly n: number;
  readonly join?: Join;
}

export interface Diagram {
  readonly rows: readonly DiagramRow[];
  /** The box that breaks: [row, index]. Absent when the picture shows no breaking. */
  readonly cut?: readonly [number, number];
  /** What a person who cannot see the picture reads. */
  readonly alt: string;
}

export interface ChipCard {
  readonly id: string;
  readonly layer: LayerId;
  /** On the chip itself. */
  readonly label: string;
  readonly what: string;
  readonly canLose: string;
  readonly mustNot: string;
  readonly faults: string;
  readonly cost: string;
  /** What a site choice promises, from the core's numbers: "RTO 15분 · RPO 36초" (REQ-106). */
  readonly promise?: string;
  /** One line under the ladder when this one is chosen: what it comes to. */
  readonly result: string;
  readonly diagram: Diagram;
}

/** A diagram in one line: `rows(["스파인", 2], ["리프", 4, "mesh"])`. */
export const rows = (
  alt: string,
  list: ReadonlyArray<readonly [string, number, Join?]>,
  cut?: readonly [number, number],
): Diagram => ({
  alt,
  rows: list.map(([label, n, join]) => ({ label, n, ...(join ? { join } : {}) })),
  ...(cut ? { cut } : {}),
});
