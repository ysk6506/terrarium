/**
 * What a route says about who may call it (ADR-0174). The list of things a person may be refused is small
 * and closed: the server decides each of them in one function (`may`), so a new refusal is a new word here
 * first, and the tests that walk the route table see it.
 */

/** The things decided per request, once the handler knows what the request is about. */
export const ACTIONS = [
  /** Change something: a world, scenario, connection, model, card. Its maker or an admin. */
  "change",
  /** Delete it. Its maker or an admin. */
  "remove",
  /** Stop an experiment. Its maker or an admin. */
  "cancel",
  /** Add runs to an experiment. Its maker or an admin. */
  "addRuns",
  /** Answer a run that waits for a person. The experiment's maker or an admin. */
  "answerEscalation",
  /** Mark a scenario's calibration. The scenario's maker or an admin. */
  "calibrate",
  /** Write the current-process table of a scenario. The scenario's maker or an admin. */
  "editProcess",
  /** Change an agent's version notes. The connection's maker or an admin; a config-file connection: admins. */
  "editAgentVersions",
  /** Use a connection or a registered model (try, check, keep, run an experiment on it). Anyone for a config-file connection. */
  "use",
  /** Make a share link for an experiment. The experiment's maker or an admin. */
  "createShare",
  /** See an experiment's share links. The experiment's maker or an admin. */
  "listShares",
  /** Change who can see something (its scope). Its maker or an admin; every such change is to be audited (step 다). */
  "changeScope",
  /** Take a share link back. Whoever made the link, the experiment's maker or an admin. */
  "deleteShare",
  /** Like a world. Anyone who has said who they are. */
  "like",
  /** Anything only administrators do (the default model, importing a world from a source). */
  "administer",
] as const;

export type Action = (typeof ACTIONS)[number];

/**
 * What the server decides without a route naming it: whether a person can see a record (`see`, the read rule of the
 * three scopes) and the use that follows from sight. Kept apart so that the closed list above is only what routes name.
 */
export const DECIDED_ONLY = ["see"] as const;
export type Decided = Action | (typeof DECIDED_ONLY)[number];

/** A route's policy; a route that is `public` says so with its own flag instead. */
export type RoutePolicy = "open" | "signedIn" | "admin" | { readonly action: Action };
