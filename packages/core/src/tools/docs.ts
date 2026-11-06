/**
 * How every tool is described to an agent (ADR-0087): one line of summary, when to use it and when not (and what
 * to use instead), one example input, whether it only reads or changes the world, and what it costs. The same
 * words go to the agent as the tool description, so a person reading the catalog sees what the agent sees.
 *
 * `realism` is the tag of ADR-0087: `common` (tools a real operations team has today: equipment APIs, alarms,
 * metrics, service status), `rare` (exists in a few places: topology), `ideal` (does not exist in practice:
 * impact analysis). An experiment that wants realistic results gives `common` tools only.
 */
import { DB_DOCS } from "./catalog-db";
import { OPS_DOCS } from "./catalog-ops";
import { SDN_DOCS } from "./catalog-sdn";

export type Realism = "common" | "rare" | "ideal";
export type Cost = "low" | "medium" | "high";

/** The cards of the tool picker (ADR-0087 item 1): what a person is looking at when they reach for a tool. */
export type ToolArea = "server" | "power" | "cooling" | "network" | "virtual" | "observe" | "act";

export const TOOL_AREAS: readonly ToolArea[] = [
  "server",
  "power",
  "cooling",
  "network",
  "virtual",
  "observe",
  "act",
];

export const TOOL_AREA_LABELS: Readonly<Record<ToolArea, string>> = {
  server: "서버",
  power: "전원",
  cooling: "냉방",
  network: "네트워크",
  virtual: "가상화",
  observe: "관측",
  act: "조치",
};

export interface ToolDoc {
  readonly area: ToolArea;
  readonly realism: Realism;
  readonly summary: string;
  readonly use: string;
  readonly notUse: string;
  readonly example: string;
  readonly cost: Cost;
  readonly costWhy: string;
  /** Extra text for tools with a command language of their own; appended after the standard lines. */
  readonly details?: string;
}

export const REALISM_LABELS: Readonly<Record<Realism, string>> = {
  common: "흔함",
  rare: "드묾",
  ideal: "없음",
};

/** The description the agent reads, in the standard order. */
export function standardDescription(doc: ToolDoc, writes: boolean): string {
  return [
    doc.summary,
    `Use when: ${doc.use}`,
    `Don't use when: ${doc.notUse}`,
    `Example: ${doc.example}`,
    `Access: ${writes ? "changes the world" : "read-only"}.`,
    `Cost: ${doc.cost} (${doc.costWhy}).`,
    ...(doc.details ? [doc.details] : []),
  ].join("\n");
}

const d = (doc: ToolDoc): ToolDoc => doc;

