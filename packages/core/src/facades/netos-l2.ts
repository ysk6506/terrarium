/**
 * Layer-2 show commands of the switch operating systems (REQ-064, ADR-0061): the VLAN table, the MAC address
 * table and the trunk summary, in each OS's layout and, where the OS has one, its JSON. The MAC table is the
 * steady state: every server that is on and in a VLAN's segment is learned on the port that leads to it.
 * Aging, moves and counters are not modelled.
 */
import { carries, hostIsUp, macOf, type NetModel, type WorldReader } from "@terrarium/core/world";
import type { PortView, Result, SwitchView } from "./netos-model";

const pad = (text: string, width: number): string => text.padEnd(width);

/** Ports wrapped at a column width, the way the VLAN tables continue a long list on the next line. */
function wrapPorts(ports: readonly string[], width: number, indent: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const p of ports) {
    const next = line === "" ? p : `${line}, ${p}`;
    if (next.length > width && line !== "") {
      lines.push(`${line},`);
      line = p;
    } else line = next;
  }
  lines.push(line);
  return lines.map((l, i) => (i === 0 ? l : `${" ".repeat(indent)}${l}`));
}

interface VlanRow {
  readonly id: number;
  readonly name: string;
  readonly ports: readonly PortView[];
  readonly svi: boolean;
}

/** The VLANs of a switch with the ports that belong to each (an IOS XE access list leaves trunks out). */
export function vlanRows(v: SwitchView, model: NetModel): VlanRow[] {
  const cfg = model.cfg(v.entity.id);
  return [...cfg.vlans]
    .sort((a, b) => a[0] - b[0])
    .map(([id, name]) => ({
      id,
      name,
      svi: cfg.svis.has(id),
      ports: v.ports.filter((p) => {
        const port = model.portCfg(v.entity.id, p.n);
        return v.os === "iosxe"
          ? port.mode === "access" && port.vlan === id
          : carries(port, id, cfg.vlans);
      }),
    }));
}

export function showVlan(v: SwitchView, model: NetModel): Result {
  const rows = vlanRows(v, model);
  const eos = v.os === "eos";
  const idW = eos ? 6 : 5;
  const head = `${pad("VLAN", idW)}${pad("Name", 33)}${pad("Status", 10)}Ports`;
  const rule = `${"-".repeat(idW - 1)} ${"-".repeat(32)} ${"-".repeat(9)} ${"-".repeat(31)}`;
  const lines = rows.map((r) => {
    const names = [...(eos && r.svi ? ["Cpu"] : []), ...r.ports.map((p) => p.short)];
    const [first = "", ...rest] = wrapPorts(names, 31, idW + 33 + 10);
    return [
      `${pad(String(r.id), idW)}${pad(r.name, 33)}${pad("active", 10)}${first}`,
      ...rest,
    ].join("\n");
  });
  const text = [head, rule, ...lines].join("\n");
  if (eos)
    return {
      text,
      data: {
        vlans: Object.fromEntries(
          rows.map((r) => [
            String(r.id),
            {
              name: r.name,
              dynamic: false,
              status: "active",
              interfaces: Object.fromEntries(
                r.ports.map((p) => [p.name, { privatePortState: false }]),
              ),
            },
          ]),
        ),
        sourceDetail: "",
      },
    };
  if (v.os === "nxos")
    return {
      text,
      data: {
        TABLE_vlanbriefxbrief: {
          ROW_vlanbriefxbrief: rows.map((r) => ({
            "vlanshowbr-vlanid": String(r.id),
            "vlanshowbr-vlanid-utf": String(r.id),
            "vlanshowbr-vlanname": r.name,
            "vlanshowbr-vlanstate": "active",
            "vlanshowbr-shutstate": "noshutdown",
            ...(r.ports.length > 0
              ? { "vlanshowplist-ifidx": r.ports.map((p) => p.short).join(",") }
              : {}),
          })),
        },
      },
    };
  return { text };
}

/** One learned address: which VLAN, which MAC, and the port to reach it by. */
export interface MacRow {
  readonly vlan: number;
  readonly mac: string;
  readonly port: PortView;
}

/** What the switch learns from one place in a VLAN's segment: the servers that are on, and a switch's own address. */
function learnAt(
  v: SwitchView,
  model: NetModel,
  world: WorldReader,
  node: { sw: string; vlan: number; port: number },
  learn: (mac: string, port: PortView) => void,
): void {
  const sw = v.entity.id;
  const learned = node.port > 0 ? v.ports[node.port - 1] : undefined;
  for (const { host, port } of model.hostsAt(node.sw, node.vlan)) {
    const via = node.sw === sw ? v.ports[port - 1] : learned;
    if (via && hostIsUp(world, host)) learn(macOf(host.id, host.rail ?? 0), via);
  }
  if (learned && node.sw !== sw && model.ifacesOf(node.sw).some((i) => i.vlan === node.vlan))
    learn(macOf(node.sw), learned);
}

