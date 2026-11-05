/**
 * System-level show commands of the switch operating systems (REQ-062, ADR-0059): version, hostname,
 * clock, LLDP neighbours, IP interface summary and the running configuration. The layouts follow what
 * each vendor's documentation shows; they were matched by hand, not diffed against a real device.
 */
import { lenToMask, type NetModel, type SviCfg } from "@terrarium/core/world";
import { SIM_EPOCH_MS } from "./http";
import { bgpConfigLines } from "./netos-bgp";
import { compress } from "./netos-l2";
import type { Memo, PortView, Result, SwitchView } from "./netos-model";

const SECONDS = { week: 604800, day: 86400, hour: 3600, minute: 60 } as const;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** `1 week, 2 days, 3 hours and 4 minutes`, the way each OS writes how long it has been up. */
function uptimeText(v: SwitchView): string {
  let rest = v.uptimeS;
  const take = (unit: number): number => {
    const n = Math.floor(rest / unit);
    rest -= n * unit;
    return n;
  };
  const [w, d, h] = [take(SECONDS.week), take(SECONDS.day), take(SECONDS.hour)];
  const m = take(SECONDS.minute);
  if (v.os === "nxos")
    return `${Math.floor(v.uptimeS / SECONDS.day)} day(s), ${h} hour(s), ${m} minute(s), ${rest} second(s)`;
  const parts = [
    ...(w > 0 ? [plural(w, "week")] : []),
    ...(w > 0 || d > 0 ? [plural(d, "day")] : []),
    plural(h, "hour"),
    plural(m, "minute"),
  ];
  return v.os === "eos" ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts.join(", ");
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number): string => String(n).padStart(2, "0");

export function clockText(v: SwitchView): string {
  const d = new Date(SIM_EPOCH_MS + v.uptimeS * 1000);
  const time = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
  const day = DAYS[d.getUTCDay()];
  const month = MONTHS[d.getUTCMonth()];
  if (v.os === "eos")
    return `${day} ${month} ${String(d.getUTCDate()).padStart(2, " ")} ${time} ${d.getUTCFullYear()}\nTimezone: UTC\nClock source: local`;
  if (v.os === "nxos")
    return `${time}.000 UTC ${day} ${month} ${String(d.getUTCDate()).padStart(2, " ")} ${d.getUTCFullYear()}`;
  return `*${time}.000 UTC ${day} ${month} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
}

export function showClock(v: SwitchView): Result {
  return { text: clockText(v) };
}

export function showHostname(v: SwitchView): Result {
  return v.os === "eos"
    ? {
        text: `Hostname: ${v.hostname}\nFQDN:     ${v.hostname}`,
        data: { hostname: v.hostname, fqdn: v.hostname },
      }
    : { text: v.hostname, data: { hostname: v.hostname } };
}

function eosVersion(v: SwitchView): Result {
  const p = v.profile;
  const text = [
    `${v.maker} ${v.model.name}`,
    "Hardware version:    01.00",
    `Serial number:       ${v.serial}`,
    `Hardware MAC address: ${v.mac}`,
    `System MAC address:  ${v.mac}`,
    "",
    `Software image version: ${p.release}`,
    "Architecture:           x86_64",
    `Internal build version: ${p.release}-0000000.${p.release.replace(/\./g, "").toLowerCase()}`,
    "Internal build ID:      00000000-0000-0000-0000-000000000000",
    "Image format version:   3.0",
    "Image optimization:     Default",
    "",
    `Uptime:                 ${uptimeText(v)}`,
    "Total memory:           8022704 kB",
    "Free memory:            5939056 kB",
  ].join("\n");
  const data = {
    mfgName: v.maker,
    modelName: v.model.name,
    hardwareRevision: "01.00",
    serialNumber: v.serial,
    systemMacAddress: v.mac,
    hwMacAddress: v.mac,
    version: p.release,
    architecture: "x86_64",
    imageFormatVersion: "3.0",
    imageOptimization: "Default",
    bootupTimestamp: SIM_EPOCH_MS / 1000,
    uptime: v.uptimeS,
    memTotal: 8022704,
    memFree: 5939056,
    isIntlVersion: false,
  };
  return { text, data };
}

function nxosVersion(v: SwitchView): Result {
  const p = v.profile;
  const dayCount = Math.floor(v.uptimeS / SECONDS.day);
  const rest = v.uptimeS - dayCount * SECONDS.day;
  const [h, m, s] = [Math.floor(rest / 3600), Math.floor((rest % 3600) / 60), rest % 60];
  const text = [
    "Cisco Nexus Operating System (NX-OS) Software",
    "TAC support: http://www.cisco.com/tac",
    "Software",
    "  BIOS: version 05.51",
    `  NXOS: version ${p.release}`,
    `  NXOS image file is: bootflash:///nxos64-cs.${p.release.replace(/[()]/g, ".").replace(/\.$/, "")}.M.bin`,
    "",
    "Hardware",
    `  ${v.maker} ${v.model.name} Chassis`,
    "  Intel(R) Xeon(R) CPU with 24569996 kB of memory.",
    `  Processor Board ID ${v.serial}`,
    "",
    `  Device name: ${v.hostname}`,
    "  bootflash:  115805708 kB",
    `Kernel uptime is ${uptimeText(v)}`,
    "",
    "plugin",
    "  Core Plugin, Ethernet Plugin",
  ].join("\n");
  const data = {
    header_str: "Cisco Nexus Operating System (NX-OS) Software",
    bios_ver_str: "05.51",
    nxos_ver_str: p.release,
    nxos_file_name: `bootflash:///nxos64-cs.${p.release}.M.bin`,
    chassis_id: `${v.maker} ${v.model.name} Chassis`,
    memory: 24569996,
    mem_type: "kB",
    proc_board_id: v.serial,
    host_name: v.hostname,
    bootflash_size: 115805708,
    kern_uptm_days: dayCount,
    kern_uptm_hrs: h,
    kern_uptm_mins: m,
    kern_uptm_secs: s,
    manufacturer: v.maker,
  };
  return { text, data };
}

