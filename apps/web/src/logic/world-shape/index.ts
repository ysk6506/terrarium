/** The "서비스부터" screens' model: ladders and their cards, "알아서", what a shape comes to, and the workload (REQ-094). */
export {
  CHEAP_LAYERS,
  PRESET_LABELS,
  type PresetId,
  presetLayers,
  presetOf,
  type Resolved,
  resolveLayers,
  resolveServiceLayers,
  STEADY_LAYERS,
} from "./auto-pick";
export {
  CARDS,
  type Chip,
  type ChipCard,
  cardOf,
  chipsOfLayer,
  type Diagram,
  type DiagramRow,
  type Join,
  LAYER_INFO,
} from "./ladders";
export { costText, hostsText, type ShapeView, shapeView } from "./shape-view";
export { guessWorkload, type WorkloadView, workloadView } from "./workload-view";
