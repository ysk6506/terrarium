/**
 * The tools Terrarium offers to agents (REQ-007, REQ-031). An experiment picks a subset. Titles are
 * for people (Korean); descriptions are for the agent (English, as LLM tool descriptions usually are).
 */

import { type Realism, standardDescription, TOOL_DOCS, type ToolArea } from "./docs";

export type ToolCategory = "observe" | "protocol" | "act" | "answer";

export interface JsonSchema {
  readonly type: "object";
  readonly properties: Readonly<
    Record<
      string,
      {
        readonly type: string;
        readonly description: string;
        readonly enum?: readonly string[];
        /** What the elements of an array are (JSON Schema requires it; providers reject an array without). */
        readonly items?: { readonly type: string };
      }
    >
  >;
  readonly required: readonly string[];
}

export interface ToolSpec {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly category: ToolCategory;
  /** How common a tool like this is in a real operations team (ADR-0087). */
  readonly realism?: Realism;
  /** The card of the tool picker it sits in (ADR-0087 item 1). */
  readonly area?: ToolArea;
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
const list = (description: string, items = "string") => ({
  type: "array",
  description,
  items: { type: items },
});

type RawSpec = Omit<ToolSpec, "realism" | "area" | "description">;

const RAW_SPECS: readonly RawSpec[] = [
  {
    name: "list_alarms",
    title: "알람 목록",
    category: "observe",
    mutating: false,
    inputSchema: obj({
      severity: str("Only this severity", ["warning", "critical"]),
      entityId: str("Only alarms on this entity"),
      kind: str(
        "Only alarms of this kind: service (a service stopped or slowed) or os (a host's operating system)",
        ["service", "os"],
      ),
    }),
  },
  {
    name: "list_entities",
    title: "장비 목록",
    category: "observe",
    mutating: false,
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
    inputSchema: obj({ id: str("Entity id") }, ["id"]),
  },
  {
    name: "get_topology",
    title: "토폴로지",
    category: "observe",
    mutating: false,
    inputSchema: obj({ id: str("Entity id"), depth: num("How many hops (1-4, default 2)") }, [
      "id",
    ]),
  },
  {
    name: "get_impact",
    title: "고장 영향 범위",
    category: "observe",
    mutating: false,
    inputSchema: obj({ id: str("Entity id") }, ["id"]),
  },
  {
    name: "query_metrics",
    title: "시계열 메트릭",
    category: "observe",
    mutating: false,
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
    inputSchema: obj({ roomId: str("Only this room") }),
  },
  {
    name: "redfish_request",
    title: "Redfish 요청",
    category: "protocol",
    mutating: true,
    inputSchema: obj(
      {
        server: str("Server, PDU, power panel or CDU entity id"),
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
    name: "snmp_request",
    title: "SNMP 요청",
    category: "protocol",
    mutating: true,
    inputSchema: obj(
      {
        device: str("Entity id of the UPS or switch"),
        operation: str("SNMP operation", ["get", "getnext", "getbulk", "walk", "set"]),
        oids: list("OIDs or names. For walk: the subtree root (default: everything)"),
        community: str("Community string (default public)"),
        nonRepeaters: num("getbulk: how many leading OIDs are fetched once (default 0)"),
        maxRepetitions: num("getbulk: how many rows to fetch for the other OIDs (default 10)"),
        values: list(
          "set: the assignments, [{oid, type: INTEGER | OCTET STRING | OBJECT IDENTIFIER | Gauge32, value}]",
          "object",
        ),
      },
      ["device", "operation"],
    ),
  },
  {
    name: "bacnet_request",
    title: "BACnet 요청",
    category: "protocol",
    mutating: true,
    inputSchema: obj(
      {
        service: str("BACnet service", [
          "who-is",
          "read-property",
          "read-property-multiple",
          "write-property",
        ]),
        device: str("Entity id of the device; leave out for a who-is broadcast"),
        objectType: str(
          "analog-input, analog-value, binary-input, binary-output, multi-state-input or device",
        ),
        instance: num("Object instance number (for a device, its device instance)"),
        property: str("Property name such as present-value, or its number"),
        arrayIndex: num("For array properties: 0 is the length, 1.. the elements"),
        requests: list(
          "read-property-multiple: [{objectType, instance, properties: [name, ...]}]; properties may be all",
          "object",
        ),
        value: num("write-property: the value (binary: 1 active, 0 inactive)"),
        relinquish: {
          type: "boolean",
          description: "write-property: take back the command at this priority",
        },
        priority: num("write-property: 1 (highest) to 16 (lowest, default)"),
        low: num("who-is: lowest device instance that should answer"),
        high: num("who-is: highest device instance that should answer"),
      },
      ["service"],
    ),
  },
  {
    name: "network_cli",
    title: "스위치 CLI",
    category: "protocol",
    mutating: true,
    inputSchema: obj(
      {
        device: str("Entity id of the switch"),
        commands: list("CLI lines to run, in order"),
        configure: {
          type: "boolean",
          description: "Wrap the commands in enable / configure terminal ... end",
        },
      },
      ["device", "commands"],
    ),
  },
  {
    name: "eapi_request",
    title: "Arista eAPI 요청",
    category: "protocol",
    mutating: true,
    inputSchema: obj(
      {
        device: str("Entity id of the switch (EOS)"),
        body: { type: "object", description: "The JSON-RPC request body" },
      },
      ["device", "body"],
    ),
  },
  {
    name: "nxapi_request",
    title: "Cisco NX-API 요청",
    category: "protocol",
    mutating: true,
    inputSchema: obj(
      {
        device: str("Entity id of the switch (NX-OS)"),
        body: { type: "object", description: "The ins_api request body" },
      },
      ["device", "body"],
    ),
  },
  {
    name: "set_cooling_setpoint",
    title: "냉방 설정 온도 변경",
    category: "act",
    mutating: true,
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
    inputSchema: obj({ unitId: str("Cooling unit id") }, ["unitId"]),
  },
  {
    name: "reset_breaker",
    title: "차단기 리셋",
    category: "act",
    mutating: true,
    inputSchema: obj({ id: str("Power panel or PDU id") }, ["id"]),
  },
  {
    name: "power_server",
    title: "서버 전원 제어",
    category: "act",
    mutating: true,
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
    inputSchema: obj({ seconds: num("Seconds to wait (1-3600)") }, ["seconds"]),
  },
  {
    name: "submit_diagnosis",
    title: "진단 제출",
    category: "answer",
    mutating: false,
    inputSchema: obj(
      {
        rootCause: str("Entity id of the root cause"),
        faultType: str(
          "Fault or mistake type, e.g. cooling_unit_failure, breaker_trip, fan_failure, sensor_drift, port_vlan_mismatch, port_shutdown, svi_shutdown, bgp_neighbor_shutdown, route_missing, outlet_off",
        ),
        summary: str("What happened and why, in a few sentences"),
        actions: { type: "array", description: "Actions you took or recommend" },
        confidence: num("0..1"),
      },
      ["rootCause", "faultType", "summary"],
    ),
  },
  {
    name: "list_services",
    title: "서비스 목록",
    category: "observe",
    mutating: false,
    inputSchema: obj({
      status: str("Only services in this status", ["healthy", "degraded", "down"]),
      kind: str("Only this kind", ["request", "batch", "stateful"]),
    }),
  },
  {
    name: "service_status",
    title: "서비스 상태",
    category: "observe",
    mutating: false,
    inputSchema: obj({ service: str("Service id") }, ["service"]),
  },
  {
    name: "failover_service",
    title: "서비스 대기 쪽으로 옮기기",
    category: "act",
    mutating: true,
    inputSchema: obj({ service: str("Service id") }, ["service"]),
  },
  {
    name: "migrate_vm",
    title: "VM 다른 서버로 옮기기",
    category: "act",
    mutating: true,
    inputSchema: obj({ vm: str("VM id"), host: str("Server id to move it to") }, ["vm", "host"]),
  },
  {
    name: "restart_service",
    title: "서비스 다시 시작",
    category: "act",
    mutating: true,
    inputSchema: obj({ service: str("Service id") }, ["service"]),
  },
  {
    name: "run_command",
    title: "호스트에서 명령 실행",
    category: "protocol",
    mutating: true,
    inputSchema: obj(
      {
        host: str("Server or VM id"),
        cmd: str("The command line, e.g. df -h or systemctl status licd"),
      },
      ["host", "cmd"],
    ),
  },
  {
    name: "ask_human",
    title: "사람에게 묻기",
    category: "observe",
    mutating: false,
    inputSchema: obj(
      {
        request: str("What you found, what you tried and what you need from the person"),
      },
      ["request"],
    ),
  },
  {
    name: "search_runbooks",
    title: "절차서 찾기",
    category: "observe",
    mutating: false,
    inputSchema: obj({ query: str("Words about the situation, e.g. disk full") }),
  },
] as const; // prettier-ignore

/** The tools with the description in the standard order and the realism tag (ADR-0087). */
export const TOOL_SPECS: readonly ToolSpec[] = RAW_SPECS.map((raw) => {
  const doc = TOOL_DOCS[raw.name];
  if (!doc) throw new Error(`tool '${raw.name}' has no entry in TOOL_DOCS`);
  return {
    ...raw,
    realism: doc.realism,
    area: doc.area,
    description: standardDescription(doc, raw.mutating),
  };
});

export const TOOL_NAMES: readonly string[] = TOOL_SPECS.map((t) => t.name);

export function toolSpec(name: string): ToolSpec | undefined {
  return TOOL_SPECS.find((t) => t.name === name);
}

/**
 * Tools an experiment gets only when its designer turns them on, even though real teams have them: the person
 * on the other end of `ask_human` has to be arranged (ADR-0087 item 4), and runbooks are an experiment variable
 * (item 6).
 */
export const OPT_IN_TOOLS: readonly string[] = ["ask_human", "search_runbooks"];

/**
 * The protocol tools the default selection keeps: the shell. The faults of a host's operating system are solved on
 * the host (df, rm, systemctl), so a set without it cannot solve them (ADR-0091, REQ-088). The Redfish, vCenter, SNMP
 * and switch requests stay out of the default.
 */
const DEFAULT_PROTOCOL: readonly string[] = ["run_command"];

/**
 * The default selection (ADR-0087 item 2): the tools a real operations team has today (realism `common`), minus raw
 * protocol access except the shell, minus the tools a designer opts into. Topology and impact tools (`rare`, `ideal`)
 * stay out: giving them would measure our tools and not the agent.
 */
export const DEFAULT_TOOLSET: readonly string[] = TOOL_SPECS.filter(
  (t) =>
    t.realism === "common" &&
    !OPT_IN_TOOLS.includes(t.name) &&
    (t.category !== "protocol" || DEFAULT_PROTOCOL.includes(t.name)),
).map((t) => t.name);

/** The tools of one card of the picker, in catalog order. */
export const toolsOfArea = (area: ToolArea): ToolSpec[] =>
  TOOL_SPECS.filter((t) => t.area === area);
