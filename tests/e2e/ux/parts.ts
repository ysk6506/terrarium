/**
 * The slices of a measurement that CI runs side by side (ADR-0175). `groups` are journey groups whose results the slice
 * records; `fresh` also looks at the empty and error screens on a server nothing has run on; `prelude` runs the `build`
 * journey (and, for the probes, the `flow` and `small` groups) first so the probes find what the journeys leave (unrecorded); `probes`
 * name the probes of the slice. Every journey and every probe is in exactly one slice.
 */
export interface Part {
  readonly groups?: readonly string[];
  readonly fresh?: boolean;
  readonly prelude?: boolean;
  readonly probes?: readonly string[];
}
export const PARTS: Readonly<Record<string, Part>> = {
  "journeys-flow": { groups: ["flow"], fresh: true, prelude: true },
  "journeys-build": { groups: ["build"] },
  "journeys-small": { groups: ["small"] },
  "journeys-own": { groups: ["own"] },
  "journeys-topology": { groups: ["topology"] },
  "probes-a": { prelude: true, probes: ["axe"] },
  "probes-b": { prelude: true, probes: ["reach", "motion"] },
  "probes-c": { prelude: true, probes: ["detail", "keyboard"] },
  "probes-d": { prelude: true, probes: ["load", "orientation"] },
  "probes-e": {
    prelude: true,
    probes: ["voice", "invalid", "progress", "colors", "provenance", "value"],
  },
};
