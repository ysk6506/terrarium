/**
 * A switch the way its operating system sees it (REQ-062, ADR-0059): which OS it runs, what its ports are
 * called there, and what each port is doing. Ports come from the blueprint's network links, in the
 * order SNMP's IF-MIB uses (links from below, then uplinks, then free ports), so a port has the same
 * index over SNMP, the CLI and the HTTP APIs. The OS and its port names are the only vendor-specific
 * things here; the hardware itself is the catalog's fictional model.
 */
import { manufacturerOf, type SwitchModel } from "@terrarium/core/catalog";
import { hashHex } from "@terrarium/core/kernel";
import type { NetworkProfile, ProfileRegistry } from "@terrarium/core/profiles";
import {
  type Entity,
  type EntityState,
  macOf,
  netModelOf,
  type PortCfg,
  type WorldPort,
  type WorldReader,
} from "@terrarium/core/world";

export { macOf };

export type Os = NetworkProfile["os"];

/** Settings a person makes on the device (hostname, port descriptions); they live beside the world. */
export type Memo = Map<string, string>;

export interface PortView {
  readonly n: number;
  /** The long name, `Ethernet1/1`. */
  readonly name: string;
  /** The short name tables use, `Eth1/1`. */
  readonly short: string;
  readonly linkId?: string;
  /** Which end of the link this switch is. */
  readonly end?: "from" | "to";
  readonly peer?: Entity;
  /** What the other end calls the port, if known. */
  readonly peerPort?: string;
  /** Shut by an operator (`shutdown`). */
  readonly shut: boolean;
  /** Carrying traffic. */
  readonly up: boolean;
  readonly description: string;
  /** What the port carries: an access VLAN, a trunk, or a routed address. */
  readonly cfg: PortCfg;
}

export interface SwitchView {
  readonly entity: Entity;
  readonly model: SwitchModel;
  readonly profile: NetworkProfile;
  readonly os: Os;
  readonly hostname: string;
  readonly serial: string;
  readonly mac: string;
  readonly maker: string;
  readonly uptimeS: number;
  readonly powered: boolean;
  readonly speedGbps: number;
  readonly ports: readonly PortView[];
}

/** What OS a switch of this role runs unless its `nosProfile` property says otherwise. */
const ROLE_PROFILE: Readonly<Record<SwitchModel["role"], string>> = {
  tor: "nxos/10.3",
  spine: "eos/4.32",
  mgmt: "ios-xe/17.9",
};

export function profileKeyOf(entity: Entity, model: SwitchModel): string {
  const wanted = entity.props.nosProfile;
  return typeof wanted === "string" ? wanted : ROLE_PROFILE[model.role];
}

/** IOS XE names a port after its speed. */
const IOS_TYPES: ReadonlyArray<readonly [number, string, string]> = [
  [100, "HundredGigE", "Hu"],
  [40, "FortyGigabitEthernet", "Fo"],
  [25, "TwentyFiveGigE", "Twe"],
  [10, "TenGigabitEthernet", "Te"],
  [0, "GigabitEthernet", "Gi"],
];

function iosType(gbps: number): readonly [number, string, string] {
  for (const type of IOS_TYPES) if (gbps >= type[0]) return type;
  return IOS_TYPES[IOS_TYPES.length - 1] as readonly [number, string, string];
}

function stemOf(
  os: Os,
  gbps: number,
): { long: string; short: string; tail: (n: number) => string } {
  if (os === "eos") return { long: "Ethernet", short: "Et", tail: (n) => String(n) };
  if (os === "nxos") return { long: "Ethernet", short: "Eth", tail: (n) => `1/${n}` };
  const [, long, short] = iosType(gbps);
  return { long, short, tail: (n) => `1/0/${n}` };
}

export const portNameOf = (os: Os, gbps: number, n: number): string => {
  const s = stemOf(os, gbps);
  return `${s.long}${s.tail(n)}`;
};