function iosxeVersion(v: SwitchView): Result {
  const p = v.profile;
  return {
    text: [
      `Cisco IOS XE Software, Version ${p.release}`,
      `Cisco IOS Software, Catalyst L3 Switch Software, Version ${p.release}, RELEASE SOFTWARE`,
      "Technical Support: http://www.cisco.com/techsupport",
      "",
      `${v.hostname} uptime is ${uptimeText(v)}`,
      "System returned to ROM by Reload Command",
      `System image file is "flash:packages.conf"`,
      "",
      `${v.maker} ${v.model.name} processor with 1331381K/6147K bytes of memory.`,
      `Processor board ID ${v.serial}`,
      `${v.ports.length} ${v.speedGbps >= 10 ? `${v.speedGbps} Gigabit` : "Gigabit"} Ethernet interfaces`,
      "",
      "Configuration register is 0x102",
    ].join("\n"),
  };
}

export function showVersion(v: SwitchView): Result {
  return v.os === "eos" ? eosVersion(v) : v.os === "nxos" ? nxosVersion(v) : iosxeVersion(v);
}

const neighbours = (v: SwitchView): PortView[] => v.ports.filter((p) => p.up && p.peer);

export function showLldp(v: SwitchView): Result {
  const list = neighbours(v);
  if (v.os === "eos") {
    const rows = list.map(
      (p) =>
        `${p.short.padEnd(11)}${(p.peer?.name ?? "").padEnd(33)}${(p.peerPort ?? "").padEnd(27)}120`,
    );
    return {
      text: [
        "Last table change time   : 0:05:03 ago",
        `Number of table inserts  : ${list.length}`,
        "Number of table deletes  : 0",
        "Number of table drops    : 0",
        "Number of table age-outs : 0",
        "",
        "Port       Neighbor Device ID               Neighbor Port ID           TTL",
        "---------- -------------------------------- ------------------------- ---",
        ...rows,
      ].join("\n"),
      data: {
        lldpNeighbors: list.map((p) => ({
          port: p.name,
          neighborDevice: p.peer?.name,
          neighborPort: p.peerPort,
          ttl: 120,
        })),
      },
    };
  }
  const rows = list.map(
    (p) =>
      `${(p.peer?.name ?? "").padEnd(21)}${p.short.padEnd(15)}${"120".padEnd(11)}${"S".padEnd(12)}${p.peerPort ?? ""}`,
  );
  if (v.os === "nxos") {
    const one = (p: PortView) => ({
      chassis_id: p.peer?.name,
      l_port_id: p.short,
      port_id: p.peerPort,
      capability: "S",
      ttl: "120",
    });
    return {
      text: [
        "Capability codes:",
        "  (R) Router, (B) Bridge, (T) Telephone, (C) DOCSIS Cable Device",
        "  (W) WLAN Access Point, (P) Repeater, (S) Station, (O) Other",
        "Device ID            Local Intf      Hold-time  Capability  Port ID",
        ...rows,
        "",
        `Total entries displayed: ${list.length}`,
      ].join("\n"),
      data: {
        neigh_count: list.length,
        TABLE_nbor: {
          ROW_nbor: list.length === 1 ? one(list[0] as PortView) : list.map(one),
        },
      },
    };
  }
  return {
    text: [
      "Capability codes:",
      "    (R) Router, (B) Bridge, (T) Telephone, (C) DOCSIS Cable Device",
      "    (W) WLAN Access Point, (P) Repeater, (S) Station, (O) Other",
      "",
      "Device ID           Local Intf     Hold-time  Capability      Port ID",
      ...rows,
      "",
      `Total entries displayed: ${list.length}`,
    ].join("\n"),
  };
}

