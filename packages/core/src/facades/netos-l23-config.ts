/**
 * Layer-2 and layer-3 configuration commands of the switch operating systems (REQ-064, ADR-0061): `vlan`,
 * `switchport ...`, `interface vlan`, `ip address`, `ip route`. Each one is a world command, so a change
 * made here really moves traffic (or cuts it) and the next `show`, `ping` or alarm sees it. Commands act
 * at once, as on the devices; there is no commit step and `write memory` saves nothing more than before.
 */
import { InvalidValueError } from "@terrarium/core/kernel";
import {
  maskToLen,
  type PortCfg,
  parseCidr,
  parseHostCidr,
  type SviCfg,
} from "@terrarium/core/world";
import type { Call, Maker, Mode, Spec } from "./netos-cli";
import type { Os, Result } from "./netos-model";

const VLAN_MAX = 4094;
const CONFIG: readonly Mode[] = [
  "config",
  "config-if",
  "config-vlan",
  "config-bgp",
  "config-bgp-nbr",
];
const IF_ONLY: readonly Mode[] = ["config-if"];

/** `100`, `100,102`, `100-105`, `1,5-7` → the VLAN numbers. */
export function parseVlanList(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(",")) {
    const m = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(part.trim());
    const [lo, hi] = [Number(m?.[1]), Number(m?.[2] ?? m?.[1])];
    if (!m || lo < 1 || hi > VLAN_MAX || lo > hi)
      throw new InvalidValueError(`'${text}' is not a VLAN list (1-${VLAN_MAX})`);
    for (let v = lo; v <= hi; v++) out.push(v);
  }
  return out;
}

const vlanArg = (text: string): number => {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > VLAN_MAX)
    throw new InvalidValueError(`VLAN ID must be 1-${VLAN_MAX}`);
  return n;
};

function setVlan(c: Call, id: number, name: string | null): void {
  c.session.change({ op: "vlan", id, name });
}

/** Creates a VLAN if it does not exist; returns whether it was new. */
function ensureVlan(c: Call, id: number): boolean {
  if (c.session.model().cfg(c.session.deviceId).vlans.has(id)) return false;
  setVlan(c, id, `VLAN${String(id).padStart(4, "0")}`);
  return true;
}

function enterVlan(c: Call): undefined {
  const id = vlanArg(c.args[0] as string);
  ensureVlan(c, id);
  c.session.vlan = id;
  c.session.mode = "config-vlan";
  return undefined;
}

function removeVlan(c: Call): undefined {
  const id = vlanArg(c.args[0] as string);
  setVlan(c, id, null);
  return undefined;
}

function nameVlan(c: Call): undefined {
  setVlan(c, c.session.vlan, (c.args[0] as string).slice(0, 32));
  return undefined;
}

// ── ports ────────────────────────────────────────────────────────────────────────────────────────

function portCfg(c: Call): PortCfg {
  return c.session.model().portCfg(c.session.deviceId, c.session.port);
}

function setPort(c: Call, cfg: PortCfg): undefined {
  if (c.session.port === 0) throw new InvalidValueError("not a switch port");
  c.session.change({ op: "port", port: c.session.port, cfg });
  return undefined;
}

type Trunk = Extract<PortCfg, { mode: "trunk" }>;
const TRUNK: Trunk = { mode: "trunk", allowed: "all", native: 1 };

function setMode(c: Call, mode: "access" | "trunk"): undefined {
  const now = portCfg(c);
  if (now.mode === mode) return undefined;
  return setPort(c, mode === "trunk" ? TRUNK : { mode: "access", vlan: 1 });
}

function accessVlan(c: Call): Result | undefined {
  const vlan = vlanArg(c.args[0] as string);
  const created = c.v.os === "iosxe" && ensureVlan(c, vlan);
  setPort(c, { mode: "access", vlan });
  return created ? { text: `% Access VLAN does not exist. Creating vlan ${vlan}` } : undefined;
}

