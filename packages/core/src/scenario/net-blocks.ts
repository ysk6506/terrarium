/**
 * Running and checking the configuration blocks (REQ-068). A block becomes the operator commands a person
 * would type: `link.admin` for a port, `outlet.set` for an outlet, `net.set` for the switch's VLANs, VLAN
 * interfaces, BGP neighbors and routes. What a block offers to pick (the devices cabled to a switch, its VLAN
 * interfaces, its BGP neighbors, its static routes, a PDU's outlets) is read off the network the cables design,
 * so the editor lists only what is really there; the run reads the switch as it is now (an earlier block or an
 * agent may have changed it).
 */
import { Catalog } from "@terrarium/core/catalog";
import { InvalidValueError, withJosa } from "@terrarium/core/kernel";
import {
  type BlueprintIndex,
  netModelOf,
  parseCidr,
  planOf,
  type WorldCommand,
  type WorldReader,
} from "@terrarium/core/world";
import { blockSpec, type NetPick } from "./blocks";
import type { ScenarioNode } from "./model";
import { bad, type Problem, type ScenarioEnv } from "./problems";

let builtin: Catalog | undefined;

/** The built-in equipment models, for a caller that has no catalog of its own (the editor, a template list). */
export function builtinCatalog(): Catalog {
  builtin ??= new Catalog();
  return builtin;
}

/** One thing a block can pick: what is stored in the block, and what a person reads. */
export interface NetChoice {
  readonly value: string;
  readonly label: string;
}

const nameOf = (index: BlueprintIndex, id: string): string => index.find(id)?.name ?? id;

/** The same text the picker stores for a static route. */
export const routeValue = (r: { net: string; len: number; via: string }): string =>
  `${r.net}/${r.len} via ${r.via}`;

function cabledPeers(index: BlueprintIndex, catalog: Catalog, target: string): NetChoice[] {
  const seen = new Set<string>();
  const out: NetChoice[] = [];
  for (const w of planOf(index, catalog).switches.get(target)?.wires ?? []) {
    if (seen.has(w.peerId)) continue;
    seen.add(w.peerId);
    out.push({ value: w.peerId, label: `${nameOf(index, w.peerId)} (포트 ${w.n}번)` });
  }
  return out;
}

function sviVlans(index: BlueprintIndex, catalog: Catalog, target: string): NetChoice[] {
  const design = planOf(index, catalog).switches.get(target)?.design;
  return [...(design?.svis ?? [])].map(([vlan, svi]) => ({
    value: String(vlan),
    label: `VLAN ${vlan} ${design?.vlans.get(vlan) ?? ""} (${svi.ip}/${svi.len})`.replace(
      "  ",
      " ",
    ),
  }));
}

function bgpPeers(index: BlueprintIndex, catalog: Catalog, target: string): NetChoice[] {
  const neighbors = planOf(index, catalog).bgp.get(target)?.neighbors ?? [];
  return neighbors.map((n) => ({
    value: n.peer,
    label: `${nameOf(index, n.peer)} (${n.ip}, AS ${n.remoteAs})`,
  }));
}

function staticRoutes(index: BlueprintIndex, catalog: Catalog, target: string): NetChoice[] {
  const routes = planOf(index, catalog).switches.get(target)?.design.routes ?? [];
  return routes
    .filter((r) => r.proto !== "bgp")
    .map((r) => ({ value: routeValue(r), label: `${r.net}/${r.len} → ${r.via}` }));
}

function outlets(index: BlueprintIndex, catalog: Catalog, target: string): NetChoice[] {
  const model = catalog.getOf(index.entity(target).modelId ?? "", "pdu");
  if (model.shelf) return [];
  const cables = index.incoming(target, "power");
  const count = Math.max(cables.length, model.outlets);
  return Array.from({ length: count }, (_, i) => {
    const consumer = cables[i] ? nameOf(index, cables[i].from) : "비어 있음";
    return { value: String(i + 1), label: `${i + 1}번 — ${consumer}` };
  });
}

const PICKERS: Readonly<
  Record<NetPick, (index: BlueprintIndex, catalog: Catalog, target: string) => NetChoice[]>
> = {
  cabled_peer: cabledPeers,
  svi_vlan: sviVlans,
  bgp_peer: bgpPeers,
  static_route: staticRoutes,
  outlet: outlets,
};

/** What the switch or PDU `target` offers for a pick, as the world's cables design it. */
export function netChoices(
  index: BlueprintIndex,
  catalog: Catalog | undefined,
  kind: NetPick,
  target: string,
): NetChoice[] {
  if (!index.find(target)) return [];
  return PICKERS[kind](index, catalog ?? builtinCatalog(), target);
}

const text = (node: ScenarioNode, name: string): string => String(node.params[name] ?? "");
const whole = (node: ScenarioNode, name: string): number => Number(node.params[name]);
const down = (node: ScenarioNode): boolean => node.params.down !== false;

