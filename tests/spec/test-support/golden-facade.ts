/**
 * What the network facade prints for a switch, from what the links of the world say today (REQ-062, REQ-065): the
 * interface lists and the neighbors a switch sees (CLI and SNMP), and the routing text of a cloud fabric (BGP sessions,
 * ECMP, EVPN, routes, the running configuration). A switch runs one of three operating systems; each gets its own
 * commands. Recorded for the healthy world, and for the two switches at the ends of an uplink after it is cut.
 */
import { createFacades, type Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { type Blueprint, type Entity, World } from "@terrarium/core/world";
import { catalog, fingerprintText, type GoldenWorld, settledWorld } from "./golden-matrix";

type Os = "eos" | "nxos" | "iosxe";

const ENABLE: Readonly<Record<Os, string[]>> = { eos: ["enable"], nxos: [], iosxe: ["enable"] };

/** The interface and neighbor views of a switch, by OS. */
const INTERFACES: Readonly<Record<Os, string[]>> = {
  eos: [
    "show interfaces status",
    "show interfaces description",
    "show ip interface brief",
    "show lldp neighbors",
  ],
  nxos: [
    "show interface status",
    "show interface description",
    "show ip interface brief",
    "show lldp neighbors",
  ],
  iosxe: [
    "show interfaces status",
    "show interfaces description",
    "show ip interface brief",
    "show lldp neighbors",
  ],
};

/** The BGP, ECMP and route views, and the configuration text that holds them, by OS. */
const ROUTING: Readonly<Record<Os, string[]>> = {
  eos: [
    "show running-config",
    "show ip bgp summary",
    "show bgp evpn summary",
    "show vxlan vni",
    "show ip route",
  ],
  nxos: [
    "show running-config",
    "show ip bgp summary",
    "show bgp l2vpn evpn summary",
    "show nve vni",
    "show ip route",
  ],
  iosxe: ["show running-config", "show ip bgp summary", "show ip route"],
};

interface Step {
  readonly command: string;
  readonly output: string;
  readonly ok: boolean;
}

function osOf(facades: Facades, id: string): Os {
  const probe = facades.network.cli(id, { commands: ["show clock"] });
  if ("timeout" in probe) return "nxos";
  return probe.os as Os;
}

export function transcript(facades: Facades, id: string, commands: readonly string[]): string {
  const res = facades.network.cli(id, { commands });
  if ("timeout" in res) return `timeout ${res.message}`;
  return (res.steps as Step[]).map((s) => `${s.command} [${s.ok}]\n${s.output}`).join("\n--\n");
}

function snmpWalk(facades: Facades, id: string): string {
  const res = facades.snmp.handle(id, { operation: "walk", oids: ["interfaces", "ifMIB"] });
  return JSON.stringify(res);
}

/** The three views of one switch, each as a fingerprint. */
function viewsOf(facades: Facades, id: string): Record<string, string> {
  const os = osOf(facades, id);
  return {
    [`${id}/interfaces`]: fingerprintText(
      transcript(facades, id, [...ENABLE[os], ...INTERFACES[os]]),
    ),
    [`${id}/routing`]: fingerprintText(transcript(facades, id, [...ENABLE[os], ...ROUTING[os]])),
    [`${id}/snmp`]: fingerprintText(snmpWalk(facades, id)),
  };
}

/** The first cable that joins two switches, and the two switches. */
function uplinkEnds(world: World): { id: string; ends: Entity[] } | undefined {
  const isSwitch = (id: string) => world.index.find(id)?.kind === "switch";
  const link = world.index
    .allLinks()
    .find((l) => l.kind === "network" && isSwitch(l.from) && isSwitch(l.to));
  if (!link) return undefined;
  const ends = [link.from, link.to].map((id) => world.index.find(id)).filter((e) => !!e);
  return { id: link.id, ends: ends as Entity[] };
}

/** Every switch of a world with its three views; then the two ends of an uplink again with the cable cut. */
export function facadeFingerprints(golden: GoldenWorld): Record<string, string> {
  const blueprint: Blueprint = golden.make();
  const world = settledWorld(blueprint);
  const facades = createFacades(world);
  const out: Record<string, string> = {};
  for (const sw of world.index.ofKind("switch")) Object.assign(out, viewsOf(facades, sw.id));
  const uplink = uplinkEnds(world);
  if (!uplink) return out;
  const cut = World.fromBlueprint(blueprint, catalog);
  cut.adopt(world.checkpoint());
  cut.apply(
    {
      type: "fault.add",
      fault: { id: "f-uplink", type: "link_down", target: uplink.id, params: {} },
    },
    "golden",
  );
  new Physics(cut).run(120);
  const cutFacades = createFacades(cut);
  for (const end of uplink.ends)
    for (const [key, value] of Object.entries(viewsOf(cutFacades, end.id)))
      out[`${key}@uplink-cut`] = value;
  return out;
}
