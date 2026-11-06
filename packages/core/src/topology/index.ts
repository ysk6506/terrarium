/**
 * core.topology: the topology view of a world (REQ-078, ADR-0084). The layers of power, cooling and network,
 * folded so that what is the same is one tile and what differs stands alone, and the impact range of what is
 * broken. Read-only on the world: it draws and scores, it gives the agents nothing (ADR-0087).
 */

export { type Focus, type FoldOptions, fold } from "./fold";
export {
  type Impact,
  impactOf,
  NO_IMPACT,
  type ServiceImpact,
  type Severe,
  servicesOf,
} from "./impact";
export { chainOf, isSpace, type LayerShape, layerShape } from "./layers";
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
export {
  classLabel,
  groupName,
  impactCounts,
  impactServices,
  impactWhen,
  nounOf,
  num,
} from "./words";