const BASE_DOCS: Readonly<Record<string, ToolDoc>> = {
  list_alarms: d({
    area: "observe",
    realism: "common",
    summary: "List the active alarms of the monitoring system, most severe first.",
    use: "you start a task, or want to see what changed after an action.",
    notUse:
      "you need numbers over time (use query_metrics) or one device's full state (use get_entity).",
    example: '{"severity":"critical"}',
    cost: "low",
    costWhy: "one short list; grows with the number of alarms",
    details:
      "Filters: severity, entityId, kind (service = a service stopped or slowed, os = a host's operating system).",
  }),
  list_entities: d({
    area: "observe",
    realism: "common",
    summary:
      "List inventory entities (sites, rooms, racks, servers, switches, storage, cooling, power, VMs, services).",
    use: "you need ids and names of equipment of one kind or inside one place.",
    notUse:
      "you already have the id (use get_entity), or you want services only (use list_services).",
    example: '{"kind":"server","under":"hall-1"}',
    cost: "medium",
    costWhy: "a big world returns many rows; filter by kind or place",
  }),
  get_entity: d({
    area: "observe",
    realism: "common",
    summary:
      "Details of one entity: kind, model, location, connections, current state and its alarms.",
    use: "you know an id and want what it is and how it is doing.",
    notUse:
      "you want a history (use query_metrics) or a host's operating system (use run_command).",
    example: '{"id":"srv-a1"}',
    cost: "low",
    costWhy: "one entity",
  }),
  get_topology: d({
    area: "observe",
    realism: "rare",
    summary: "The neighbourhood graph around an entity: nodes and dependency edges up to a depth.",
    use: "you want to see what is wired to what around a device.",
    notUse:
      "you want what breaks if it fails (the world does not hand that out as a tool; follow the links yourself).",
    example: '{"id":"tor-a","depth":2}',
    cost: "medium",
    costWhy: "output grows with depth",
  }),
  get_impact: d({
    area: "observe",
    realism: "ideal",
    summary:
      "What depends on an entity and what it depends on, following power, cooling, network and hosting links.",
    use: "you test how a tool that knows the whole dependency graph helps (this tool does not exist in real datacentres).",
    notUse:
      "you want the realistic setting; leave it out, and read alarms, status and links instead.",
    example: '{"id":"pdu-a"}',
    cost: "medium",
    costWhy: "walks the whole graph",
  }),
  query_metrics: d({
    area: "observe",
    realism: "common",
    summary: "Recent time series of one metric of one entity.",
    use: "you want to know whether a value is rising, falling or flat.",
    notUse: "you only need the value now (use get_entity).",
    example: '{"id":"srv-a1","metric":"inletC","lastSeconds":1800}',
    cost: "low",
    costWhy: "one series",
    details:
      "Metrics: inletC, cpuC, powerW, cpuUtil (servers); ambientC (rooms); supplyC, loadKw (cooling units); loadW (pdu, panel); batteryPct (ups); cpuUsage (vms).",
  }),
  facility_status: d({
    area: "observe",
    realism: "common",
    summary:
      "Facility overview per room: temperature, cooling units, CDUs, chillers, PDUs, panels, UPS and generators.",
    use: "something is hot or dark and you want the cooling and power picture of a room in one call.",
    notUse: "the problem is inside a server or a service (use service_status or run_command).",
    example: '{"roomId":"hall-1"}',
    cost: "medium",
    costWhy: "several devices per room",
  }),
  redfish_request: d({
    area: "server",
    realism: "common",
    summary:
      "Send a Redfish request to the BMC of a server, or to the controller of a PDU, power panel or CDU.",
    use: "you need hardware facts (thermal, power, fans, event log) or to power-cycle or update a server out of band.",
    notUse: "the server is up and the problem is in its operating system (use run_command).",
    example:
      '{"server":"srv-a1","method":"GET","path":"/redfish/v1/Chassis/System.Embedded.1/Thermal"}',
    cost: "low",
    costWhy: "one resource per call",
    details:
      'A POST such as .../Actions/ComputerSystem.Reset with {"ResetType":"On"} changes the world; a PDU or panel lists its circuits under /redfish/v1/PowerEquipment.',
  }),
  vcenter_request: d({
    area: "virtual",
    realism: "common",
    summary: "Call the vCenter REST API.",
    use: "you need VMs, hosts, clusters or datastores, or to start, stop or reset a VM.",
    notUse:
      "you want to move a VM to another host (use migrate_vm) or a service's status (use service_status).",
    example: '{"method":"GET","path":"/api/vcenter/vm"}',
    cost: "medium",
    costWhy: "lists can be long",
    details: "Also POST /api/vcenter/vm/{vm}/power?action=start|stop|reset, GET /api/vcenter/host.",
  }),
  vrops_request: d({
    area: "virtual",
    realism: "common",
    summary: "Call the vROps / Aria Operations suite-api for alerts and resource statistics.",
    use: "you want the virtualisation monitoring view: alerts and latest stats of VMs and hosts.",
    notUse: "you want to change anything (it is read-only), or raw alarms (use list_alarms).",
    example: '{"method":"GET","path":"/suite-api/api/alerts"}',
    cost: "medium",
    costWhy: "alert lists can be long",
  }),
  snmp_request: d({
    area: "power",
    realism: "common",
    summary: "Send an SNMPv2c request to a UPS (UPS-MIB) or a switch (IF-MIB).",
    use: "you need battery state of a UPS or port status of a switch, the way a network monitor reads them.",
    notUse: "you want a switch's configuration (use network_cli).",
    example: '{"device":"ups-1","operation":"walk","oids":["upsMIB"]}',
    cost: "low",
    costWhy: "one OID or one subtree",
    details:
      "Operations: get, getnext, getbulk, walk, set. OIDs are dotted numbers or names (upsBatteryStatus.0, sysDescr.0). Community 'public' reads, 'private' also writes. A set (for example ifAdminStatus) changes the world. Errors follow RFC 3416.",
  }),
  bacnet_request: d({
    area: "cooling",
    realism: "common",
    summary:
      "Send a BACnet/IP request to cooling units, chillers, CDUs, generators, panels and UPSes.",
    use: "you read plant values or change a setpoint or enable switch of building equipment.",
    notUse: "you want a server's temperature (use redfish_request or query_metrics).",
    example:
      '{"service":"read-property","device":"crah-1","objectType":"analog-input","instance":1,"property":"present-value"}',
    cost: "low",
    costWhy: "one property per call",
    details:
      "Services: who-is, read-property, read-property-multiple, write-property. Writing present-value of a Supply-Air-Setpoint or a Unit-Enable changes the real equipment; relinquish takes a command back.",
  }),
  network_cli: d({
    area: "network",
    realism: "common",
    summary: "Log in to a switch's command line and run commands as a person on the console would.",
    use: "you need VLANs, ports, routes, BGP or the MAC table of a switch, or to fix its configuration.",
    notUse: "you only need port up/down counts (use snmp_request).",
    example: '{"device":"tor-a","commands":["show vlan brief"]}',
    cost: "medium",
    costWhy: "each call is a fresh login; output follows the commands",
    details:
      "The OS is Arista EOS, Cisco NX-OS or IOS XE (show version tells). Supported: show version, show interfaces [status|<port>|description|trunk], show vlan [brief], show mac address-table, show ip interface brief, show ip route, show ip arp, show lldp neighbors, show running-config [interface <port>], show clock, ping, traceroute; configure terminal, interface, shutdown, no shutdown, vlan, switchport mode|access vlan|trunk allowed vlan|trunk native vlan, ip address, ip route, write memory. Fabrics also: show ip bgp summary, router bgp, neighbor <ip> shutdown. A configuration change takes effect at once and really moves traffic. Commands may be abbreviated and piped (| include, | exclude, | begin, | section). Set `configure` to run the lines in configuration mode.",
  }),
  eapi_request: d({
    area: "network",
    realism: "common",
    summary: "Call Arista eAPI (JSON-RPC runCmds) on a switch that runs EOS.",
    use: "you want structured JSON output of EOS commands.",
    notUse:
      "the switch runs NX-OS (use nxapi_request) or you want the plain console (use network_cli).",
    example:
      '{"device":"sp1","body":{"jsonrpc":"2.0","method":"runCmds","params":{"version":1,"cmds":["show version"],"format":"json"},"id":"1"}}',
    cost: "medium",
    costWhy: "JSON output is long",
    details:
      'Commands run in privileged mode; start config changes with "configure". An unreadable command fails the whole call (1002 invalid command, 1003 unconverted command).',
  }),
  nxapi_request: d({
    area: "network",
    realism: "common",
    summary: "Call Cisco NX-API on a switch that runs NX-OS.",
    use: "you want structured JSON output of NX-OS commands.",
    notUse:
      "the switch runs EOS (use eapi_request) or you want the plain console (use network_cli).",
    example:
      '{"device":"tor-a","body":{"ins_api":{"version":"1.0","type":"cli_show","chunk":"0","sid":"1","input":"show version","output_format":"json"}}}',
    cost: "medium",
    costWhy: "JSON output is long",
    details:
      'type is cli_show (JSON), cli_show_ascii (text) or cli_conf (configuration; separate commands with " ;"). Each command gets its own code (200, 400 with clierror, 501).',
  }),
  set_cooling_setpoint: d({
    area: "cooling",
    realism: "common",
    summary: "Change the supply air setpoint of a cooling unit within the model's range.",
    use: "a room runs warm and a unit has headroom to cool more.",
    notUse:
      "the unit is stopped (use restart_cooling_unit) or the heat comes from a failed unit (shed load instead).",
    example: '{"unitId":"crah-1","celsius":18}',
    cost: "low",
    costWhy: "one change",
  }),
  restart_cooling_unit: d({
    area: "cooling",
    realism: "common",
    summary: "Power-cycle a cooling unit.",
    use: "a unit hangs; a restart can bring a stuck controller back.",
    notUse: "the unit has a hardware fault (it will not start; call for service).",
    example: '{"unitId":"crah-1"}',
    cost: "low",
    costWhy: "one change; the unit is off for a moment",
  }),
  reset_breaker: d({
    area: "power",
    realism: "common",
    summary: "Reset a tripped breaker on a power panel or PDU.",
    use: "a breaker fell and the cause (overload) is gone or reduced.",
    notUse:
      "you do not yet know which breaker fell (use facility_status first) or the load is still over capacity (it trips again; shed load first).",
    example: '{"id":"pdu-a"}',
    cost: "low",
    costWhy: "one change",
  }),
  power_server: d({
    area: "server",
    realism: "common",
    summary: "Power a server on or off.",
    use: "you must shed load, or bring a server back.",
    notUse:
      "services run on it and they have not been moved (use failover_service or migrate_vm first).",
    example: '{"id":"srv-a1","action":"off"}',
    cost: "low",
    costWhy: "one change; every VM and service on it stops",
  }),
  wait: d({
    area: "act",
    realism: "common",
    summary: "Let simulated time pass, up to 3600 seconds.",
    use: "you changed something and want to see whether it helped, or a restart needs time.",
    notUse: "you are only unsure; look first (list_alarms, service_status).",
    example: '{"seconds":120}',
    cost: "low",
    costWhy: "no output, but the world keeps running (services keep losing money while you wait)",
  }),
  submit_diagnosis: d({
    area: "act",
    realism: "common",
    summary: "Submit your final diagnosis; this ends your task.",
    use: "you found the root cause and did what could be done.",
    notUse: "services are still down and a recovery action is open (recover first, report after).",
    example:
      '{"rootCause":"srv-a2","faultType":"disk_full","summary":"...","actions":["rm /var/log/..."]}',
    cost: "low",
    costWhy: "ends the run",
    details:
      "faultType is a fault or mistake type such as cooling_unit_failure, breaker_trip, fan_failure, sensor_drift, port_vlan_mismatch, port_shutdown, svi_shutdown, bgp_neighbor_shutdown, route_missing, outlet_off, disk_full, memory_leak, process_crashloop, fs_readonly, ntp_drift.",
  }),
  list_services: d({
    area: "observe",
    realism: "common",
    summary: "List the services (what the datacentre is for) with their status and where they run.",
    use: "you start a task about slowness or an outage, or want to know which services are affected.",
    notUse: "you need why a service is unhealthy (use service_status).",
    example: '{"status":"down"}',
    cost: "low",
    costWhy: "one row per service",
  }),
  service_status: d({
    area: "observe",
    realism: "common",
    summary:
      "One service in detail: status, why, each place it runs and the standby, its path and its cost so far.",
    use: "a service is down or slow and you want to know which place or switch is the cause, and whether the standby is healthy.",
    notUse: "you want the host's own numbers (use run_command on the host).",
    example: '{"service":"svc-license"}',
    cost: "low",
    costWhy: "one service",
  }),
  failover_service: d({
    area: "virtual",
    realism: "common",
    summary: "Move a service to its standby places; the old places become the standby.",
    use: "the places a service runs on are broken or cannot be fixed quickly and the standby is healthy.",
    notUse:
      "the standby is not healthy (check service_status), or the cause is the service's own certificate or data.",
    example: '{"service":"svc-license"}',
    cost: "low",
    costWhy: "one change; the service is unavailable for a moment while it moves",
  }),
  migrate_vm: d({
    area: "virtual",
    realism: "common",
    summary: "Move a VM to another server (live migration).",
    use: "its server is hot, failing or must be emptied, and another server has room.",
    notUse: "the VM itself is broken (moving it carries the problem along) or the target is off.",
    example: '{"vm":"vm-web","host":"srv-b1"}',
    cost: "low",
    costWhy: "one change",
  }),
  restart_service: d({
    area: "virtual",
    realism: "common",
    summary: "Restart a service's process on every place it runs.",
    use: "a process leaks memory, hangs or holds zombies, and a restart is acceptable.",
    notUse:
      "it crashes again at once (restarting does not fix the cause; fail over instead) or the disk is full.",
    example: '{"service":"svc-web"}',
    cost: "low",
    costWhy: "one change; the service is down for about 15 seconds",
  }),
  run_command: d({
    area: "server",
    realism: "common",
    summary:
      "Run one shell command line on a server or VM, as a person logged in over SSH, in a small fake Linux.",
    use: "you need the inside of a host: logs, processes, disk, memory, files, clock, name lookup; or to clean up, restart a unit, remount, reboot.",
    notUse: "you want a switch (use network_cli) or hardware sensors (use redfish_request).",
    example: '{"host":"srv-a2","cmd":"journalctl -u api -n 50 | grep -i error"}',
    cost: "medium",
    costWhy: "output can be long; pipe to grep, tail or awk",
    details:
      "The host has a fake file system (/proc, /var/log, /etc, /tmp, /var/lib), a process table, systemd units and a journal, all made from the host's state and the world time; nothing really runs. The shell reads pipes (a | b | c), && || ;, > >> < 2> 2>&1, quotes and globs; there are no variables ($X), no $(...), no loops. Commands: cat ls du df free top ps ss netstat ip ping curl dig nslookup date uptime hostname mount lsblk lsof stat tail head grep egrep awk sed sort uniq wc cut tr xargs find which echo env kill pkill nice chronyc timedatectl openssl x509 systemctl journalctl dmesg logrotate rm truncate touch cp mv tee reboot, and on a database host pg_isready, psql -c and multipath -ll. grep, awk and sed do what they say. An unknown command answers 'bash: xyz: command not found' (exit 127); a feature the fake lacks (tail -f, a variable) is refused, and the result lists it in `outside` so the run can say how often the fake was out of its depth. Writes (rm, truncate, kill, systemctl start|stop|restart|enable|disable, logrotate, mount -o remount,rw, reboot, > file, sed -i) change the world and are recorded as actions. The result has stdout, stderr, exitCode and output (stdout then stderr).",
  }),
  ask_human: d({
    area: "act",
    realism: "common",
    summary:
      "Ask the person in charge for help or a decision; the run waits until they answer (or the setup answers for them).",
    use: "you lack a tool or the permission to fix what you found, or an action is risky and needs a decision.",
    notUse:
      "you can look it up yourself (use list_alarms, service_status or get_entity) or the answer is a diagnosis (use submit_diagnosis).",
    example:
      '{"request":"The cooling unit has a hardware fault. Can someone replace the fan motor?"}',
    cost: "high",
    costWhy: "the run stops until a person answers; simulated time stands still meanwhile",
    details:
      "The answer can be a reply in words, a note that the person did the work themselves (with what they changed), or more tools for you. Say what you found, what you tried and what you need.",
  }),
  search_runbooks: d({
    area: "act",
    realism: "rare",
    summary: "Search the team's runbooks (procedures) for steps that fit the situation.",
    use: "you do not know the usual procedure for what you see and the team may have written one down.",
    notUse:
      "you already know what to do, or you need facts about the equipment (use get_entity or service_status).",
    example: '{"query":"disk full"}',
    cost: "low",
    costWhy: "one short list of steps",
    details:
      "Each step says what to do, what to check and which tools to use. Follow the steps in order unless the situation says otherwise.",
  }),
};

/** Every tool's words: the equipment, observation and answer tools above, and the hand-over and ticket tools (REQ-093). */
export const TOOL_DOCS: Readonly<Record<string, ToolDoc>> = {
  ...BASE_DOCS,
  ...OPS_DOCS,
  ...DB_DOCS,
  ...SDN_DOCS,
};