/** The address lines of a VLAN interface; a cloud leaf's gateway is an anycast one, the same on every leaf. */
function sviAddressLines(v: SwitchView, svi: SviCfg, pad: string): string[] {
  if (svi.ip === "0.0.0.0") return v.os === "iosxe" ? [`${pad}no ip address`] : [];
  const address = addressText(v, svi.ip, svi.len);
  if (svi.anycast !== true) return [`${pad}ip address ${address}`];
  if (v.os === "eos") return [`${pad}ip address virtual ${address}`];
  return v.os === "nxos"
    ? [`${pad}fabric forwarding mode anycast-gateway`, `${pad}ip address ${address}`]
    : [`${pad}ip address ${address}`];
}

function sviLines(v: SwitchView, model: NetModel, memo: Memo): string[] {
  const pad = v.os === "eos" ? "   " : v.os === "nxos" ? "  " : " ";
  return [...model.cfg(v.entity.id).svis]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([vlan, svi]) => {
      const alias = memo.get(`sviAlias.${vlan}`);
      return [
        `interface Vlan${vlan}`,
        ...(alias ? [`${pad}description ${alias}`] : []),
        ...(svi.shut ? [`${pad}shutdown`] : v.os === "nxos" ? [`${pad}no shutdown`] : []),
        ...sviAddressLines(v, svi, pad),
        ...(svi.virtual === undefined
          ? []
          : v.os === "eos"
            ? [`${pad}ip virtual-router address ${svi.virtual}`]
            : v.os === "nxos"
              ? [`${pad}hsrp 1`, `${pad}${pad}ip ${svi.virtual}`]
              : [`${pad}standby 1 ip ${svi.virtual}`]),
        "!",
      ];
    });
}

/** An address the way the OS writes it in a configuration: `10.0.0.2/24`, or with a mask on IOS XE. */
const addressText = (v: SwitchView, ip: string, len: number): string =>
  v.os === "iosxe" ? `${ip} ${lenToMask(len)}` : `${ip}/${len}`;

