/**
 * What a switch is configured to do at layer 2 and 3 (REQ-064, ADR-0061): its VLANs, what each port carries,
 * its VLAN interfaces (SVIs) and static routes. The *design* of that comes from the blueprint (net-plan.ts);
 * what an operator changed is a sparse patch in the world's state. The effective configuration is the design
 * with the patch laid over it, so a world nobody has touched holds no network state at all.
 */

export type PortCfg =
  | { readonly mode: "access"; readonly vlan: number }
  | {
      readonly mode: "trunk";
      /** `"all"` or the list of VLANs the trunk allows. */
      readonly allowed: "all" | readonly number[];
      readonly native: number;
    }
  /** A routed port (`no switchport`): no VLAN, an address of its own. */
  | { readonly mode: "routed"; readonly ip?: string; readonly len?: number };

/** A VLAN interface: the switch's address in a VLAN, and the gateway hosts in that VLAN send to. */
export interface SviCfg {
  readonly ip: string;
  readonly len: number;
  readonly shut: boolean;
  /** The shared gateway address of a redundant pair (VRRP/HSRP/virtual-router); the live switch answers for it. */
  readonly virtual?: string;
  /** The address is an anycast gateway: every leaf of the fabric answers for it, the one next to the host does (cloud fabric). */
  readonly anycast?: boolean;
}

export interface RouteCfg {
  readonly net: string;
  readonly len: number;
  readonly via: string;
  /** Learned over BGP (the routes of a cloud fabric): present only while the session to `via` is up. Absent: a static route. */
  readonly proto?: "bgp";
}

export interface SwitchCfg {
  readonly vlans: ReadonlyMap<number, string>;
  readonly ports: ReadonlyMap<number, PortCfg>;
  readonly svis: ReadonlyMap<number, SviCfg>;
  readonly routes: readonly RouteCfg[];
  /** BGP neighbors (by address) an operator has shut down. */
  readonly bgpShut: ReadonlySet<string>;
}

/** What operators changed on one switch; JSON, so it travels in snapshots. Absent keys mean "as designed". */
export interface NetPatch {
  /** VLAN id → name, or null when the VLAN was removed. */
  vlans?: Record<string, string | null>;
  /** Port number → its whole configuration. */
  ports?: Record<string, PortCfg>;
  /** VLAN id → the VLAN interface, or null when removed. */
  svis?: Record<string, SviCfg | null>;
  routes?: { add?: RouteCfg[]; del?: string[] };
  /** BGP neighbor address → true while it is shut down. */
  bgp?: Record<string, true>;
}

/** One change a command makes. Port and SVI changes carry the whole new configuration of that port or SVI. */
export type NetChange =
  | { readonly op: "vlan"; readonly id: number; readonly name: string | null }
  | { readonly op: "port"; readonly port: number; readonly cfg: PortCfg }
  | { readonly op: "svi"; readonly vlan: number; readonly cfg: SviCfg | null }
  | { readonly op: "route"; readonly route: RouteCfg; readonly remove: boolean }
  | { readonly op: "bgp"; readonly neighbor: string; readonly shut: boolean };

export const routeKey = (r: RouteCfg): string => `${r.net}/${r.len}>${r.via}`;

/** Lays one change into a patch (a copy; the patch passed in is not touched). */
export function patchWith(patch: NetPatch | undefined, change: NetChange): NetPatch {
  const next: NetPatch = {
    ...(patch?.vlans ? { vlans: { ...patch.vlans } } : {}),
    ...(patch?.ports ? { ports: { ...patch.ports } } : {}),
    ...(patch?.svis ? { svis: { ...patch.svis } } : {}),
    ...(patch?.bgp ? { bgp: { ...patch.bgp } } : {}),
    ...(patch?.routes
      ? {
          routes: {
            ...(patch.routes.add ? { add: [...patch.routes.add] } : {}),
            ...(patch.routes.del ? { del: [...patch.routes.del] } : {}),
          },
        }
      : {}),
  };
  if (change.op === "vlan") next.vlans = { ...next.vlans, [change.id]: change.name };
  else if (change.op === "port") next.ports = { ...next.ports, [change.port]: change.cfg };
  else if (change.op === "svi") next.svis = { ...next.svis, [change.vlan]: change.cfg };
  else if (change.op === "bgp") changeBgp(next, change.neighbor, change.shut);
  else changeRoute(next, change.route, change.remove);
  return next;
}

function changeBgp(patch: NetPatch, neighbor: string, shut: boolean): void {
  const bgp = { ...patch.bgp };
  if (shut) bgp[neighbor] = true;
  else delete bgp[neighbor];
  if (Object.keys(bgp).length > 0) patch.bgp = bgp;
  else delete patch.bgp;
}

function changeRoute(patch: NetPatch, route: RouteCfg, remove: boolean): void {
  const key = routeKey(route);
  const routes = patch.routes ?? {};
  patch.routes = routes;
  const add = (routes.add ?? []).filter((r) => routeKey(r) !== key);
  const del = (routes.del ?? []).filter((k) => k !== key);
  // A route the operator added is simply dropped again; a designed one is remembered as removed.
  if (remove) {
    if ((routes.add ?? []).length === add.length) del.push(key);
  } else add.push(route);
  if (add.length > 0) routes.add = add;
  else delete routes.add;
  if (del.length > 0) routes.del = del;
  else delete routes.del;
}

const VLAN_DEFAULT_NAME = "default";

/** Lays a patch (number → value, `null` removes it) over a map. */
function layer<V>(
  base: ReadonlyMap<number, V>,
  patch: Readonly<Record<string, V | null>> | undefined,
): Map<number, V> {
  const out = new Map(base);
  for (const [id, value] of Object.entries(patch ?? {}))
    if (value === null) out.delete(Number(id));
    else out.set(Number(id), value);
  return out;
}

/** The design with an operator's patch laid over it. */
export function effectiveCfg(design: SwitchCfg, patch: NetPatch | undefined): SwitchCfg {
  if (!patch) return design;
  const vlans = layer(design.vlans, patch.vlans);
  if (!vlans.has(1)) vlans.set(1, VLAN_DEFAULT_NAME);
  const gone = new Set(patch.routes?.del ?? []);
  const routes = [
    ...design.routes.filter((r) => !gone.has(routeKey(r))),
    ...(patch.routes?.add ?? []),
  ];
  return {
    vlans,
    ports: layer(design.ports, patch.ports),
    svis: layer(design.svis, patch.svis),
    routes,
    bgpShut: new Set(Object.keys(patch.bgp ?? {})),
  };
}

/** Whether a port carries one VLAN: an access port its own, a trunk the VLANs on its allowed list. */
export function carries(
  cfg: PortCfg | undefined,
  vlan: number,
  known: ReadonlyMap<number, string>,
): boolean {
  if (!cfg || cfg.mode === "routed" || !known.has(vlan)) return false;
  if (cfg.mode === "access") return cfg.vlan === vlan;
  return cfg.allowed === "all" || cfg.allowed.includes(vlan);
}
