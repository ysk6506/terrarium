/**
 * The routing table of the switch operating systems (REQ-064, ADR-0061, REQ-065, ADR-0062), in each OS's layout
 * and, where the OS has one, its JSON. A table holds the connected networks of the interfaces that are up,
 * the static routes whose next hop can be reached, and the routes a cloud fabric learns over BGP while the
 * session they came by is established. A route whose next hop is down is not installed, as on the devices.
 * Routes of equal cost to one prefix print as one entry with several next hops.
 */
import {
  type Iface,
  intToIp,
  ipToInt,
  type NetModel,
  networkOf,
  resolveRoute,
} from "@terrarium/core/world";
import { nxRows } from "./netos-iface";
import { ifaceName, shortName } from "./netos-l3";
import type { Result, SwitchView } from "./netos-model";

export interface RouteRow {
  readonly code: "C" | "L" | "S" | "B";
  readonly net: number;
  readonly len: number;
  readonly via?: number;
  readonly out: Iface;
}

/** Every route of the switch's table, lowest network first. */
export function routeRows(v: SwitchView, model: NetModel): RouteRow[] {
  const sw = v.entity.id;
  const rows: RouteRow[] = [];
  for (const iface of model.ifacesOf(sw)) {
    if (iface.real) continue;
    rows.push({ code: "C", net: networkOf(iface.ip, iface.len), len: iface.len, out: iface });
    rows.push({ code: "L", net: iface.ip, len: 32, out: iface });
  }
  for (const route of model.cfg(sw).routes) {
    const via = ipToInt(route.via);
    const hop = via === undefined ? undefined : resolveRoute(model, sw, route);
    if (hop && via !== undefined)
      rows.push({
        code: route.proto === "bgp" ? "B" : "S",
        net: ipToInt(route.net) ?? 0,
        len: route.len,
        via,
        out: hop.egress,
      });
  }
  return rows.sort((a, b) => a.net - b.net || a.len - b.len || (a.code < b.code ? -1 : 1));
}

/** One prefix of the table with the next hops it has (several when equal routes were learned or typed). */
interface Entry {
  readonly code: RouteRow["code"];
  readonly net: number;
  readonly len: number;
  readonly hops: readonly RouteRow[];
}

const prefix = (e: Entry): string => `${intToIp(e.net)}/${e.len}`;

/** Merges the next hops of one prefix and protocol into one entry, keeping the table's order. */
function entriesOf(rows: readonly RouteRow[]): Entry[] {
  const out: Array<{ code: RouteRow["code"]; net: number; len: number; hops: RouteRow[] }> = [];
  for (const r of rows) {
    const same =
      r.code === "S" || r.code === "B"
        ? out.find((e) => e.code === r.code && e.net === r.net && e.len === r.len)
        : undefined;
    if (same) same.hops.push(r);
    else out.push({ code: r.code, net: r.net, len: r.len, hops: [r] });
  }
  return out;
}

const hopIp = (r: RouteRow): string => intToIp(r.via ?? 0);

/** Where a BGP route came from: the AS of the neighbor it was learned from. */
function remoteAs(model: NetModel, sw: string, hop: RouteRow): number {
  return model.bgp(sw)?.neighbors.find((n) => n.ip === hopIp(hop))?.remoteAs ?? 0;
}

// ── Arista EOS ───────────────────────────────────────────────────────────────────────────────────

const EOS_CODE = { C: " C        ", S: " S        ", B: " B E      ", L: " L        " } as const;
const EOS_PREF = { C: 0, S: 1, B: 200, L: 0 } as const;

function eosLines(v: SwitchView, e: Entry): string[] {
  const first = e.hops[0] as RouteRow;
  if (e.code === "C" || e.code === "L")
    return [`${EOS_CODE[e.code]}${prefix(e)} is directly connected, ${ifaceName(v, first.out)}`];
  const metric = `[${EOS_PREF[e.code]}/0]`;
  const vias = e.hops.map((h) => `via ${hopIp(h)}, ${ifaceName(v, h.out)}`);
  if (vias.length === 1) return [`${EOS_CODE[e.code]}${prefix(e)} ${metric} ${vias[0]}`];
  return [`${EOS_CODE[e.code]}${prefix(e)} ${metric}`, ...vias.map((x) => `${" ".repeat(11)}${x}`)];
}

const EOS_TYPE = { C: "connected", S: "static", B: "eBGP", L: "connected" } as const;

function eosJson(
  v: SwitchView,
  entries: readonly Entry[],
  dflt: Entry | undefined,
): Record<string, unknown> {
  const routes = Object.fromEntries(
    entries.map((e) => [
      prefix(e),
      {
        hardwareProgrammed: true,
        routeType: EOS_TYPE[e.code],
        routeLeaked: false,
        kernelProgrammed: true,
        directlyConnected: e.code === "C",
        preference: EOS_PREF[e.code],
        metric: 0,
        vias: e.hops.map((h) =>
          e.code === "C"
            ? { interface: ifaceName(v, h.out) }
            : { nexthopAddr: hopIp(h), interface: ifaceName(v, h.out) },
        ),
      },
    ]),
  );
  return {
    vrfs: {
      default: {
        routingDisabled: false,
        allRoutesProgrammedHardware: true,
        allRoutesProgrammedKernel: true,
        defaultRouteState: dflt ? "reachable" : "notSet",
        routes,
      },
    },
  };
}