const STEMS: ReadonlyArray<readonly [string, string]> = [
  ["TwentyFiveGigE", "Twe"],
  ["HundredGigE", "Hu"],
  ["FortyGigabitEthernet", "Fo"],
  ["TenGigabitEthernet", "Te"],
  ["GigabitEthernet", "Gi"],
  ["Ethernet", ""],
];

const splitName = (name: string): { word: string; numbers: string } | undefined => {
  const m = /^([A-Za-z-]+)(\d+(?:\/\d+)*)$/.exec(name);
  return m ? { word: m[1] as string, numbers: m[2] as string } : undefined;
};

/** The short name of a port: the first letters the OS's tables use (`Et1`, `Eth1/1`, `Gi1/0/1`). */
function shortOf(os: Os, name: string): string {
  const parts = splitName(name);
  const stem = STEMS.find(([long]) => long === parts?.word);
  if (!parts || !stem) return name;
  return `${stem[1] || (os === "nxos" ? "Eth" : "Et")}${parts.numbers}`;
}

/** The port a typed name stands for (`Et3`, `ethernet 1/3`, `Gi1/0/3`), or undefined when it is none of this switch's. */
export function findPort(ports: readonly PortView[], os: Os, text: string): PortView | undefined {
  const typed = splitName(text.replace(/\s+/g, ""));
  if (!typed) return undefined;
  const word = typed.word.toLowerCase();
  if (word.length < (os === "iosxe" ? 2 : 1)) return undefined;
  return ports.find((p) => {
    const parts = splitName(p.name);
    if (!parts || parts.numbers !== typed.numbers) return false;
    return (
      parts.word.toLowerCase().startsWith(word) || splitName(p.short)?.word.toLowerCase() === word
    );
  });
}

/** A switch answers and carries traffic when it has power and nobody switched it off. */
const isOn = (state: { powered: boolean; adminOn: boolean }): boolean =>
  state.powered && state.adminOn;

/** Whether the device at the far end of a link keeps the link up (a server that is off drops it). */
function alive(state: EntityState): boolean {
  if (!("powered" in state)) return true;
  return state.powered && (!("adminOn" in state) || state.adminOn);
}

interface Wire {
  readonly linkId: string;
  readonly end: "from" | "to";
  readonly peer: Entity | undefined;
  readonly label: unknown;
  readonly peerLabel: unknown;
}

function wiresOf(world: WorldReader, entity: Entity): Wire[] {
  const down = world.index.incoming(entity.id, "network").map((l) => ({ l, end: "to" as const }));
  const up = world.index.outgoing(entity.id, "network").map((l) => ({ l, end: "from" as const }));
  return [...down, ...up].map(({ l, end }) => ({
    linkId: l.id,
    end,
    peer: world.index.find(end === "to" ? l.from : l.to),
    label: end === "to" ? l.props.toPort : l.props.fromPort,
    peerLabel: end === "to" ? l.props.fromPort : l.props.toPort,
  }));
}

/** The name a switch at the far end gives the port this link lands on. */
function peerSwitchPort(world: WorldReader, peer: Entity, linkId: string): string | undefined {
  const model = world.catalog.getOf(peer.modelId ?? "", "switch");
  const at = wiresOf(world, peer).findIndex((w) => w.linkId === linkId);
  if (at < 0) return undefined;
  const os = profileKey(peer, model).os;
  return portNameOf(os, model.portSpeedGbps, at + 1);
}

const osOfKey = (key: string): Os =>
  key.startsWith("eos") ? "eos" : key.startsWith("nxos") ? "nxos" : "iosxe";
const profileKey = (entity: Entity, model: SwitchModel): { key: string; os: Os } => {
  const key = profileKeyOf(entity, model);
  return { key, os: osOfKey(key) };
};

/** The OS a switch runs, without the rest of the view (SNMP names its interfaces by it). */
export const osOf = (entity: Entity, model: SwitchModel): Os => profileKey(entity, model).os;