function trunkOf(c: Call): Trunk {
  const now = portCfg(c);
  return now.mode === "trunk" ? now : TRUNK;
}

const ALL_VLANS: readonly number[] = Array.from({ length: VLAN_MAX }, (_, i) => i + 1);

/** `switchport trunk allowed vlan [add|remove] <list>` and `all` / `none`. */
function trunkAllowed(c: Call, how: "set" | "add" | "remove" | "all" | "none"): undefined {
  const trunk = trunkOf(c);
  if (how === "all") return setPort(c, { ...trunk, allowed: "all" });
  if (how === "none") return setPort(c, { ...trunk, allowed: [] });
  const list = parseVlanList(c.args[0] as string);
  const current = trunk.allowed === "all" ? [...ALL_VLANS] : [...trunk.allowed];
  const next =
    how === "set"
      ? list
      : how === "add"
        ? [...new Set([...current, ...list])]
        : current.filter((v) => !list.includes(v));
  return setPort(c, { ...trunk, allowed: next.sort((a, b) => a - b) });
}

function trunkNative(c: Call): undefined {
  return setPort(c, { ...trunkOf(c), native: vlanArg(c.args[0] as string) });
}

// ── interface addresses ──────────────────────────────────────────────────────────────────────────

/** `10.0.0.2/24` or `10.0.0.2 255.255.255.0` → address text and prefix length. */
function addressOf(args: readonly string[]): { ip: string; len: number } {
  const first = args[0] as string;
  const parsed = args[1] === undefined ? parseHostCidr(first) : undefined;
  if (parsed) return { ip: first.split("/")[0] as string, len: parsed.len };
  const len = args[1] === undefined ? undefined : maskToLen(args[1]);
  if (len === undefined)
    throw new InvalidValueError(`'${args.join(" ")}' is not an address with a mask`);
  return { ip: first, len };
}

function sviNow(c: Call): SviCfg {
  const svi = c.session.model().cfg(c.session.deviceId).svis.get(c.session.svi);
  if (!svi) throw new InvalidValueError(`interface Vlan${c.session.svi} does not exist`);
  return svi;
}

function setSvi(c: Call, svi: SviCfg | null): undefined {
  c.session.change({ op: "svi", vlan: c.session.svi, cfg: svi });
  return undefined;
}

function ipAddress(c: Call): undefined {
  const { ip, len } = addressOf(c.args);
  if (c.session.svi > 0) return setSvi(c, { ...sviNow(c), ip, len });
  if (portCfg(c).mode !== "routed")
    throw new InvalidValueError("the port is a switchport; use 'no switchport' first");
  return setPort(c, { mode: "routed", ip, len });
}

function noIpAddress(c: Call): undefined {
  if (c.session.svi > 0) return setSvi(c, { ...sviNow(c), ip: "0.0.0.0", len: 0 });
  return portCfg(c).mode === "routed" ? setPort(c, { mode: "routed" }) : undefined;
}

function virtualAddress(c: Call, ip: string | undefined): undefined {
  if (c.session.svi === 0)
    throw new InvalidValueError("only a VLAN interface has a virtual address");
  const { virtual: _gone, ...rest } = sviNow(c);
  return setSvi(c, ip === undefined ? rest : { ...rest, virtual: ip });
}

/** `interface vlan 100`: selects the VLAN interface, creating it when it is new. */
export function enterSvi(c: Call, id: number): undefined {
  const cfg = c.session.model().cfg(c.session.deviceId);
  if (!cfg.svis.has(id))
    c.session.change({
      op: "svi",
      vlan: id,
      cfg: { ip: "0.0.0.0", len: 0, shut: c.v.os === "nxos" },
    });
  c.session.svi = id;
  c.session.port = 0;
  c.session.mode = "config-if";
  return undefined;
}

function removeSvi(c: Call): undefined {
  c.session.change({ op: "svi", vlan: vlanArg(c.args[0] as string), cfg: null });
  return undefined;
}

