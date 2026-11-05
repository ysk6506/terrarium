/**
 * Layer-3 show commands of the switch operating systems (REQ-064, ADR-0061): the ARP table and the IP
 * interface summary, in each OS's layout and, where the OS has one, its JSON. (The routing table is in
 * netos-routes.ts.)
 */
import {
  hostIsUp,
  type Iface,
  intToIp,
  ipToInt,
  macOf,
  type NetModel,
  networkOf,
  type WorldReader,
} from "@terrarium/core/world";
import { nxRows } from "./netos-iface";
import type { PortView, Result, SwitchView } from "./netos-model";

const pad = (text: string, width: number): string => text.padEnd(width);

/** The name an OS gives an interface of the switch: `Vlan100`, or the port's own name. */
export function ifaceName(v: SwitchView, iface: Iface): string {
  if (iface.kind === "svi") return `Vlan${iface.vlan}`;
  const port = v.ports[(iface.port ?? 1) - 1];
  return port?.name ?? `port${iface.port}`;
}

/** The short form routing tables use (`Eth1/2`, `Et2`, `Gi1/0/2`). */
export function shortName(v: SwitchView, iface: Iface): string {
  return iface.kind === "svi" ? `Vlan${iface.vlan}` : (v.ports[(iface.port ?? 1) - 1]?.short ?? "");
}

export interface ArpRow {
  readonly ip: number;
  readonly mac: string;
  readonly iface: Iface;
  /** The port the address was learned on; undefined for the switch's own address. */
  readonly port?: PortView;
}

/** The switches on the same segment as an interface, and their addresses. */
function neighbourRows(v: SwitchView, model: NetModel, iface: Iface): ArpRow[] {
  const sw = v.entity.id;
  return model
    .ifacesOn(iface.seg)
    .filter((other) => other.sw !== sw && !other.real)
    .map((other) => ({
      ip: other.ip,
      mac: macOf(other.sw),
      iface,
      ...learnedOn(v, model, iface, other.sw),
    }));
}

/** The servers that are on and in the subnet of one of this switch's VLAN interfaces. */
function serverRows(v: SwitchView, model: NetModel, world: WorldReader, iface: Iface): ArpRow[] {
  const sw = v.entity.id;
  const rows: ArpRow[] = [];
  if (iface.kind !== "svi" || iface.vlan === undefined) return rows;
  for (const node of model.reach(sw, iface.vlan))
    for (const { host, port } of model.hostsAt(node.sw, node.vlan)) {
      const ip = ipToInt(host.ip);
      if (ip === undefined || !hostIsUp(world, host)) continue;
      if (networkOf(ip, iface.len) !== networkOf(iface.ip, iface.len)) continue;
      const via = node.sw === sw ? v.ports[port - 1] : v.ports[node.port - 1];
      rows.push({ ip, mac: macOf(host.id, host.rail ?? 0), iface, ...(via ? { port: via } : {}) });
    }
  return rows;
}

/** The neighbours the switch can resolve on its interfaces that are up: servers that are on, and other switches. */
export function arpRows(v: SwitchView, model: NetModel, world: WorldReader): ArpRow[] {
  const sw = v.entity.id;
  const rows: ArpRow[] = [];
  for (const iface of model.ifacesOf(sw)) {
    if (iface.real) continue;
    if (v.os === "iosxe") rows.push({ ip: iface.ip, mac: macOf(sw), iface });
    rows.push(...neighbourRows(v, model, iface), ...serverRows(v, model, world, iface));
  }
  return rows.sort((a, b) => a.ip - b.ip);
}

function learnedOn(
  v: SwitchView,
  model: NetModel,
  iface: Iface,
  other: string,
): { port?: PortView } {
  if (iface.kind === "routed") {
    const port = iface.port === undefined ? undefined : v.ports[iface.port - 1];
    return port ? { port } : {};
  }
  const hop = model.reach(v.entity.id, iface.vlan ?? 1).find((n) => n.sw === other);
  const port = hop && hop.port > 0 ? v.ports[hop.port - 1] : undefined;
  return port ? { port } : {};
}

export function showIpArp(v: SwitchView, rows: readonly ArpRow[]): Result {
  const where = (r: ArpRow): string =>
    v.os === "eos" && r.port && r.iface.kind === "svi"
      ? `${ifaceName(v, r.iface)}, ${r.port.name}`
      : shortName(v, r.iface);
  if (v.os === "eos")
    return {
      text: [
        "Address         Age (sec)  Hardware Addr   Interface",
        ...rows.map(
          (r) => `${pad(intToIp(r.ip), 16)}${pad("0:00:12", 11)}${pad(r.mac, 16)}${where(r)}`,
        ),
      ].join("\n"),
      data: {
        dynamicEntries: rows.map((r) => ({
          hwAddress: r.mac,
          address: intToIp(r.ip),
          interface: where(r),
          age: 12,
        })),
        notLearnedEntries: [],
        totalEntries: rows.length,
        staticEntries: [],
      },
    };
  if (v.os === "nxos")
    return {
      text: [
        "Flags: * - Adjacencies learnt on non-active FHRP router",
        "       + - Adjacencies synced via CFSoE",
        "       # - Adjacencies Throttled for Glean",
        "       CP - Added via L2RIB, Control plane Adjacencies",
        "       PS - Added via L2RIB, Peer Sync",
        "       RO - Re-Originated Peer Sync Entry",
        "       D - Static Adjacencies attached to down interface",
        "",
        "IP ARP Table for context default",
        `Total number of entries: ${rows.length}`,
        "Address         Age       MAC Address     Interface        Flags",
        ...rows.map((r) =>
          `${pad(intToIp(r.ip), 16)}${pad("00:00:12", 10)}${pad(r.mac, 16)}${pad(where(r), 17)}`.trimEnd(),
        ),
      ].join("\n"),
      data: {
        TABLE_vrf: {
          ROW_vrf: {
            "vrf-name-out": "default",
            cnt_total: rows.length,
            TABLE_adj: {
              ROW_adj: nxRows(
                rows.map((r) => ({
                  "ip-addr-out": intToIp(r.ip),
                  "time-stamp": "00:00:12",
                  mac: r.mac,
                  "intf-out": where(r),
                })),
              ),
            },
          },
        },
      },
    };
  return {
    text: [
      "Protocol  Address          Age (min)  Hardware Addr   Type   Interface",
      ...rows.map(
        (r) =>
          `Internet  ${pad(intToIp(r.ip), 17)}${pad(r.port ? "0" : "-", 11)}${pad(r.mac, 16)}ARPA   ${ifaceName(v, r.iface)}`,
      ),
    ].join("\n"),
  };
}

