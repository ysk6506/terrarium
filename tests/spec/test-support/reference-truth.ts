/** What the reference solver knows about the fault a sheet injects (REQ-110, ADR-0133): test support only. */
import type { ReferenceKey } from "@terrarium/core/oracle";
import type { ScenarioDoc } from "@terrarium/core/scenario";

/** What the sheet knows about its own fault. */
export interface Truth {
  readonly key: ReferenceKey;
  /** The entity the fault is injected on, or the device of the mistake. */
  readonly target: string;
  /** Every block that breaks something (a scenario that shuts two interfaces has two). */
  readonly nodes: ReadonlyArray<{ target: string; params: Readonly<Record<string, string>> }>;
  readonly peer: string;
  /** The service the sheet is about. */
  readonly service: string;
  /** The entity of the sheet's first required action. */
  readonly required: string;
  readonly answerRoot: string;
  readonly answerType: string;
  /** The servers a firmware sheet covers: the servers its final-state conditions name. */
  readonly servers: readonly string[];
  /** The servers the sheet wants kept powered; every other server may be shed. */
  readonly critical: readonly string[];
}

type Node = ScenarioDoc["nodes"][number];
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const FAULT_BLOCKS = new Set(["inject_fault"]);
const MISTAKE_BLOCKS = new Set([
  "port_vlan",
  "port_admin",
  "svi_admin",
  "route_del",
  "bgp_admin",
  "outlet_set",
  "policy_set",
]);

function serviceOf(doc: ScenarioDoc): string {
  let service = "";
  const walk = (c: unknown): void => {
    const n = c as { kind?: string; entity?: string; field?: string; of?: unknown[] };
    if (n.kind === "state" && n.field === "status" && n.entity) service ||= n.entity;
    for (const inner of n.of ?? []) walk(inner);
  };
  for (const e of doc.expectations) if (e.kind === "final_state") walk(e.condition);
  return service;
}

/** The entities a final-state condition wants powered. */
function poweredIn(doc: ScenarioDoc): string[] {
  const out: string[] = [];
  const walk = (c: unknown): void => {
    const n = c as { kind?: string; entity?: string; field?: string; of?: unknown[] };
    if (n.kind === "state" && (n.field === "powered" || n.field === "adminOn") && n.entity)
      out.push(n.entity);
    for (const inner of n.of ?? []) walk(inner);
  };
  for (const e of doc.expectations) if (e.kind === "final_state") walk(e.condition);
  return out;
}

/** The servers of the world that the sheet's final-state conditions name. */
export function namedServers(doc: ScenarioDoc, servers: readonly string[]): string[] {
  const ids = new Set<string>();
  const walk = (c: unknown): void => {
    const n = c as { kind?: string; entity?: string; of?: unknown[] };
    if (n.kind === "state" && n.entity) ids.add(n.entity);
    for (const inner of n.of ?? []) walk(inner);
  };
  for (const e of doc.expectations) if (e.kind === "final_state") walk(e.condition);
  return servers.filter((s) => ids.has(s));
}

/** The truth of a sheet, read from its blocks and its scoring sheet. */
export function truthOf(doc: ScenarioDoc): Truth {
  const d = doc.expectations.find((e) => e.kind === "diagnosis") as unknown as {
    rootCause: string[];
    faultType: string[];
  };
  const key = d.faultType[0] as ReferenceKey;
  const nodes: readonly Node[] = doc.nodes;
  const mine = nodes.filter(
    (n) =>
      (FAULT_BLOCKS.has(n.type) && n.params.faultType === key) ||
      (MISTAKE_BLOCKS.has(n.type) && !FAULT_BLOCKS.has(n.type)),
  );
  const nodesOf = mine.map((n) => ({
    target: str(n.params.target),
    params: Object.fromEntries(Object.entries(n.params).map(([k, v]) => [k, String(v)])),
  }));
  const required = doc.expectations.find((e) => e.kind === "required_action") as
    | { target?: string }
    | undefined;
  return {
    key,
    target: nodesOf[0]?.target ?? d.rootCause[0] ?? "",
    nodes: nodesOf,
    peer: str(mine[0]?.params.peer),
    service: serviceOf(doc),
    required: required?.target ?? "",
    answerRoot: d.rootCause[0] as string,
    answerType: key,
    critical: poweredIn(doc),
    servers: [],
  };
}
