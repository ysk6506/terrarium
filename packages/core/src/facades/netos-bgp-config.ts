/**
 * BGP commands of the switch operating systems (REQ-065, ADR-0062): `router bgp <asn>` and, under it, shutting
 * and reopening a neighbor. EOS and IOS XE take `neighbor <ip> shutdown` in the BGP section; NX-OS has a section
 * per neighbor. A session ends when either side is shut, and the routes it carried go with it. Neighbors and
 * AS numbers are derived from the cabling (net-bgp.ts), so `neighbor <ip> remote-as` is accepted only when it
 * says what the fabric already has, and a switch that is not part of a cloud fabric has no BGP to configure.
 */
import { InvalidValueError } from "@terrarium/core/kernel";
import type { BgpNeighbor, BgpPlan } from "@terrarium/core/world";
import { showBgpSummary, showVni } from "./netos-bgp";
import type { Call, Maker, Mode, Spec } from "./netos-cli";
import type { Os } from "./netos-model";
import { evpnSummaryText, showNvePeers, showSegmentVnis } from "./netos-sdn";
import { showSpanningTree } from "./netos-stp";

/** Where a BGP section can be entered from: any configuration mode. */
const ANY_CONFIG: readonly Mode[] = [
  "config",
  "config-if",
  "config-vlan",
  "config-bgp",
  "config-bgp-nbr",
];
const IN_BGP: readonly Mode[] = ["config-bgp"];
const IN_NEIGHBOR: readonly Mode[] = ["config-bgp-nbr"];

function planOf(c: Call): BgpPlan {
  const bgp = c.session.model().bgp(c.session.deviceId);
  if (!bgp)
    throw new InvalidValueError("BGP is not available here: the switch is not in a cloud fabric");
  return bgp;
}

function neighborOf(c: Call, ip: string): BgpNeighbor {
  const found = planOf(c).neighbors.find((n) => n.ip === ip);
  if (!found) throw new InvalidValueError(`'${ip}' is not a BGP neighbor of this switch`);
  return found;
}

function enterBgp(c: Call): undefined {
  const bgp = planOf(c);
  if (Number(c.args[0]) !== bgp.asn)
    throw new InvalidValueError(`BGP is already running; AS is ${bgp.asn}`);
  c.session.mode = "config-bgp";
  return undefined;
}

function setShut(c: Call, ip: string, shut: boolean): undefined {
  neighborOf(c, ip);
  c.session.change({ op: "bgp", neighbor: ip, shut });
  return undefined;
}

function checkRemoteAs(c: Call, ip: string, asn: string): undefined {
  const n = neighborOf(c, ip);
  if (Number(asn) !== n.remoteAs)
    throw new InvalidValueError(
      `neighbor ${ip} is AS ${n.remoteAs} in this fabric; remote-as ${asn} would not match the cabling`,
    );
  return undefined;
}

function enterNeighbor(c: Call): undefined {
  c.session.neighbor = neighborOf(c, c.args[0] as string).ip;
  c.session.mode = "config-bgp-nbr";
  return undefined;
}

export function bgpConfigSpecs(s: Maker, os: Os): Spec[] {
  const specs = [s("router bgp <asn>", ANY_CONFIG, enterBgp)];
  if (os === "nxos")
    return [
      ...specs,
      s("neighbor <ip>", [...IN_BGP, ...IN_NEIGHBOR], enterNeighbor),
      s("shutdown", IN_NEIGHBOR, (c) => setShut(c, c.session.neighbor, true)),
      s("no shutdown", IN_NEIGHBOR, (c) => setShut(c, c.session.neighbor, false)),
      s("remote-as <asn>", IN_NEIGHBOR, (c) =>
        checkRemoteAs(c, c.session.neighbor, c.args[0] as string),
      ),
    ];
  return [
    ...specs,
    s("neighbor <ip> shutdown", IN_BGP, (c) => setShut(c, c.args[0] as string, true)),
    s("no neighbor <ip> shutdown", IN_BGP, (c) => setShut(c, c.args[0] as string, false)),
    s("neighbor <ip> remote-as <asn>", IN_BGP, (c) =>
      checkRemoteAs(c, c.args[0] as string, c.args[1] as string),
    ),
  ];
}

/** The BGP and VXLAN `show` commands, spelled as the OS spells them. */
export function bgpShowSpecs(s: Maker, os: Os, shows: readonly Mode[]): Spec[] {
  const summary: Spec[] = [
    s("show ip bgp summary", shows, (c) => showBgpSummary(c.v, c.session.model())),
    s("show bgp ipv4 unicast summary", shows, (c) => showBgpSummary(c.v, c.session.model())),
  ];
  if (os === "eos")
    return [
      ...summary,
      s("show bgp evpn summary", shows, (c) =>
        evpnSummaryText(c.v, c.session.world, showBgpSummary(c.v, c.session.model(), "evpn")),
      ),
      s("show vxlan vni", shows, (c) =>
        showSegmentVnis(c.v, c.session.world, showVni(c.v, c.session.model())),
      ),
      s("show vxlan vtep", shows, (c) => showNvePeers(c.v, c.session.world, c.session.model())),
    ];
  return [
    ...summary,
    s("show bgp l2vpn evpn summary", shows, (c) =>
      evpnSummaryText(c.v, c.session.world, showBgpSummary(c.v, c.session.model(), "evpn")),
    ),
    s("show nve vni", shows, (c) =>
      showSegmentVnis(c.v, c.session.world, showVni(c.v, c.session.model())),
    ),
    s("show vxlan vni", shows, (c) =>
      showSegmentVnis(c.v, c.session.world, showVni(c.v, c.session.model())),
    ),
    s("show nve peers", shows, (c) => showNvePeers(c.v, c.session.world, c.session.model())),
  ];
}

/** `show spanning-tree` (all OSes) and, where the OS has per-VLAN trees, one VLAN's. */
export function stpShowSpecs(s: Maker, os: Os, shows: readonly Mode[]): Spec[] {
  const all = s("show spanning-tree", shows, (c) => showSpanningTree(c.v, c.session.model()));
  if (os === "eos") return [all];
  return [
    all,
    s("show spanning-tree vlan <id>", shows, (c) =>
      showSpanningTree(c.v, c.session.model(), Number(c.args[0])),
    ),
  ];
}
