/**
 * BGP and VXLAN views of the leaves and spines of a cloud fabric (REQ-065, ADR-0062), printed the way each OS
 * prints them: the session summary (IPv4 and EVPN), the VNI table and the `router bgp` part of the running
 * configuration. A session is up when its cable is up and neither end has been shut (see net-bgp.ts); message
 * counters and session times are made up from the names, the EVPN route counts are estimates from the number of
 * servers behind each leaf. Nothing converges over time and no BGP attribute is modelled.
 */
import { hashHex } from "@terrarium/core/kernel";
import type { BgpNeighbor, BgpPlan, NetModel } from "@terrarium/core/world";
import { SIM_EPOCH_MS } from "./http";
import { nxRows } from "./netos-iface";
import type { Result, SwitchView } from "./netos-model";

type State = "established" | "shutdown" | "down";
export type Family = "ipv4" | "evpn";

/** One neighbor of the summary with everything its line shows. */
interface Row {
  readonly n: BgpNeighbor;
  readonly state: State;
  /** Routes received over the session (0 unless it is up). */
  readonly routes: number;
  readonly rcvd: number;
  readonly sent: number;
  /** How long the session has been in this state, in seconds. */
  readonly secs: number;
}

const pad = (text: string | number, width: number): string => String(text).padEnd(width);
const padL = (text: string | number, width: number): string => String(text).padStart(width);
const num = (seed: string, mod: number): number => parseInt(hashHex(seed).slice(0, 6), 16) % mod;

const NOT_RUNNING: Readonly<Record<SwitchView["os"], string>> = {
  eos: "BGP inactive",
  nxos: "BGP is not enabled",
  iosxe: "% BGP not active",
};

/** Whether a switch is in a fabric that stretches VLANs with VXLAN and EVPN: a GPU back-end is plain routed. */
const overlayOn = (model: NetModel, sw: string): boolean => {
  const d = model.plan.switches.get(sw)?.domain;
  return d !== undefined && model.plan.domains[d]?.fabric === "cloud";
};

/** The servers behind a leaf. */
const hostsBehind = (model: NetModel, leaf: string): number =>
  [...model.plan.hosts.values()].filter((h) => h.leaf === leaf).length;

/** EVPN routes learned from a neighbor: one MAC/IP route per server and one per-VLAN route per leaf behind it. */
function evpnRoutes(model: NetModel, sw: string, n: BgpNeighbor): number {
  const mine = model.plan.switches.get(sw);
  if (mine?.tier !== "leaf") return hostsBehind(model, n.peer) + 1;
  const others = [...model.plan.switches.values()].filter(
    (s) => s.tier === "leaf" && s.domain === mine.domain && s.id !== sw,
  );
  return others.reduce((sum, s) => sum + hostsBehind(model, s.id) + 1, 0);
}

function rowsOf(v: SwitchView, model: NetModel, bgp: BgpPlan, family: Family): Row[] {
  const sw = v.entity.id;
  if (family === "evpn" && !overlayOn(model, sw)) return [];
  return bgp.neighbors.map((n) => {
    const state = model.sessionState(sw, n.ip) ?? "down";
    const learned =
      family === "evpn"
        ? evpnRoutes(model, sw, n)
        : model.cfg(sw).routes.filter((r) => r.proto === "bgp" && r.via === n.ip).length;
    const rcvd = 1000 + num(`rx:${sw}:${n.ip}`, 9000);
    return {
      n,
      state,
      routes: state === "established" ? learned : 0,
      rcvd,
      sent: rcvd - 4 - num(`tx:${sw}:${n.ip}`, 6),
      secs: num(`up:${sw}:${n.ip}`, state === "established" ? 86_400 * 3 : 3600),
    };
  });
}

/** How long a session has been up, as the devices print it: `01:03:27`, or `2d03h` after a day. */
const clock = (secs: number): string =>
  secs >= 86_400
    ? `${Math.floor(secs / 86_400)}d${String(Math.floor((secs % 86_400) / 3600)).padStart(2, "0")}h`
    : [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60]
        .map((x) => String(x).padStart(2, "0"))
        .join(":");