/** The network cables between two devices, whichever way round they are drawn. */
const cablesBetween = (index: BlueprintIndex, a: string, b: string) =>
  index
    .allLinks()
    .filter(
      (l) => l.kind === "network" && ((l.from === a && l.to === b) || (l.from === b && l.to === a)),
    );

/** The port number of the cable between a switch and a device. */
function portTo(world: WorldReader, sw: string, peer: string): number {
  const wire = planOf(world.index, world.catalog)
    .switches.get(sw)
    ?.wires.find((w) => w.peerId === peer);
  if (!wire) throw new InvalidValueError(`${sw} has no cable to ${peer}`);
  return wire.n;
}

const ROUTE = /^(\S+)\/(\d{1,2}) via (\S+)$/;

/** The blocks that are one command or one command per cable: a port, an outlet, a network policy. */
function directCommands(
  node: ScenarioNode,
  world: WorldReader,
  target: string,
): WorldCommand[] | undefined {
  switch (node.type) {
    case "port_admin":
      return cablesBetween(world.index, target, text(node, "peer")).map((l) => ({
        type: "link.admin",
        target: l.id,
        end: l.from === target ? "from" : "to",
        down: down(node),
      }));
    case "policy_set":
      return [{ type: "policy.set", target, rule: node.params.deny === false ? "allow" : "deny" }];
    case "outlet_set":
      return [
        { type: "outlet.set", target, outlet: whole(node, "outlet"), on: node.params.on === true },
      ];
    default:
      return undefined;
  }
}

/** The operator commands the block stands for, in the world as it is. */
export function netCommands(node: ScenarioNode, world: WorldReader): WorldCommand[] {
  const target = text(node, "target");
  const direct = directCommands(node, world, target);
  if (direct) return direct;
  const net = (change: Extract<WorldCommand, { type: "net.set" }>["change"]): WorldCommand[] => [
    { type: "net.set", target, change },
  ];
  switch (node.type) {
    case "port_vlan":
      return net({
        op: "port",
        port: portTo(world, target, text(node, "peer")),
        cfg: { mode: "access", vlan: whole(node, "vlan") },
      });
    case "svi_admin": {
      const vlan = whole(node, "vlan");
      const svi = netModelOf(world).cfg(target).svis.get(vlan);
      if (!svi) throw new InvalidValueError(`${target} has no interface for VLAN ${vlan}`);
      return net({ op: "svi", vlan, cfg: { ...svi, shut: down(node) } });
    }
    case "bgp_admin": {
      const peer = text(node, "peer");
      const neighbor = netModelOf(world)
        .bgp(target)
        ?.neighbors.find((n) => n.peer === peer);
      if (!neighbor) throw new InvalidValueError(`${target} has no BGP neighbor ${peer}`);
      return net({ op: "bgp", neighbor: neighbor.ip, shut: down(node) });
    }
    case "route_del": {
      const m = ROUTE.exec(text(node, "route"));
      const cidr = m ? parseCidr(`${m[1]}/${m[2]}`) : undefined;
      if (!m || !cidr) throw new InvalidValueError(`'${text(node, "route")}' is not a route`);
      return net({
        op: "route",
        route: { net: m[1] as string, len: cidr.len, via: m[3] as string },
        remove: true,
      });
    }
    default:
      return [];
  }
}

const EMPTY: Readonly<Record<NetPick, string>> = {
  cabled_peer: "케이블로 이어진 장비가 없어요",
  svi_vlan: "VLAN 인터페이스가 하나도 없어요",
  bgp_peer: "BGP를 쓰지 않아요 (클라우드·GPU 패브릭의 leaf와 spine만 써요)",
  static_route: "손으로 적은 정적 경로가 없어요",
  outlet: "콘센트가 없어요 (전원 셸프예요)",
};

/** What to tell a person when the device they picked has nothing to offer for a pick. */
export const netEmptyText = (kind: NetPick): string => EMPTY[kind];

/** What is wrong with a configuration block taken as a whole: a pick the chosen device does not have. */
export function netBlockProblem(node: ScenarioNode, env: ScenarioEnv): Problem {
  const target = text(node, "target");
  const device = nameOf(env.index, target);
  for (const param of blockSpec(node.type)?.params ?? []) {
    if (param.kind !== "net_pick") continue;
    const choices = netChoices(env.index, env.catalog, param.pick, text(node, param.dependsOn));
    const value = text(node, param.name);
    if (choices.some((c) => c.value === value)) continue;
    if (choices.length === 0) return bad(`${device}에는 ${EMPTY[param.pick]}`, "SC012");
    const list = choices
      .slice(0, 6)
      .map((c) => c.label)
      .join(", ");
    const more = choices.length > 6 ? " …" : "";
    return bad(
      value === ""
        ? `${withJosa(param.label, "을")} 아직 고르지 않았어요 (고를 수 있는 것: ${list}${more})`
        : `${device}에는 '${value}'가 없어요 (고를 수 있는 것: ${list}${more})`,
      "SC012",
    );
  }
  return undefined;
}
