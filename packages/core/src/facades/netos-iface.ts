/**
 * Interface commands of the switch operating systems (REQ-062, ADR-0059): `show interfaces status`,
 * `show interfaces <name>` and `show interfaces description`, in each OS's table layout and, where the OS
 * has one, its JSON. Traffic counters and error counts are not modelled by the world, so they are left
 * out rather than made up.
 */
import { macOf, type PortView, type Result, type SwitchView } from "./netos-model";

type State = "connected" | "notconnect" | "disabled" | "sfpAbsent";

/** The state word of `show interfaces status`. */
export function stateOf(v: SwitchView, p: PortView): State {
  if (p.shut) return "disabled";
  if (p.up) return "connected";
  if (!p.linkId && v.os === "nxos") return "sfpAbsent";
  return "notconnect";
}

/** The Vlan column of `show interfaces status`: the access VLAN, `trunk` or `routed`. */
const vlanText = (p: PortView): string =>
  p.cfg.mode === "access" ? String(p.cfg.vlan) : p.cfg.mode === "trunk" ? "trunk" : "routed";

const gbpsText = (gbps: number): string => (gbps >= 1 ? `${gbps}G` : `${gbps * 1000}M`);

function speedText(v: SwitchView, p: PortView): string {
  if (v.os === "eos") return gbpsText(v.speedGbps);
  if (!p.up) return "auto";
  if (v.os === "nxos")
    return v.speedGbps >= 10 ? gbpsText(v.speedGbps) : String(v.speedGbps * 1000);
  return v.speedGbps >= 10 ? gbpsText(v.speedGbps) : `a-${v.speedGbps * 1000}`;
}

function typeText(v: SwitchView, p: PortView): string {
  const present = p.linkId !== undefined;
  const g = v.speedGbps;
  if (v.os === "eos") return present ? (g > 1 ? `${g}GBASE-SR` : "1000BASE-T") : "Not Present";
  if (v.os === "nxos") return present ? (g > 1 ? `${g}Gbase-SR` : "1000base-T") : "--";
  return g > 1 ? `SFP-${g}GBase-SR` : "10/100/1000BaseTX";
}

const duplexText = (v: SwitchView, p: PortView): string =>
  p.up || v.os === "eos" ? (v.os === "iosxe" ? "a-full" : "full") : "auto";

const row = (cells: ReadonlyArray<readonly [string, number]>): string =>
  cells
    .map(([text, width]) => text.padEnd(width))
    .join("")
    .trimEnd();

const FULL_LINE = "-".repeat(80);

function statusRows(v: SwitchView, ports: readonly PortView[]): string[] {
  const nameW = Math.max(6, ...ports.map((p) => p.description.length)) + 1;
  const name = (p: PortView): string => p.description;
  if (v.os === "eos")
    return [
      row([
        ["Port", 11],
        ["Name", nameW],
        ["Status", 13],
        ["Vlan", 9],
        ["Duplex", 7],
        ["Speed", 7],
        ["Type", 16],
        ["Flags Encapsulation", 0],
      ]),
      ...ports.map((p) =>
        row([
          [p.short, 11],
          [name(p), nameW],
          [stateOf(v, p), 13],
          [vlanText(p), 9],
          [duplexText(v, p), 7],
          [speedText(v, p), 7],
          [typeText(v, p), 0],
        ]),
      ),
    ];
  if (v.os === "nxos")
    return [
      FULL_LINE,
      row([
        ["Port", 14],
        ["Name", 19],
        ["Status", 10],
        ["Vlan", 10],
        ["Duplex", 8],
        ["Speed", 8],
        ["Type", 0],
      ]),
      FULL_LINE,
      ...ports.map((p) =>
        row([
          [p.short, 14],
          [name(p) || "--", 19],
          [stateOf(v, p), 10],
          [vlanText(p), 10],
          [duplexText(v, p), 8],
          [speedText(v, p), 8],
          [typeText(v, p), 0],
        ]),
      ),
    ];
  return [
    row([
      ["Port", 10],
      ["Name", 19],
      ["Status", 13],
      ["Vlan", 11],
      ["Duplex", 8],
      ["Speed", 7],
      ["Type", 0],
    ]),
    ...ports.map((p) =>
      row([
        [p.short, 10],
        [name(p), 19],
        [stateOf(v, p), 13],
        [vlanText(p), 11],
        [duplexText(v, p), 8],
        [speedText(v, p), 7],
        [typeText(v, p), 0],
      ]),
    ),
  ];
}

export const nxRows = (rows: readonly object[]): object =>
  rows.length === 1 ? (rows[0] as object) : rows;

function statusData(
  v: SwitchView,
  ports: readonly PortView[],
): Record<string, unknown> | undefined {
  if (v.os === "eos")
    return {
      interfaceStatuses: Object.fromEntries(
        ports.map((p) => [
          p.name,
          {
            linkStatus: stateOf(v, p),
            description: p.description,
            vlanInformation: {
              interfaceMode: p.cfg.mode === "routed" ? "routed" : "bridged",
              vlanId:
                p.cfg.mode === "access" ? p.cfg.vlan : p.cfg.mode === "trunk" ? p.cfg.native : 0,
              interfaceForwardingModel: p.cfg.mode === "routed" ? "routed" : "bridged",
            },
            bandwidth: v.speedGbps * 1e9,
            interfaceType: typeText(v, p),
            autoNegotiateActive: false,
            duplex: "duplexFull",
            lineProtocolStatus: p.up ? "up" : "down",
          },
        ]),
      ),
    };
  if (v.os === "nxos")
    return {
      TABLE_interface: {
        ROW_interface: nxRows(
          ports.map((p) => ({
            interface: p.name,
            ...(p.description ? { name: p.description } : {}),
            state: stateOf(v, p),
            vlan: vlanText(p),
            duplex: duplexText(v, p),
            speed: speedText(v, p),
            type: typeText(v, p),
          })),
        ),
      },
    };
  return undefined;
}