function eosRoutes(v: SwitchView, rows: readonly RouteRow[]): Result {
  const entries = entriesOf(rows.filter((r) => r.code !== "L"));
  const dflt = entries.find((e) => e.code !== "C" && e.len === 0);
  const gateway = dflt
    ? `Gateway of last resort:\n${eosLines(v, dflt).join("\n")}`
    : "Gateway of last resort is not set";
  return {
    text: [
      "VRF: default",
      "Codes: C - connected, S - static, K - kernel,",
      "       O - OSPF, IA - OSPF inter area, E1 - OSPF external type 1,",
      "       E2 - OSPF external type 2, B - Other BGP Routes,",
      "       B I - iBGP, B E - eBGP",
      "",
      gateway,
      "",
      ...entries.filter((e) => e !== dflt).flatMap((e) => eosLines(v, e)),
    ].join("\n"),
    data: eosJson(v, entries, dflt),
  };
}

// ── Cisco NX-OS ──────────────────────────────────────────────────────────────────────────────────

const NX_KIND = { C: "direct", S: "static", B: "bgp", L: "local" } as const;
const NX_PREF = { C: 0, S: 1, B: 20, L: 0 } as const;

/** `bgp-<local AS>` and the neighbor's AS, as the table tags a route learned over BGP. */
function nxClient(model: NetModel, sw: string, e: Entry, hop: RouteRow): string {
  if (e.code !== "B") return NX_KIND[e.code];
  return `bgp-${model.bgp(sw)?.asn ?? 0}, external, tag ${remoteAs(model, sw, hop)}`;
}

function nxVia(v: SwitchView, model: NetModel, e: Entry, h: RouteRow): string {
  const client = nxClient(model, v.entity.id, e, h);
  if (e.code === "S" || e.code === "B")
    return `    *via ${hopIp(h)}, [${NX_PREF[e.code]}/0], 00:10:00, ${client}`;
  return `    *via ${intToIp(h.out.ip)}, ${shortName(v, h.out)}, [0/0], 00:10:00, ${client}`;
}

function nxosEntry(v: SwitchView, model: NetModel, e: Entry): { lines: string[]; json: object } {
  const attached = e.code === "C" || e.code === "L";
  const head = `${prefix(e)}, ubest/mbest: ${e.hops.length}/0${attached ? ", attached" : ""}`;
  const paths = e.hops.map((h) => ({
    ipnexthop: attached ? intToIp(h.out.ip) : hopIp(h),
    ifname: shortName(v, h.out),
    uptime: "PT10M",
    pref: String(NX_PREF[e.code]),
    metric: "0",
    clientname:
      NX_KIND[e.code] === "bgp" ? `bgp-${model.bgp(v.entity.id)?.asn ?? 0}` : NX_KIND[e.code],
    ubest: "true",
  }));
  return {
    lines: [head, ...e.hops.map((h) => nxVia(v, model, e, h))],
    json: {
      ipprefix: prefix(e),
      "ucast-nhops": String(e.hops.length),
      "mcast-nhops": "0",
      attached: attached ? "true" : "false",
      TABLE_path: { ROW_path: nxRows(paths) },
    },
  };
}

function nxosRoutes(v: SwitchView, model: NetModel, rows: readonly RouteRow[]): Result {
  const built = entriesOf(rows).map((e) => nxosEntry(v, model, e));
  return {
    text: [
      'IP Route Table for VRF "default"',
      "'*' denotes best ucast next-hop",
      "'**' denotes best mcast next-hop",
      "'[x/y]' denotes [preference/metric]",
      "'%<string>' in via output denotes VRF <string>",
      "",
      ...built.flatMap((b) => b.lines),
    ].join("\n"),
    data: {
      TABLE_vrf: {
        ROW_vrf: {
          "vrf-name-out": "default",
          TABLE_addrf: {
            ROW_addrf: {
              addrf: "ipv4",
              TABLE_prefix: { ROW_prefix: nxRows(built.map((b) => b.json)) },
            },
          },
        },
      },
    },
  };
}

// ── Cisco IOS XE ─────────────────────────────────────────────────────────────────────────────────

function iosLines(v: SwitchView, e: Entry, dflt: Entry | undefined): string[] {
  const first = e.hops[0] as RouteRow;
  if (e.code === "C" || e.code === "L")
    return [`${e.code}        ${prefix(e)} is directly connected, ${ifaceName(v, first.out)}`];
  const star = e === dflt ? "*" : " ";
  const [metric, uptime] = e.code === "B" ? ["[20/0]", ", 00:10:00"] : ["[1/0]", ""];
  const head = `${e.code}${star}       ${prefix(e)} `;
  return e.hops.map((h, i) =>
    i === 0
      ? `${head}${metric} via ${hopIp(h)}${uptime}`
      : `${" ".repeat(head.length)}${metric} via ${hopIp(h)}${uptime}`,
  );
}

function iosRoutes(v: SwitchView, rows: readonly RouteRow[]): Result {
  const entries = entriesOf(rows);
  const dflt = entries.find((e) => (e.code === "S" || e.code === "B") && e.len === 0);
  const first = dflt?.hops[0];
  return {
    text: [
      "Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP",
      "       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area",
      "       * - candidate default, U - per-user static route, o - ODR",
      "",
      first
        ? `Gateway of last resort is ${hopIp(first)} to network 0.0.0.0`
        : "Gateway of last resort is not set",
      "",
      ...entries.flatMap((e) => iosLines(v, e, dflt)),
    ].join("\n"),
  };
}

export function showIpRoute(v: SwitchView, model: NetModel): Result {
  const rows = routeRows(v, model);
  return v.os === "eos"
    ? eosRoutes(v, rows)
    : v.os === "nxos"
      ? nxosRoutes(v, model, rows)
      : iosRoutes(v, rows);
}
