/**
 * The slices of a measurement that CI runs side by side (ADR-0175). `groups` are journey groups whose results the slice
 * records; `fresh` also looks at the empty and error screens on a server nothing has run on; `prelude` runs the `build`
 * journey and the `flow` group first so the probes find a world, a scenario and experiments (unrecorded); `probes`
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
  "probes-a": { prelude: true, probes: ["axe", "provenance", "value"] },
  "probes-b": { prelude: true, probes: ["reach", "orientation", "motion"] },
  "probes-c": { prelude: true, probes: ["detail", "load", "keyboard"] },
  "probes-d": { prelude: true, probes: ["voice", "invalid", "progress", "colors"] },
};