export function interfaceStatus(v: SwitchView, only?: PortView): Result {
  const ports = only ? [only] : v.ports;
  const data = statusData(v, ports);
  return { text: statusRows(v, ports).join("\n"), ...(data ? { data } : {}) };
}

function headline(v: SwitchView, p: PortView): string {
  const word = stateOf(v, p);
  if (v.os === "nxos") {
    const reason = p.shut ? " (Administratively down)" : p.up ? "" : " (Link not connected)";
    return `${p.name} is ${p.up ? "up" : "down"}${reason}\nadmin state is ${p.shut ? "down" : "up"}, Dedicated Interface`;
  }
  const line = p.up ? "up" : v.os === "eos" ? "notpresent" : "down";
  return `${p.name} is ${p.shut ? "administratively down" : p.up ? "up" : "down"}, line protocol is ${line} (${word})`;
}

function detailText(v: SwitchView, p: PortView): string {
  const kbit = v.speedGbps * 1e6;
  const duplex = p.up
    ? `Full-duplex, ${gbpsText(v.speedGbps).replace("G", "Gb/s")}`
    : "Auto-duplex";
  const address = macOf(v.entity.id, p.n);
  const description = p.description ? [`  Description: ${p.description}`] : [];
  if (v.os === "nxos")
    return [
      headline(v, p),
      `  Hardware: ${v.speedGbps >= 10 ? "10000/25000" : "1000"} Ethernet, address: ${address} (bia ${address})`,
      ...description,
      `  MTU 1500 bytes, BW ${kbit} Kbit , DLY 10 usec`,
      "  reliability 255/255, txload 1/255, rxload 1/255",
      "  Encapsulation ARPA, medium is broadcast",
      "  Port mode is access",
      `  ${p.up ? `full-duplex, ${v.speedGbps} Gb/s` : "auto-duplex, auto-speed"}`,
    ].join("\n");
  if (v.os === "eos")
    return [
      headline(v, p),
      `  Hardware is Ethernet, address is ${address} (bia ${address})`,
      ...description,
      `  Ethernet MTU 9214 bytes , BW ${kbit} kbit`,
      `  ${duplex}, auto negotiation: off, uni-link: n/a`,
      "  Loopback Mode : None",
    ].join("\n");
  return [
    `${headline(v, p)} `,
    `  Hardware is Gigabit Ethernet, address is ${address} (bia ${address})`,
    ...description,
    `  MTU 1500 bytes, BW ${kbit} Kbit/sec, DLY 10 usec, `,
    "  reliability 255/255, txload 1/255, rxload 1/255",
    "  Encapsulation ARPA, loopback not set",
    `  ${duplex}, media type is ${typeText(v, p)}`,
  ].join("\n");
}

function detailData(v: SwitchView, p: PortView): Record<string, unknown> | undefined {
  if (v.os === "eos")
    return {
      interfaces: {
        [p.name]: {
          name: p.name,
          forwardingModel: "bridged",
          lineProtocolStatus: p.up ? "up" : "notPresent",
          interfaceStatus: stateOf(v, p),
          hardware: "ethernet",
          bandwidth: v.speedGbps * 1e9,
          mtu: 9214,
          description: p.description,
          duplex: p.up ? "duplexFull" : "duplexUnknown",
          autoNegotiate: "off",
        },
      },
    };
  if (v.os === "nxos")
    return {
      TABLE_interface: {
        ROW_interface: {
          interface: p.name,
          state: p.up ? "up" : "down",
          ...(p.up
            ? {}
            : { state_rsn_desc: p.shut ? "Administratively down" : "Link not connected" }),
          admin_state: p.shut ? "down" : "up",
          ...(p.description ? { desc: p.description } : {}),
          eth_mtu: "1500",
          eth_bw: String(v.speedGbps * 1e6),
          eth_mode: "access",
        },
      },
    };
  return undefined;
}

/** `show interfaces <name>` (one port), or every port when none is named. */
export function interfaceDetail(v: SwitchView, only?: PortView): Result {
  const ports = only ? [only] : v.ports;
  const data = only ? detailData(v, only) : undefined;
  return { text: ports.map((p) => detailText(v, p)).join("\n"), ...(data ? { data } : {}) };
}

export function interfaceDescription(v: SwitchView): Result {
  const word = (p: PortView): [string, string] => [
    p.shut ? "admin down" : p.up ? "up" : "down",
    p.up ? "up" : v.os === "eos" ? "notpresent" : "down",
  ];
  if (v.os === "nxos")
    return {
      text: [
        FULL_LINE,
        row([
          ["Interface", 25],
          ["Description", 0],
        ]),
        FULL_LINE,
        ...v.ports.map((p) =>
          row([
            [p.short, 25],
            [p.description || "--", 0],
          ]),
        ),
      ].join("\n"),
    };
  const header =
    v.os === "eos"
      ? row([
          ["Interface", 31],
          ["Status", 15],
          ["Protocol", 19],
          ["Description", 0],
        ])
      : row([
          ["Interface", 31],
          ["Status", 15],
          ["Protocol", 9],
          ["Description", 0],
        ]);
  const protoW = v.os === "eos" ? 19 : 9;
  return {
    text: [
      header,
      ...v.ports.map((p) =>
        row([
          [p.short, 31],
          [word(p)[0], 15],
          [word(p)[1], protoW],
          [p.description, 0],
        ]),
      ),
    ].join("\n"),
  };
}
