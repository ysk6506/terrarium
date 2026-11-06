/**
 * core.topology: the topology view of a world (REQ-078, ADR-0084). The layers of power, cooling and network,
 * folded so that what is the same is one tile and what differs stands alone, and the impact range of what is
 * broken. Read-only on the world: it draws and scores, it gives the agents nothing (ADR-0087).
 */

export { type Focus, type FoldOptions, fold } from "./fold";
export { type Impact, impactOf, NO_IMPACT, type Severe } from "./impact";
export { chainOf, isSpace, type LayerShape, layerShape } from "./layers";
export {
  countAt,
  type ReplayState,
  replaySource,
  restingSource,
  stateAt,
} from "./replay";
export { callLabel, callWhen, clockText, EFFECT_WORDS } from "./replay-words";
export {
  MARK_KINDS,
  MARK_LABELS,
  type Mark,
  type MarkKind,
  markers,
  type ServersMoved,
  type Story,
  type StoryOptions,
  type StoryPart,
  spanOf,
  storyLine,
} from "./story";
export {
  type Board,
  type Crumb,
  type Earlier,
  type Edge,
  LAYER_IDS,
  LAYER_LABELS,
  type LayerId,
  MAX_TILES,
  type Stage,
  type Tile,
  type TileClass,
  type TopoKind,
  type TopologySource,
  type TopoState,
} from "./types";
export { classLabel, groupName, impactCounts, impactWhen, nounOf, num } from "./words";
