/**
 * Whether a layer-2/3 change makes sense before it is recorded (REQ-064): the target is a switch, the
 * numbers are in range, the addresses are addresses. A refused change changes nothing and is not logged.
 */
import { InvalidValueError } from "@terrarium/core/kernel";
import { ipToInt, networkOf } from "./net-addr";
import { type NetChange, type PortCfg, type RouteCfg, routeKey, type SviCfg } from "./net-config";
import { planOf } from "./net-plan";
import { switchWires } from "./net-topology";
import type { WorldReader } from "./world";

export const VLAN_MAX = 4094;

const isVlan = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= VLAN_MAX;

function need(ok: boolean, text: string): void {
  if (!ok) throw new InvalidValueError(text);
}

function checkPortCfg(cfg: PortCfg): void {
  if (cfg.mode === "access") need(isVlan(cfg.vlan), `VLAN must be 1..${VLAN_MAX}`);
  else if (cfg.mode === "trunk") {
    need(isVlan(cfg.native), `native VLAN must be 1..${VLAN_MAX}`);
    need(
      cfg.allowed === "all" || (Array.isArray(cfg.allowed) && cfg.allowed.every(isVlan)),
      `allowed VLANs must be 'all' or VLANs 1..${VLAN_MAX}`,
    );
  } else if (cfg.ip !== undefined) {
    need(ipToInt(cfg.ip) !== undefined, `'${cfg.ip}' is not an IPv4 address`);
    need(
      Number.isInteger(cfg.len) && (cfg.len as number) >= 0 && (cfg.len as number) <= 32,
      "prefix length must be 0..32",
    );
  }
}

function checkSvi(vlan: number, cfg: SviCfg | null): void {
  need(isVlan(vlan), `VLAN must be 1..${VLAN_MAX}`);
  if (cfg === null) return;
  need(ipToInt(cfg.ip) !== undefined, `'${cfg.ip}' is not an IPv4 address`);
  need(Number.isInteger(cfg.len) && cfg.len >= 0 && cfg.len <= 32, "prefix length must be 0..32");
  if (cfg.virtual !== undefined)
    need(ipToInt(cfg.virtual) !== undefined, `'${cfg.virtual}' is not an IPv4 address`);
}

function checkRoute(route: RouteCfg): void {
  const net = ipToInt(route.net);
  need(net !== undefined, `'${route.net}' is not an IPv4 address`);
  need(
    Number.isInteger(route.len) && route.len >= 0 && route.len <= 32,
    "prefix length must be 0..32",
  );
  need(networkOf(net as number, route.len) === net, `${route.net}/${route.len} has host bits set`);
  need(ipToInt(route.via) !== undefined, `'${route.via}' is not an IPv4 address`);
}

function checkVlan(change: Extract<NetChange, { op: "vlan" }>): void {
  need(isVlan(change.id), `VLAN must be 1..${VLAN_MAX}`);
  need(
    !(change.id === 1 && change.name === null),
    "VLAN 1 is the default VLAN and cannot be removed",
  );
  need(change.name === null || change.name.length <= 32, "a VLAN name is 32 characters at most");
}

function checkPort(
  world: WorldReader,
  target: string,
  change: Extract<NetChange, { op: "port" }>,
): void {
  const model = world.catalog.getOf(world.index.entity(target).modelId ?? "", "switch");
  const ports = Math.max(model.ports, switchWires(world.index, target).length);
  need(
    Number.isInteger(change.port) && change.port >= 1 && change.port <= ports,
    `the switch has ports 1..${ports}`,
  );
  checkPortCfg(change.cfg);
}

/** A static route can be added or removed; a route learned over BGP can only be lost by shutting its session. */
function checkRouteChange(
  world: WorldReader,
  target: string,
  change: Extract<NetChange, { op: "route" }>,
): void {
  checkRoute(change.route);
  if (!change.remove) return;
  const designed = planOf(world.index, world.catalog).switches.get(target)?.design.routes ?? [];
  const key = routeKey(change.route);
  need(
    !designed.some((r) => r.proto === "bgp" && routeKey(r) === key),
    `${change.route.net}/${change.route.len} via ${change.route.via} is learned over BGP; shut the neighbor to lose it`,
  );
}

function checkBgp(
  world: WorldReader,
  target: string,
  change: Extract<NetChange, { op: "bgp" }>,
): void {
  const bgp = planOf(world.index, world.catalog).bgp.get(target);
  need(bgp !== undefined, "BGP is not configured on this switch");
  need(
    bgp?.neighbors.some((n) => n.ip === change.neighbor) === true,
    `'${change.neighbor}' is not a BGP neighbor of this switch`,
  );
}

/** Throws why a change to a switch's layer-2/3 configuration would be refused. */
export function checkNetChange(world: WorldReader, target: string, change: NetChange): void {
  need(world.stateOf(target).kind === "switch", `'${target}' is not a switch`);
  if (change.op === "vlan") checkVlan(change);
  else if (change.op === "port") checkPort(world, target, change);
  else if (change.op === "svi") checkSvi(change.vlan, change.cfg);
  else if (change.op === "bgp") checkBgp(world, target, change);
  else checkRouteChange(world, target, change);
}