/** NX-OS writes a duration as `P0DT1H2M3S`. */
const isoDuration = (secs: number): string =>
  `P${Math.floor(secs / 86_400)}DT${Math.floor((secs % 86_400) / 3600)}H${Math.floor((secs % 3600) / 60)}M${secs % 60}S`;

/** The state column: how many routes were received, or why the session is not up. */
function stateText(os: SwitchView["os"], r: Row): string {
  if (r.state === "established") return os === "eos" ? "Estab" : String(r.routes);
  if (r.state === "shutdown") return os === "eos" ? "Idle" : "Idle (Admin)";
  return "Active";
}

const STATE_NAME: Readonly<Record<State, string>> = {
  established: "Established",
  shutdown: "Idle",
  down: "Active",
};

const tableVersion = (sw: string): number => num(`tv:${sw}`, 90) + 10;

// ── show ip bgp summary ──────────────────────────────────────────────────────────────────────────

function eosPeer(r: Row): Record<string, unknown> {
  return {
    msgSent: r.sent,
    inMsgQueue: 0,
    prefixReceived: r.routes,
    upDownTime: SIM_EPOCH_MS / 1000 - r.secs,
    version: 4,
    msgReceived: r.rcvd,
    prefixAccepted: r.routes,
    peerState: STATE_NAME[r.state],
    outMsgQueue: 0,
    underMaintenance: false,
    asn: String(r.n.remoteAs),
  };
}

function eosSummary(bgp: BgpPlan, rows: readonly Row[]): Result {
  const line = (r: Row): string => {
    const counts = r.state === "established" ? ` ${padL(r.routes, 6)} ${padL(r.routes, 6)}` : "";
    return `  ${pad(r.n.ip, 16)} 4 ${pad(r.n.remoteAs, 11)} ${padL(r.rcvd, 9)} ${padL(r.sent, 9)}    0    0 ${pad(clock(r.secs), 8)} ${pad(stateText("eos", r), 7)}${counts}`.trimEnd();
  };
  return {
    text: [
      "BGP summary information for VRF default",
      `Router identifier ${bgp.routerId}, local AS number ${bgp.asn}`,
      "Neighbor Status Codes: m - Under maintenance",
      "  Neighbor         V AS           MsgRcvd   MsgSent  InQ OutQ  Up/Down State   PfxRcd PfxAcc",
      ...rows.map(line),
    ].join("\n"),
    data: {
      vrfs: {
        default: {
          vrf: "default",
          routerId: bgp.routerId,
          asn: String(bgp.asn),
          peers: Object.fromEntries(rows.map((r) => [r.n.ip, eosPeer(r)])),
        },
      },
    },
  };
}

function nxosNeighbor(r: Row, version: number): Record<string, string> {
  return {
    neighborid: r.n.ip,
    neighborversion: "4",
    msgrecvd: String(r.rcvd),
    msgsent: String(r.sent),
    neighbortableversion: String(version),
    inq: "0",
    outq: "0",
    neighboras: String(r.n.remoteAs),
    time: isoDuration(r.secs),
    state: STATE_NAME[r.state],
    prefixreceived: String(r.routes),
  };
}

function nxosSummary(v: SwitchView, bgp: BgpPlan, rows: readonly Row[], family: Family): Result {
  const total = rows.reduce((sum, r) => sum + r.routes, 0) + 1;
  const version = tableVersion(v.entity.id);
  const capable = rows.filter((r) => r.state === "established").length;
  const af = family === "evpn" ? "L2VPN EVPN" : "IPv4 Unicast";
  const line = (r: Row): string =>
    `${pad(r.n.ip, 15)} 4 ${padL(r.n.remoteAs, 10)} ${padL(r.rcvd, 7)} ${padL(r.sent, 7)} ${padL(version, 8)}    0    0 ${pad(clock(r.secs), 8)} ${stateText("nxos", r)}`;
  return {
    text: [
      `BGP summary information for VRF default, address family ${af}`,
      `BGP router identifier ${bgp.routerId}, local AS number ${bgp.asn}`,
      `BGP table version is ${version}, ${af} config peers ${rows.length}, capable peers ${capable}`,
      `${total} network entries and ${total} paths using ${total * 280} bytes of memory`,
      "BGP attribute entries [2/320], BGP AS path entries [1/12]",
      "BGP community entries [0/0], BGP clusterlist entries [0/0]",
      "",
      "Neighbor        V    AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd",
      ...rows.map(line),
    ].join("\n"),
    data: {
      TABLE_vrf: {
        ROW_vrf: {
          "vrf-name-out": "default",
          "vrf-router-id": bgp.routerId,
          "vrf-local-as": String(bgp.asn),
          TABLE_af: {
            ROW_af: {
              "af-id": family === "evpn" ? "25" : "1",
              "af-name": af,
              tableversion: String(version),
              configuredpeers: String(rows.length),
              capablepeers: String(capable),
              totalnetworks: String(total),
              totalpaths: String(total),
              TABLE_neighbor: {
                ROW_neighbor: nxRows(rows.map((r) => nxosNeighbor(r, version))),
              },
            },
          },
        },
      },
    },
  };
}

