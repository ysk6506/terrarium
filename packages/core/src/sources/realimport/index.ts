/** core.sources.realimport: read-only import of reality — graph records into a world (REQ-010, REQ-011, ADR-0009). */
export { type Classification, type Classified, classify, type Relation } from "./classify";
export { assertReadOnly, type CypherQuery, READ_QUERIES } from "./cypher";
export {
  DEFAULT_MAX_ENTITIES,
  type ImportOptions,
  type ImportReport,
  type ImportResult,
  importReality,
} from "./importer";
export {
  CLOUD_TOPOLOGY_MAPPING,
  type KgMapping,
  mappedLabels,
  mappedRelations,
  type NodeRole,
  type NodeRule,
  type PropertyKeys,
  type RelationMeaning,
  type RelationRule,
} from "./mapping";
export {
  MemorySource,
  type Page,
  type RealitySource,
  readAll,
  type SourceNode,
  type SourceRelationship,
  type SourceSummary,
} from "./port";
export { type GraphDump, sampleGraph } from "./sample-graph";