/** The lines that say how a port switches or routes. */
function portModeLines(v: SwitchView, pad: string, cfg: PortView["cfg"]): string[] {
  if (cfg.mode === "routed")
    return [
      `${pad}no switchport`,
      ...(cfg.ip === undefined ? [] : [`${pad}ip address ${addressText(v, cfg.ip, cfg.len ?? 0)}`]),
    ];
  if (cfg.mode === "access")
    return cfg.vlan === 1
      ? []
      : [
          `${pad}switchport access vlan ${cfg.vlan}`,
          ...(v.os === "eos" ? [] : [`${pad}switchport mode access`]),
        ];
  return [
    `${pad}switchport mode trunk`,
    ...(cfg.native === 1 ? [] : [`${pad}switchport trunk native vlan ${cfg.native}`]),
    ...(cfg.allowed === "all"
      ? []
      : [`${pad}switchport trunk allowed vlan ${compress(cfg.allowed)}`]),
  ];
}

function portLines(v: SwitchView, p: PortView): string[] {
  const pad = v.os === "eos" ? "   " : v.os === "nxos" ? "  " : " ";
  const lines = [`interface ${p.name}`];
  if (p.description) lines.push(`${pad}description ${p.description}`);
  if (p.shut) lines.push(`${pad}shutdown`);
  else if (v.os === "nxos") lines.push(`${pad}no shutdown`);
  return [...lines, ...portModeLines(v, pad, p.cfg)];
}

function vlanLines(model: NetModel, v: SwitchView): string[] {
  return [...model.cfg(v.entity.id).vlans]
    .filter(([id]) => id !== 1)
    .sort((a, b) => a[0] - b[0])
    .flatMap(([id, name]) => [
      `vlan ${id}`,
      `${v.os === "eos" ? "   " : v.os === "nxos" ? "  " : " "}name ${name}`,
      "!",
    ]);
}

function routeLines(model: NetModel, v: SwitchView): string[] {
  return model
    .cfg(v.entity.id)
    .routes.filter((r) => r.proto !== "bgp")
    .map((r) =>
      v.os === "iosxe"
        ? `ip route ${r.net} ${lenToMask(r.len)} ${r.via}`
        : `ip route ${r.net}/${r.len} ${r.via}`,
    );
}

/** The running configuration; with `only`, just that interface's section. */
export function runningConfig(v: SwitchView, model: NetModel, memo: Memo, only?: PortView): Result {
  const ports = only ? [only] : v.ports;
  const sep = v.os === "nxos" ? "" : "!";
  const sections = ports.map((p) => portLines(v, p).join("\n"));
  if (only) return { text: ["Building configuration...", "", ...sections].join("\n") };
  const head =
    v.os === "eos"
      ? [
          `! Command: show running-config`,
          `! device: ${v.hostname} (${v.model.name}, EOS-${v.profile.release})`,
          "!",
          `hostname ${v.hostname}`,
        ]
      : v.os === "nxos"
        ? [
            "!Command: show running-config",
            "",
            `version ${v.profile.release}`,
            `hostname ${v.hostname}`,
          ]
        : [
            "Building configuration...",
            "",
            `Current configuration : ${sections.join("\n").length} bytes`,
            "!",
            `version ${v.profile.release.replace(/a$/, "")}`,
            `hostname ${v.hostname}`,
          ];
  const routing = v.os === "nxos" ? [] : ["ip routing", sep];
  return {
    text: [
      ...head,
      sep,
      ...routing,
      ...vlanLines(model, v).map((l) => (l === "!" ? sep : l)),
      ...sections.flatMap((s) => [s, sep]),
      ...sviLines(v, model, memo).map((l) => (l === "!" ? sep : l)),
      ...routeLines(model, v),
      ...bgpConfigLines(v, model).map((l) => (l === "!" ? sep : l)),
      "end",
    ]
      .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
      .join("\n"),
  };
}
