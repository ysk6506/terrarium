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
    title: "고장 영향 범위",
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
      "Recent time series of one metric of one entity, e.g. inletC, cpuC, powerW, cpuUtil (servers); ambientC (rooms); supplyC, loadKw (cooling units); loadW (pdu/panel); batteryPct (ups); cpuUsage (vms).",
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
      "Facility overview per room: room temperature, cooling units (running, supply air, load vs capacity), CDUs and chillers that carry liquid cooling (supply water temperature, load vs capacity), PDUs (load %), and the power panels, UPS and generators that feed the room wherever they stand.",
    inputSchema: obj({ roomId: str("Only this room") }),
  },
  {
    name: "redfish_request",
    title: "Redfish 요청",
    category: "protocol",
    mutating: true,
    description:
      'Send a Redfish request to the BMC of a server, or to the controller of a PDU, power panel or CDU, e.g. GET /redfish/v1/Chassis/System.Embedded.1/Thermal or POST .../Actions/ComputerSystem.Reset with {"ResetType":"On"}; a PDU or panel lists its circuits under /redfish/v1/PowerEquipment.',
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
    name: "snmp_request",
    title: "SNMP 요청",
    category: "protocol",
    mutating: true,
    description:
      "Send an SNMPv2c request to equipment with an SNMP agent: a UPS (UPS-MIB, RFC 1628: battery status and charge, minutes remaining, input and output, active alarms) or a switch (IF-MIB: one interface per port, ifOperStatus up/down). Operations: get, getnext, getbulk, walk (a whole subtree), set. OIDs are dotted numbers or names such as upsBatteryStatus.0, sysDescr.0 or the subtree names system and upsMIB. Community 'public' reads, 'private' also writes; any other string gets no answer. Errors follow RFC 3416: noSuchObject, noSuchInstance, endOfMibView and error-status.",
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
    description:
      "Send a BACnet/IP service request to building and plant equipment: cooling units (CRAH), chillers, CDUs, generators, power panels and UPSes. Services: who-is (discover devices; leave device out to ask everyone), read-property, read-property-multiple, write-property. Objects are analog-input (readings in °C, kW, %), binary-input (states), multi-state-input, analog-value and binary-output (commandable, written at a priority 1-16). Properties use the standard's names: present-value, object-name, units, status-flags, priority-array. Writing present-value of a cooling unit's Supply-Air-Setpoint, or the Unit-Enable of a cooling unit, chiller, CDU or generator (a generator's is its AUTO/OFF switch), changes the real equipment; relinquish takes a command back. Errors are BACnet error class and code.",
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
    description:
      "Log in to a switch's command line (SSH) and run commands, exactly as a person on the console would; each call is a fresh login and its commands run in order in one session. What it speaks depends on the OS the switch runs: Arista EOS, Cisco NX-OS or Cisco IOS XE (the prompt and `show version` tell). EOS and IOS XE start in user mode (type enable); NX-OS starts privileged. Supported: show version, show interfaces [status | <port> | description | trunk] (NX-OS spells it show interface), show vlan [brief], show mac address-table [vlan <id>], show ip interface brief, show ip route, show ip arp, show lldp neighbors, show running-config [interface <port>], show clock, ping <ip>, traceroute <ip>; then configure terminal, interface <port> | interface vlan <id>, shutdown, no shutdown, description <text>, hostname <name>, vlan <id> (name <text>), switchport mode access|trunk, switchport access vlan <id>, switchport trunk allowed vlan [add|remove] <list>, switchport trunk native vlan <id>, no switchport, ip address <ip>/<len>, ip route <net>/<len> <next-hop>, end, exit, write memory. A VLAN, port or route change takes effect at once and really moves traffic: a server whose port is in the wrong VLAN, or whose gateway or route is gone, stops answering ping and an alarm names it. In a cloud or GPU fabric (leaf-spine) the switches also run BGP: show ip bgp summary, then router bgp <AS>, neighbor <ip> shutdown (NX-OS: neighbor <ip>, then shutdown) and no neighbor <ip> shutdown; show spanning-tree on the legacy VLAN network. Not modelled: LACP, packet counters, routing protocols other than BGP. Commands may be abbreviated (sh int status) and piped (| include, | exclude, | begin, | section). Set `configure` to run the commands in configuration mode without typing enable and configure terminal yourself. Shutting a port with a cable takes the link down for the device on the other end too.",
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
    description:
      'Call Arista eAPI on a switch that runs EOS: a JSON-RPC 2.0 body {"jsonrpc":"2.0","method":"runCmds","params":{"version":1,"cmds":["show version"],"format":"json"},"id":"1"}. format is json (default) or text. Commands run in privileged mode; start config changes with "configure" ("interface Ethernet1","shutdown" follow). A command that cannot be read fails the whole call with an error code as eAPI does (1002 invalid command, 1003 unconverted command).',
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
    description:
      'Call Cisco NX-API on a switch that runs NX-OS: {"ins_api":{"version":"1.0","type":"cli_show","chunk":"0","sid":"1","input":"show version","output_format":"json"}}. type is cli_show (structured JSON), cli_show_ascii (text) or cli_conf (configuration; separate commands with " ;", e.g. "interface Ethernet1/1 ;shutdown"). Each command gets its own output with a code (200 success, 400 command error with clierror, 501 no structured output).',
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
          "Fault or mistake type, e.g. cooling_unit_failure, breaker_trip, fan_failure, sensor_drift, port_vlan_mismatch, port_shutdown, svi_shutdown, bgp_neighbor_shutdown, route_missing, outlet_off",
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