function iosSummary(v: SwitchView, bgp: BgpPlan, rows: readonly Row[]): Result {
  const total = rows.reduce((sum, r) => sum + r.routes, 0) + 1;
  const version = tableVersion(v.entity.id);
  const line = (r: Row): string =>
    `${pad(r.n.ip, 15)} 4 ${padL(r.n.remoteAs, 12)} ${padL(r.rcvd, 7)} ${padL(r.sent, 7)} ${padL(version, 8)}    0    0 ${pad(clock(r.secs), 8)} ${stateText("iosxe", r)}`;
  return {
    text: [
      `BGP router identifier ${bgp.routerId}, local AS number ${bgp.asn}`,
      `BGP table version is ${version}, main routing table version ${version}`,
      `${total} network entries using ${total * 248} bytes of memory`,
      `${total} path entries using ${total * 80}/${total * 40} bytes of memory`,
      "",
      "Neighbor        V           AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd",
      ...rows.map(line),
    ].join("\n"),
  };
}

/** `show ip bgp summary` (IPv4) or the EVPN summary of the leaf or spine. */
export function showBgpSummary(v: SwitchView, model: NetModel, family: Family = "ipv4"): Result {
  const bgp = model.bgp(v.entity.id);
  if (!bgp) return { text: NOT_RUNNING[v.os] };
  const rows = rowsOf(v, model, bgp, family);
  if (v.os === "eos") return eosSummary(bgp, rows);
  return v.os === "nxos" ? nxosSummary(v, bgp, rows, family) : iosSummary(v, bgp, rows);
}

// ── VXLAN ────────────────────────────────────────────────────────────────────────────────────────

const VNI_BASE = 10_000;

interface Vni {
  readonly vlan: number;
  readonly vni: number;
}

/** The VLAN-to-VNI mappings of a leaf: every VLAN with an anycast gateway is stretched as VNI 10000 + VLAN. */
function vnis(model: NetModel, sw: string): Vni[] {
  if (!overlayOn(model, sw)) return [];
  return [...model.cfg(sw).svis]
    .filter(([, svi]) => svi.anycast === true)
    .map(([vlan]) => ({ vlan, vni: VNI_BASE + vlan }))
    .sort((a, b) => a.vlan - b.vlan);
}

export function showVni(v: SwitchView, model: NetModel): Result {
  const list = vnis(model, v.entity.id);
  if (list.length === 0)
    return { text: v.os === "eos" ? "VXLAN is not configured" : "% VXLAN (NVE) is not configured" };
  if (v.os === "eos")
    return {
      text: [
        "VNI to VLAN Mapping for Vxlan1",
        "VNI         VLAN       Source       Interface       802.1Q Tag",
        "----------- ---------- ------------ --------------- ----------",
        ...list.map(
          (e) =>
            `${pad(e.vni, 11)} ${pad(e.vlan, 10)} ${pad("static", 12)} ${pad("Vxlan1", 15)} ${e.vlan}`,
        ),
      ].join("\n"),
    };
  return {
    text: [
      "Codes: CP - Control Plane        DP - Data Plane",
      "       UC - Unconfigured         SA - Suppress ARP",
      "       SU - Suppress Unknown Unicast",
      "",
      "Interface VNI      Multicast-group   State Mode Type [BD/VRF]      Flags",
      "--------- -------- ----------------- ----- ---- ------------------ -----",
      ...list.map(
        (e) =>
          `${pad("nve1", 9)} ${pad(e.vni, 8)} ${pad("UnicastBGP", 17)} ${pad("Up", 5)} ${pad("CP", 4)} ${pad(`L2 [${e.vlan}]`, 18)} SA`,
      ),
    ].join("\n"),
  };
}