/** What the other end of a cable calls its port: the label if the blueprint has one, else a guess a real device would show. */
function peerPortOf(world: WorldReader, wire: Wire | undefined): string | undefined {
  if (typeof wire?.peerLabel === "string") return wire.peerLabel;
  if (!wire?.peer) return undefined;
  return wire.peer.kind === "switch" ? peerSwitchPort(world, wire.peer, wire.linkId) : "eth0";
}

interface Device {
  readonly entity: Entity;
  readonly os: Os;
  readonly gbps: number;
  readonly powered: boolean;
  readonly memo: Memo;
}

/** Whether the port is shut by an operator and whether it carries traffic. */
function portState(
  world: WorldReader,
  v: Device,
  n: number,
  wire: Wire | undefined,
): { shut: boolean; up: boolean } {
  if (!wire) return { shut: v.memo.get(`adminDown.${n}`) === "1", up: false };
  const shut = world.linkAdminDown(wire.linkId, wire.end);
  const peerOk = !wire.peer || alive(world.stateOf(wire.peer.id));
  return { shut, up: v.powered && !shut && peerOk && world.linkUp(wire.linkId) };
}

function portOf(world: WorldReader, v: Device, n: number, wire: Wire | undefined): PortView {
  const name = typeof wire?.label === "string" ? wire.label : portNameOf(v.os, v.gbps, n);
  const peerPort = peerPortOf(world, wire);
  return {
    n,
    name,
    short: shortOf(v.os, name),
    ...(wire ? { linkId: wire.linkId, end: wire.end } : {}),
    ...(wire?.peer ? { peer: wire.peer } : {}),
    ...(peerPort ? { peerPort } : {}),
    ...portState(world, v, n, wire),
    description: v.memo.get(`ifAlias.${n}`) ?? wire?.peer?.name ?? "",
    cfg: netModelOf(world).portCfg(v.entity.id, n),
  };
}

/** Every port of a switch with its state; `memo` carries what people have set on it. */
export function portsOf(world: WorldReader, entity: Entity, os: Os, memo: Memo): PortView[] {
  const model = world.catalog.getOf(entity.modelId ?? "", "switch");
  const powered = isOn(world.stateAs(entity.id, "switch"));
  const wires = wiresOf(world, entity);
  const v = { entity, os, gbps: model.portSpeedGbps, powered, memo };
  return Array.from({ length: Math.max(model.ports, wires.length) }, (_, i) =>
    portOf(world, v, i + 1, wires[i]),
  );
}

export function switchView(
  world: WorldReader,
  entity: Entity,
  profiles: ProfileRegistry,
  memo: Memo,
): SwitchView {
  const model = world.catalog.getOf(entity.modelId ?? "", "switch");
  const { key, os } = profileKey(entity, model);
  const state = world.stateAs(entity.id, "switch");
  return {
    entity,
    model,
    profile: profiles.get("network", key),
    os,
    hostname: memo.get("sysName") ?? entity.name,
    serial: `FOC${hashHex(`serial:${entity.id}`).slice(0, 8).toUpperCase()}`,
    mac: macOf(entity.id),
    maker: manufacturerOf(model),
    uptimeS: Math.floor(world.time()),
    powered: isOn(state),
    speedGbps: model.portSpeedGbps,
    ports: portsOf(world, entity, os, memo),
  };
}

/** What a show command produced: the text the CLI prints and, where the OS has one, its structured form. */
export interface Result {
  readonly text: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * `shutdown` / `no shutdown` on a port. A port with a cable shuts that end of the link in the world; a free port
 * has nothing to cut, so the switch only remembers it (and shows it disabled).
 */
export function shutPort(
  world: WorldPort,
  deviceId: string,
  port: PortView,
  memo: Memo,
  down: boolean,
): void {
  if (port.linkId && port.end) {
    if (world.linkAdminDown(port.linkId, port.end) !== down)
      world.apply(
        { type: "link.admin", target: port.linkId, end: port.end, down },
        `network:${deviceId}`,
      );
    return;
  }
  memo.set(`adminDown.${port.n}`, down ? "1" : "0");
}
