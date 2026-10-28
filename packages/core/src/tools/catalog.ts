/**
 * The tools Terrarium offers to agents (REQ-007, REQ-031). An experiment picks a subset. Titles are
 * for people (Korean); descriptions are for the agent (English, as LLM tool descriptions usually are).
 */

export type ToolCategory = "observe" | "protocol" | "act" | "answer";

export interface JsonSchema {
  readonly type: "object";
  readonly properties: Readonly<
    Record<
      string,
      { readonly type: string; readonly description: string; readonly enum?: readonly string[] }
    >
  >;
  readonly required: readonly string[];
}

export interface ToolSpec {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly category: ToolCategory;
  /** True when the tool changes the simulated world (the oracle may reward or penalise it). */
  readonly mutating: boolean;
  readonly inputSchema: JsonSchema;
}

const obj = (properties: JsonSchema["properties"], required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  required,
});
const str = (description: string, values?: readonly string[]) => ({
  type: "string",
  description,
  ...(values ? { enum: values } : {}),
});
const num = (description: string) => ({ type: "number", description });

export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: "list_alarms",
    title: "알람 목록",
    category: "observe",
    mutating: false,
    description:
      "List active alarms from the monitoring system, most severe first. Optionally filter by severity or entity.",
    inputSchema: obj({
      severity: str("Only this severity", ["warning", "critical"]),
      entityId: str("Only alarms on this entity"),
    }),
  },
  {
    name: "list_entities",
    title: "장비 목록",
    category: "observe",
    mutating: false,
    description:
      "List inventory entities (sites, rooms, racks, servers, switches, storage, cooling units, power panels, UPS, VMs). Filter by kind and/or by an ancestor id.",
    inputSchema: obj({
      kind: str("Entity kind, e.g. server, rack, cooling_unit, power_panel, pdu, ups, vm"),
      under: str("Only entities inside this entity (e.g. a room id)"),
    }),
  },
  {
    name: "get_entity",
    title: "장비 상세",
    category: "observe",
    mutating: false,
    description:
      "Details of one entity: kind, model, location path, connections (power feeds, network, cooling, hosting), current state and active alarms.",
    inputSchema: obj({ id: str("Entity id") }, ["id"]),
  },
  {
    name: "get_topology",
    title: "토폴로지",
    category: "observe",
    mutating: false,
    description:
      "Neighbourhood graph around an entity: nodes and dependency edges (consumer -> supplier) up to the given depth.",
    inputSchema: obj({ id: str("Entity id"), depth: num("How many hops (1-4, default 2)") }, [
      "id",
    ]),
  },
  {
    name: "get_impact",
    title: "장애 영향 범위",
    category: "observe",
    mutating: false,
    description:
      "What depends on an entity (would be affected if it fails) and what it depends on, following power, cooling, network and hosting links.",
    inputSchema: obj({ id: str("Entity id") }, ["id"]),
  },
  {
    name: "query_metrics",
    title: "시계열 메트릭",
    category: "observe",
    mutating: false,
    description:
      "Recent time series of one metric of one entity, e.g. inletC, cpuC, powerW, cpuUtil (servers); ambientC (rooms); supplyC, loadKw (cooling units); loadW (pdu/panel); batteryPct (ups).",
    inputSchema: obj(
      {
        id: str("Entity id"),
        metric: str("Metric name"),
        lastSeconds: num("Window length in seconds (default 1800)"),
      },
      ["id", "metric"],
    ),
  },
  {
    name: "facility_status",
    title: "설비 현황",
    category: "observe",
    mutating: false,
    description:
      "Facility overview per room: room temperature, cooling units (running, supply air, load vs capacity), PDUs (load %), and the power panels and UPS that feed the room wherever they stand.",
    inputSchema: obj({ roomId: str("Only this room") }),
  },
  {
    name: "redfish_request",
    title: "Redfish 요청",
    category: "protocol",
    mutating: true,
    description:
      'Send a Redfish request to the BMC of a server, e.g. GET /redfish/v1/Chassis/System.Embedded.1/Thermal or POST .../Actions/ComputerSystem.Reset with {"ResetType":"On"}.',
    inputSchema: obj(
      {
        server: str("Server entity id"),
        method: str("HTTP method", ["GET", "POST", "PATCH"]),
        path: str("Path starting with /redfish/v1"),
        body: { type: "object", description: "JSON body for POST/PATCH" },
      },
      ["server", "method", "path"],
    ),
  },
  {
    name: "vcenter_request",
    title: "vCenter 요청",
    category: "protocol",
    mutating: true,
    description:
      "Call the vCenter REST API, e.g. GET /api/vcenter/vm, GET /api/vcenter/host, POST /api/vcenter/vm/{vm}/power?action=start.",
    inputSchema: obj(
      {
        method: str("HTTP method", ["GET", "POST"]),
        path: str("Path starting with /api or /rest"),
        query: { type: "object", description: "Query parameters" },
      },
      ["method", "path"],
    ),
  },
  {
    name: "vrops_request",
    title: "vROps 요청",
    category: "protocol",
    mutating: false,
    description:
      "Call the vROps/Aria Operations suite-api, e.g. GET /suite-api/api/alerts or GET /suite-api/api/resources/{id}/stats/latest.",
    inputSchema: obj(
      {
        method: str("HTTP method", ["GET", "POST"]),
        path: str("Path starting with /suite-api"),
        query: { type: "object", description: "Query parameters" },
      },
      ["method", "path"],
    ),
  },
  {
    name: "set_cooling_setpoint",
    title: "냉방 설정 온도 변경",
    category: "act",
    mutating: true,
    description: "Change the supply air setpoint of a cooling unit (within the model's range).",
    inputSchema: obj({ unitId: str("Cooling unit id"), celsius: num("New setpoint in °C") }, [
      "unitId",
      "celsius",
    ]),
  },
  {
    name: "restart_cooling_unit",
    title: "냉방기 재시작",
    category: "act",
    mutating: true,
    description:
      "Power-cycle a cooling unit. Helps with controller hangs; does not repair hardware faults.",
    inputSchema: obj({ unitId: str("Cooling unit id") }, ["unitId"]),
  },
  {
    name: "reset_breaker",
    title: "차단기 리셋",
    category: "act",
    mutating: true,
    description:
      "Reset a tripped breaker on a power panel or PDU. It trips again if the overload persists.",
    inputSchema: obj({ id: str("Power panel or PDU id") }, ["id"]),
  },
  {
    name: "power_server",
    title: "서버 전원 제어",
    category: "act",
    mutating: true,
    description: "Power a server on or off.",
    inputSchema: obj({ id: str("Server id"), action: str("on or off", ["on", "off"]) }, [
      "id",
      "action",
    ]),
  },
  {
    name: "wait",
    title: "시간 대기",
    category: "act",
    mutating: false,
    description:
      "Let simulated time pass (e.g. to observe whether a change helps). Max 3600 seconds.",
    inputSchema: obj({ seconds: num("Seconds to wait (1-3600)") }, ["seconds"]),
  },
  {
    name: "submit_diagnosis",
    title: "진단 제출",
    category: "answer",
    mutating: false,
    description:
      "Submit your final diagnosis: the root-cause entity id, the fault type, a short summary and the actions you took. This ends your task.",
    inputSchema: obj(
      {
        rootCause: str("Entity id of the root cause"),
        faultType: str(
          "Fault type, e.g. cooling_unit_failure, breaker_trip, fan_failure, sensor_drift",
        ),
        summary: str("What happened and why, in a few sentences"),
        actions: { type: "array", description: "Actions you took or recommend" },
        confidence: num("0..1"),
      },
      ["rootCause", "faultType", "summary"],
    ),
  },
] as const; // prettier-ignore

export const TOOL_NAMES: readonly string[] = TOOL_SPECS.map((t) => t.name);

export function toolSpec(name: string): ToolSpec | undefined {
  return TOOL_SPECS.find((t) => t.name === name);
}

/** The default selection: everything an operator would have, minus raw protocol access. */
export const DEFAULT_TOOLSET: readonly string[] = TOOL_SPECS.filter(
  (t) => t.category !== "protocol",
).map((t) => t.name);
