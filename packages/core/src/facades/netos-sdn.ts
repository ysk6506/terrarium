/**
 * The overlay's own `show` commands on the switch CLI (REQ-097, REQ-062): `show nve peers` (NX-OS), `show vxlan vtep`
 * (EOS), and the EVPN summary and VNI table when the switch has a VTEP in the world's SDN overlay. The texts follow what
 * each vendor's documentation shows; the state in them is the state the physics keeps, so what the CLI prints and what
 * the SDN tools say never disagree. A switch without a VTEP falls back to the plain fabric views (netos-bgp.ts).
 */
import { hashHex } from "@terrarium/core/kernel";
import {
  type Entity,
  type NetModel,
  reachableFrom,
  segmentsOfVtep,
  switchOfVtep,
  vtepOfSwitch,
  vtepsOfSegment,
  type WorldReader,
} from "@terrarium/core/world";
import type { Result, SwitchView } from "./netos-model";

const pad = (text: string | number, width: number): string => String(text).padEnd(width);

/** The VNI of a segment: its `vni` property, or one made from its id. */
export const vniOf = (segment: Entity): number =>
  typeof segment.props.vni === "number"
    ? segment.props.vni
    : 10_000 + (parseInt(hashHex(segment.id).slice(0, 4), 16) % 5000);

/** The VTEP of the switch this CLI session is on, if it is in the overlay. */
export const vtepHere = (world: WorldReader, v: SwitchView): Entity | undefined =>
  vtepOfSwitch(world.index, v.entity.id);

const loopback = (model: NetModel, sw: string): string =>
  model.bgp(sw)?.routerId ?? `10.255.0.${1 + (parseInt(hashHex(sw).slice(0, 2), 16) % 250)}`;

const mac = (id: string): string => {
  const h = hashHex(`vtep-mac:${id}`);
  return `${h.slice(0, 4)}.${h.slice(4, 8)}.${h.slice(8, 12)}`;
};

interface Peer {
  readonly id: string;
  readonly ip: string;
  readonly up: boolean;
}

/** The VTEPs that share a segment with this one, and whether the tunnel to each is up from here. */
function peersOf(world: WorldReader, model: NetModel, vtep: Entity): Peer[] {
  const mySw = switchOfVtep(world.index, vtep.id) as string;
  const mine = world.stateAs(vtep.id, "vtep");
  const reach = reachableFrom(world, mySw);
  const seen = new Map<string, Peer>();
  for (const seg of segmentsOfVtep(world.index, vtep.id))
    for (const other of vtepsOfSegment(world.index, seg.id)) {
      if (other.id === vtep.id || seen.has(other.id)) continue;
      const sw = switchOfVtep(world.index, other.id) as string;
      const theirs = world.stateAs(other.id, "vtep");
      const tunnelCut = [vtep.id, other.id].some((id) =>
        world.faultsOn(id).some((f) => f.type === "vxlan_tunnel_down"),
      );
      const up =
        mine.evpn === "established" && theirs.evpn === "established" && !tunnelCut && reach.has(sw);
      seen.set(other.id, { id: other.id, ip: loopback(model, sw), up });
    }
  return [...seen.values()].sort((a, b) => a.ip.localeCompare(b.ip));
}

const NOT_CONFIGURED: Readonly<Record<SwitchView["os"], string>> = {
  eos: "VXLAN is not configured",
  nxos: "% NVE is not configured",
  iosxe: "% NVE is not configured",
};

/** `show nve peers` (NX-OS, IOS XE) and `show vxlan vtep` (EOS): the remote VTEPs with a tunnel that is up. */
export function showNvePeers(v: SwitchView, world: WorldReader, model: NetModel): Result {
  const vtep = vtepHere(world, v);
  if (!vtep) return { text: NOT_CONFIGURED[v.os] };
  const up = peersOf(world, model, vtep).filter((p) => p.up);
  if (v.os === "eos")
    return {
      text: [
        "Remote VTEPS for Vxlan1:",
        "",
        "VTEP              Tunnel Type(s)",
        "----------------- --------------",
        ...up.map((p) => `${pad(p.ip, 17)} unicast, flood`),
        "",
        `Total number of remote VTEPS:  ${up.length}`,
      ].join("\n"),
      data: {
        vteps: Object.fromEntries(up.map((p) => [p.ip, { tunnelType: ["unicast", "flood"] }])),
      },
    };
  return {
    text: [
      "Interface Peer-IP          State LearnType Uptime   Router-Mac",
      "--------- ---------------  ----- --------- -------- -----------------",
      ...up.map(
        (p) =>
          `${pad("nve1", 9)} ${pad(p.ip, 16)} ${pad("Up", 5)} ${pad("CP", 9)} 02:13:07 ${mac(p.id)}`,
      ),
    ].join("\n"),
  };
}

/** The EVPN session summary as the VTEP's own state says it: the sessions are down when the VTEP's session is. */
export function evpnSummaryText(v: SwitchView, world: WorldReader, base: Result): Result {
  const vtep = vtepHere(world, v);
  if (!vtep) return base;
  const s = world.stateAs(vtep.id, "vtep");
  if (s.evpn === "established") return base;
  const flap = s.flaps > 0 ? ` (flapped ${s.flaps} times)` : "";
  const lines = base.text
    .split("\n")
    .map((line) =>
      /^\s*\d+\.\d+\.\d+\.\d+\s/.test(line)
        ? line.replace(/\s+Estab(\s*\d*\s*\d*)?$/, "   Active").replace(/\s+\d+\s*$/, "    Active")
        : line,
    );
  return { text: [...lines, `% EVPN session down${flap}`].join("\n") };
}

/** `show vxlan vni` / `show nve vni`: one row per segment this VTEP carries, down when the VTEP is cut off. */
export function showSegmentVnis(v: SwitchView, world: WorldReader, base: Result): Result {
  const vtep = vtepHere(world, v);
  if (!vtep) return base;
  const segments = segmentsOfVtep(world.index, vtep.id);
  if (segments.length === 0) return base;
  const state = world.stateAs(vtep.id, "vtep");
  const up = !state.cut && state.evpn === "established";
  if (v.os === "eos")
    return {
      text: [
        "VNI to VLAN Mapping for Vxlan1",
        "VNI         VLAN       Source       Interface       802.1Q Tag",
        "----------- ---------- ------------ --------------- ----------",
        ...segments.map(
          (seg, i) =>
            `${pad(vniOf(seg), 11)} ${pad(100 + i, 10)} ${pad("static", 12)} ${pad("Vxlan1", 15)} ${100 + i}${up ? "" : "   (down)"}`,
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
      ...segments.map(
        (seg, i) =>
          `${pad("nve1", 9)} ${pad(vniOf(seg), 8)} ${pad("UnicastBGP", 17)} ${pad(up ? "Up" : "Down", 5)} ${pad("CP", 4)} ${pad(`L2 [${100 + i}]`, 18)} ${up ? "SA" : "UC"}`,
      ),
    ].join("\n"),
  };
}