/** The addresses a switch has learned, in VLAN then MAC order. */
export function macRows(
  v: SwitchView,
  model: NetModel,
  world: WorldReader,
  only?: number,
): MacRow[] {
  const sw = v.entity.id;
  const rows = new Map<string, MacRow>();
  for (const vlan of model.cfg(sw).vlans.keys()) {
    if (only !== undefined && vlan !== only) continue;
    const learn = (mac: string, port: PortView): void => {
      rows.set(`${vlan}|${mac}`, { vlan, mac, port });
    };
    for (const node of model.reach(sw, vlan)) learnAt(v, model, world, node, learn);
  }
  return [...rows.values()].sort((a, b) => a.vlan - b.vlan || (a.mac < b.mac ? -1 : 1));
}

/** `0200.aaaa.bbbb` → `02:00:aa:aa:bb:bb`, how EOS writes it in JSON. */
const colonMac = (mac: string): string => mac.replace(/\./g, "").replace(/(..)(?=.)/g, "$1:");

const AGE = (mac: string): string =>
  `0:${String(parseInt(mac.slice(-4), 16) % 50).padStart(2, "0")}:12`;

export function showMacTable(v: SwitchView, rows: readonly MacRow[]): Result {
  const total = `Total Mac Addresses for this criterion: ${rows.length}`;
  if (v.os === "eos")
    return {
      text: [
        "          Mac Address Table",
        "------------------------------------------------------------------",
        "",
        "Vlan    Mac Address       Type        Ports      Moves   Last Move",
        "----    -----------       ----        -----      -----   ---------",
        ...rows.map(
          (r) =>
            `${String(r.vlan).padStart(4)}    ${pad(r.mac, 18)}${pad("DYNAMIC", 12)}${pad(r.port.short, 11)}${pad("1", 8)}${AGE(r.mac)} ago`,
        ),
        total,
      ].join("\n"),
      data: {
        multicastTable: { tableEntries: [] },
        unicastTable: {
          tableEntries: rows.map((r) => ({
            vlanId: r.vlan,
            macAddress: colonMac(r.mac),
            entryType: "dynamic",
            interface: r.port.name,
            moves: 1,
            lastMove: 1700000000,
          })),
        },
      },
    };
  if (v.os === "nxos")
    return {
      text: [
        "Legend: ",
        "        * - primary entry, G - Gateway MAC, (R) - Routed MAC, O - Overlay MAC",
        "        age - seconds since last seen,+ - primary entry using vPC Peer-Link,",
        "        (T) - True, (F) - False, C - ControlPlane MAC",
        "   VLAN     MAC Address      Type      age     Secure NTFY Ports",
        "---------+-----------------+--------+---------+------+----+------------------",
        ...rows.map(
          (r) =>
            `* ${pad(String(r.vlan), 8)} ${pad(r.mac, 16)} ${pad("dynamic", 8)} ${pad("0", 7)} ${pad("F", 6)} ${pad("F", 4)} ${r.port.short}`,
        ),
      ].join("\n"),
      data: {
        TABLE_mac_address: {
          ROW_mac_address: rows.map((r) => ({
            disp_mac_addr: r.mac,
            entry_type: "*",
            disp_vlan: String(r.vlan),
            disp_type: "dynamic",
            disp_age: "0",
            disp_is_secure: "F",
            disp_is_ntfy: "F",
            disp_port: r.port.short,
          })),
        },
      },
    };
  return {
    text: [
      "          Mac Address Table",
      "-------------------------------------------",
      "",
      "Vlan    Mac Address       Type        Ports",
      "----    -----------       --------    -----",
      ...rows.map(
        (r) =>
          `${String(r.vlan).padStart(4)}    ${pad(r.mac, 18)}${pad("DYNAMIC", 12)}${r.port.short}`,
      ),
      total,
    ].join("\n"),
  };
}

const allowedText = (port: PortView): string => {
  const cfg = port.cfg;
  if (cfg.mode !== "trunk") return "";
  return cfg.allowed === "all" ? "1-4094" : compress(cfg.allowed);
};

/** `[1,100,101,102,200]` → `1,100-102,200`. */
export function compress(ids: readonly number[]): string {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (sorted[j + 1] === (sorted[j] as number) + 1) j++;
    out.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return out.join(",") || "none";
}

export function showTrunk(v: SwitchView): Result {
  const trunks = v.ports.filter((p) => p.cfg.mode === "trunk");
  const native = (p: PortView): number => (p.cfg.mode === "trunk" ? p.cfg.native : 1);
  const status = (p: PortView): string => (p.up ? "trunking" : "not-trunking");
  const text = [
    `${pad("Port", 12)}${pad("Mode", 9)}${pad("Encapsulation", 15)}${pad("Status", 14)}Native vlan`,
    ...trunks.map(
      (p) =>
        `${pad(p.short, 12)}${pad("on", 9)}${pad("802.1q", 15)}${pad(status(p), 14)}${native(p)}`,
    ),
    "",
    `${pad("Port", 12)}Vlans allowed on trunk`,
    ...trunks.map((p) => `${pad(p.short, 12)}${allowedText(p)}`),
  ].join("\n");
  return { text };
}