// ── routes ───────────────────────────────────────────────────────────────────────────────────────

function routeOf(args: readonly string[]): { net: string; len: number; via: string } {
  const three = args.length === 3;
  const cidr = three ? undefined : parseCidr(args[0] as string);
  const len = three ? maskToLen(args[1] as string) : cidr?.len;
  if (len === undefined || (!three && !cidr))
    throw new InvalidValueError(`'${args[0]}' is not a network`);
  return {
    net: three ? (args[0] as string) : ((args[0] as string).split("/")[0] as string),
    len,
    via: args.at(-1) as string,
  };
}

function route(c: Call, remove: boolean): undefined {
  c.session.change({ op: "route", route: routeOf(c.args), remove });
  return undefined;
}

// ── the table ────────────────────────────────────────────────────────────────────────────────────

export function l23ConfigSpecs(s: Maker, os: Os): Spec[] {
  const cfgOnly: readonly Mode[] = ["config"];
  const specs: Spec[] = [
    s("vlan <id>", ["config", "config-vlan"], enterVlan),
    s("no vlan <id>", ["config", "config-vlan"], removeVlan),
    s("name <text...>", ["config-vlan"], nameVlan),
    s("switchport mode access", IF_ONLY, (c) => setMode(c, "access")),
    s("switchport mode trunk", IF_ONLY, (c) => setMode(c, "trunk")),
    s("switchport access vlan <id>", IF_ONLY, accessVlan),
    s("no switchport access vlan", IF_ONLY, (c) => setPort(c, { mode: "access", vlan: 1 })),
    s("switchport trunk allowed vlan all", IF_ONLY, (c) => trunkAllowed(c, "all")),
    s("switchport trunk allowed vlan none", IF_ONLY, (c) => trunkAllowed(c, "none")),
    s("switchport trunk allowed vlan add <list>", IF_ONLY, (c) => trunkAllowed(c, "add")),
    s("switchport trunk allowed vlan remove <list>", IF_ONLY, (c) => trunkAllowed(c, "remove")),
    s("switchport trunk allowed vlan <list>", IF_ONLY, (c) => trunkAllowed(c, "set")),
    s("switchport trunk native vlan <id>", IF_ONLY, trunkNative),
    s("no switchport", IF_ONLY, (c) => setPort(c, { mode: "routed" })),
    s("switchport", IF_ONLY, (c) => setPort(c, { mode: "access", vlan: 1 })),
    s("interface vlan <id>", CONFIG, (c) => enterSvi(c, vlanArg(c.args[0] as string))),
    s("no interface vlan <id>", cfgOnly, removeSvi),
    s("ip address <addr>", IF_ONLY, ipAddress),
    s("ip address <addr> <mask>", IF_ONLY, ipAddress),
    s("no ip address", IF_ONLY, noIpAddress),
    s("ip route <prefix> <via>", cfgOnly, (c) => route(c, false)),
    s("ip route <net> <mask> <via>", cfgOnly, (c) => route(c, false)),
    s("no ip route <prefix> <via>", cfgOnly, (c) => route(c, true)),
    s("no ip route <net> <mask> <via>", cfgOnly, (c) => route(c, true)),
  ];
  if (os === "eos") {
    specs.push(
      s("ip virtual-router address <ip>", IF_ONLY, (c) => virtualAddress(c, c.args[0])),
      s("no ip virtual-router address", IF_ONLY, (c) => virtualAddress(c, undefined)),
      s("ip routing", cfgOnly, () => undefined),
    );
  }
  if (os === "iosxe") {
    specs.push(
      s("standby <group> ip <ip>", IF_ONLY, (c) => virtualAddress(c, c.args[1])),
      s("no standby <group> ip", IF_ONLY, (c) => virtualAddress(c, undefined)),
      s("ip routing", cfgOnly, () => undefined),
    );
  }
  return specs;
}