// ── running configuration ────────────────────────────────────────────────────────────────────────

function eosConfig(bgp: BgpPlan, shut: ReadonlySet<string>, vxlan: readonly Vni[]): string[] {
  return [
    ...(vxlan.length > 0
      ? [
          "interface Vxlan1",
          "   vxlan source-interface Loopback0",
          "   vxlan udp-port 4789",
          ...vxlan.map((e) => `   vxlan vlan ${e.vlan} vni ${e.vni}`),
          "!",
        ]
      : []),
    `router bgp ${bgp.asn}`,
    `   router-id ${bgp.routerId}`,
    "   maximum-paths 4 ecmp 4",
    ...bgp.neighbors.flatMap((n) => [
      `   neighbor ${n.ip} remote-as ${n.remoteAs}`,
      ...(shut.has(n.ip) ? [`   neighbor ${n.ip} shutdown`] : []),
    ]),
    "   redistribute connected",
    "!",
  ];
}

function nxosConfig(bgp: BgpPlan, shut: ReadonlySet<string>, vxlan: readonly Vni[]): string[] {
  return [
    ...(vxlan.length > 0
      ? [
          "interface nve1",
          "  no shutdown",
          "  host-reachability protocol bgp",
          "  source-interface loopback0",
          ...vxlan.map((e) => `  member vni ${e.vni}`),
        ]
      : []),
    `router bgp ${bgp.asn}`,
    `  router-id ${bgp.routerId}`,
    "  address-family ipv4 unicast",
    "    redistribute direct route-map ALL",
    "    maximum-paths 4",
    ...bgp.neighbors.flatMap((n) => [
      `  neighbor ${n.ip}`,
      `    remote-as ${n.remoteAs}`,
      ...(shut.has(n.ip) ? ["    shutdown"] : []),
      "    address-family ipv4 unicast",
    ]),
  ];
}

function iosConfig(bgp: BgpPlan, shut: ReadonlySet<string>, vxlan: readonly Vni[]): string[] {
  return [
    ...(vxlan.length > 0
      ? [
          "l2vpn evpn",
          " replication-type ingress",
          "!",
          ...vxlan.flatMap((e) => [
            `l2vpn evpn instance ${e.vlan} vlan-based`,
            " encapsulation vxlan",
            "!",
            `vlan configuration ${e.vlan}`,
            ` member evpn-instance ${e.vlan} vni ${e.vni}`,
            "!",
          ]),
        ]
      : []),
    `router bgp ${bgp.asn}`,
    ` bgp router-id ${bgp.routerId}`,
    ...bgp.neighbors.flatMap((n) => [
      ` neighbor ${n.ip} remote-as ${n.remoteAs}`,
      ...(shut.has(n.ip) ? [` neighbor ${n.ip} shutdown`] : []),
    ]),
    " !",
    " address-family ipv4",
    "  redistribute connected",
    "  maximum-paths 4",
    ...bgp.neighbors.map((n) => `  neighbor ${n.ip} activate`),
    " exit-address-family",
    "!",
  ];
}

/** The `router bgp` section (and, on a leaf, the VXLAN interface), in the OS's configuration language. */
export function bgpConfigLines(v: SwitchView, model: NetModel): string[] {
  const sw = v.entity.id;
  const bgp = model.bgp(sw);
  if (!bgp) return [];
  const shut = model.cfg(sw).bgpShut;
  if (v.os === "eos") return eosConfig(bgp, shut, vnis(model, sw));
  return v.os === "nxos"
    ? nxosConfig(bgp, shut, vnis(model, sw))
    : iosConfig(bgp, shut, vnis(model, sw));
}