interface AddrRow {
  readonly name: string;
  readonly short: string;
  readonly ip: string;
  readonly len: number;
  readonly shut: boolean;
  readonly live: boolean;
}

/** Every interface that has an address: routed ports first, then the VLAN interfaces by number. */
function addressedRows(v: SwitchView, model: NetModel): AddrRow[] {
  const sw = v.entity.id;
  const cfg = model.cfg(sw);
  const vlanIfaces = [...cfg.svis.keys()]
    .sort((a, b) => a - b)
    .map((vlan): AddrRow => {
      const svi = cfg.svis.get(vlan);
      const live = model.ifacesOf(sw).some((i) => i.kind === "svi" && i.vlan === vlan && !i.real);
      return {
        name: `Vlan${vlan}`,
        short: `Vlan${vlan}`,
        ip: svi?.ip ?? "",
        len: svi?.len ?? 0,
        shut: svi?.shut ?? false,
        live,
      };
    });
  const routed = v.ports.flatMap((p): AddrRow[] =>
    p.cfg.mode === "routed" && p.cfg.ip !== undefined
      ? [
          {
            name: p.name,
            short: p.short,
            ip: p.cfg.ip,
            len: p.cfg.len ?? 0,
            shut: p.shut,
            live: p.up,
          },
        ]
      : [],
  );
  return [...routed, ...vlanIfaces];
}

const state = (r: AddrRow): string => (r.live ? "up" : "down");

function briefIos(v: SwitchView, rows: readonly AddrRow[]): Result {
  const addressed = new Set(rows.map((r) => r.name));
  const plain = v.ports
    .filter((p) => !addressed.has(p.name))
    .map((p) => ({ name: p.name, ip: "unassigned", shut: p.shut, live: p.up, method: "unset" }));
  const all = [...plain, ...rows.map((r) => ({ ...r, method: "manual" }))];
  return {
    text: [
      "Interface              IP-Address      OK? Method Status                Protocol",
      ...all.map((r) => {
        const status = r.shut ? "administratively down" : r.live ? "up" : "down";
        return `${pad(r.name, 23)}${pad(r.ip, 16)}${pad("YES", 4)}${pad(r.method, 7)}${pad(status, 22)}${r.live ? "up" : "down"}`;
      }),
    ].join("\n"),
  };
}

function briefNxos(rows: readonly AddrRow[]): Result {
  return {
    text: [
      'IP Interface Status for VRF "default"(1)',
      "Interface            IP Address      Interface Status",
      ...rows.map(
        (r) =>
          `${pad(r.short, 21)}${pad(r.ip, 16)}protocol-${state(r)}/link-${state(r)}/admin-${r.shut ? "down" : "up"}`,
      ),
    ].join("\n"),
  };
}

function briefEos(rows: readonly AddrRow[]): Result {
  const line = (r: AddrRow): string =>
    `${pad(r.name, 18)}${pad(`${r.ip}/${r.len}`, 19)}${pad(r.shut ? "down" : state(r), 13)}${pad(r.live ? "up" : "lowerlayerdown", 15)}${pad("1500", 11)}`.trimEnd();
  return {
    text: [
      "                                                                  Address",
      "Interface         IP Address         Status       Protocol            MTU Owner",
      "----------------- ------------------ ------------ -------------- ---------- -------",
      ...rows.map(line),
    ].join("\n"),
    data: {
      interfaces: Object.fromEntries(
        rows.map((r) => [
          r.name,
          {
            name: r.name,
            interfaceStatus: r.shut ? "adminDown" : r.live ? "connected" : "notconnect",
            lineProtocolStatus: state(r),
            mtu: 1500,
            interfaceAddress: { ipAddr: { address: r.ip, maskLen: r.len } },
          },
        ]),
      ),
    },
  };
}

/** `show ip interface brief`: every interface that has an address, with its state. */
export function showIpInterfaceBrief(v: SwitchView, model: NetModel): Result {
  const rows = addressedRows(v, model);
  if (v.os === "iosxe") return briefIos(v, rows);
  return v.os === "nxos" ? briefNxos(rows) : briefEos(rows);
}
