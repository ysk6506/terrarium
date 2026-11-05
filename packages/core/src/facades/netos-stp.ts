/**
 * `show spanning-tree` of the switches of a legacy network (REQ-065, ADR-0062), in each OS's layout: EOS prints
 * its one MSTP instance, NX-OS and IOS XE one Rapid-PVST section per VLAN. The tree comes from the cables that
 * carry traffic now (net-stp.ts), so a root port moves when a cable is pulled. Timers are the defaults and path
 * costs are the OS's value for a 10G link per hop; a cloud fabric has no spanning tree.
 */
import {
  carries,
  macOf,
  type NetModel,
  type StpPort,
  type StpView,
  stpOf,
} from "@terrarium/core/world";
import type { Result, SwitchView } from "./netos-model";

const pad = (text: string | number, width: number): string => String(text).padEnd(width);

const NONE: Readonly<Record<SwitchView["os"], string>> = {
  eos: "No spanning tree instances exist.",
  nxos: "No spanning tree instance exists.",
  iosxe: "No spanning tree instance exists.",
};

/** A line of the interface table: a bridge port, or a port a server is plugged into. */
interface Line {
  readonly n: number;
  readonly role: StpPort["role"];
}

/** Ports to other switches that carry traffic, and the ports of servers that are up, with their role. */
function linesOf(v: SwitchView, model: NetModel, stp: StpView, vlan?: number): Line[] {
  const cfg = model.cfg(v.entity.id);
  const between = stp.ports.filter(
    (p) => vlan === undefined || carries(model.portCfg(v.entity.id, p.n), vlan, cfg.vlans),
  );
  const toSwitch = new Set(stp.ports.map((p) => p.n));
  const toServers = v.ports.filter((p) => {
    const port = model.portCfg(v.entity.id, p.n);
    const here = vlan === undefined || carries(port, vlan, cfg.vlans);
    return p.up && !toSwitch.has(p.n) && port.mode === "access" && here;
  });
  return [
    ...between.map((p) => ({ n: p.n, role: p.role })),
    ...toServers.map((p) => ({ n: p.n, role: "designated" as const })),
  ].sort((a, b) => a.n - b.n);
}

const ROLE = {
  eos: { root: "root", designated: "designated", alternate: "alternate" },
  pvst: { root: "Root", designated: "Desg", alternate: "Altn" },
} as const;

// ── Arista EOS: one MSTP instance ────────────────────────────────────────────────────────────────

const EOS_COST = 2000;

function eosText(v: SwitchView, stp: StpView, lines: readonly Line[]): string {
  const rootMac = macOf(stp.root);
  const rootPort = v.ports[(stp.rootPort ?? 1) - 1];
  const head = [
    "MST0",
    "   Spanning tree enabled protocol mstp",
    `   Root ID    Priority    ${stp.rootPriority}`,
    `              Address     ${rootMac}`,
    ...(stp.rootPort === undefined
      ? ["              This bridge is the root"]
      : [
          `              Cost        ${stp.cost * EOS_COST}`,
          `              Port        ${stp.rootPort} (${rootPort?.name ?? ""})`,
        ]),
    "              Hello Time  2.000 sec  Max Age 20 sec  Forward Delay 15 sec",
    "",
    `   Bridge ID  Priority    ${stp.priority}  (priority ${stp.priority} sys-id-ext 0)`,
    `              Address     ${v.mac}`,
    "              Hello Time  2.000 sec  Max Age 20 sec  Forward Delay 15 sec",
    "",
    "Interface        Role       State      Cost      Prio.Nbr Type",
    "---------------- ---------- ---------- --------- -------- -------------------",
  ];
  const rows = lines.map((l) => {
    const state = l.role === "alternate" ? "discarding" : "forwarding";
    const short = v.ports[l.n - 1]?.short ?? "";
    return `${pad(short, 16)} ${pad(ROLE.eos[l.role], 10)} ${pad(state, 10)} ${pad(EOS_COST, 9)} ${pad(`128.${l.n}`, 8)} P2p`;
  });
  return [...head, ...rows].join("\n");
}

// ── Cisco NX-OS and IOS XE: Rapid-PVST per VLAN ──────────────────────────────────────────────────

const PVST_COST = 2;

function pvstText(v: SwitchView, stp: StpView, vlan: number, lines: readonly Line[]): string {
  const nx = v.os === "nxos";
  const nbr = (n: number): number => (nx ? 128 + n : n);
  const rootPort = v.ports[(stp.rootPort ?? 1) - 1];
  const rootPortText = nx
    ? `${nbr(stp.rootPort ?? 0)} (${rootPort?.name})`
    : `${stp.rootPort} (${rootPort?.name})`;
  const head = [
    `VLAN${String(vlan).padStart(4, "0")}`,
    "  Spanning tree enabled protocol rstp",
    `  Root ID    Priority    ${stp.rootPriority + vlan}`,
    `             Address     ${macOf(stp.root)}`,
    ...(stp.rootPort === undefined
      ? ["             This bridge is the root"]
      : [
          `             Cost        ${stp.cost * PVST_COST}`,
          `             Port        ${rootPortText}`,
        ]),
    "             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec",
    "",
    `  Bridge ID  Priority    ${stp.priority + vlan}  (priority ${stp.priority} sys-id-ext ${vlan})`,
    `             Address     ${v.mac}`,
    "             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec",
    "             Aging Time  300 sec",
    "",
    "Interface        Role Sts Cost      Prio.Nbr Type",
    "---------------- ---- --- --------- -------- --------------------------------",
  ];
  const rows = lines.map((l) => {
    const sts = l.role === "alternate" ? "BLK" : "FWD";
    const short = v.ports[l.n - 1]?.short ?? "";
    return `${pad(short, 16)} ${pad(ROLE.pvst[l.role], 4)} ${sts} ${pad(PVST_COST, 9)} ${pad(`128.${nbr(l.n)}`, 8)} P2p`;
  });
  return [...head, ...rows].join("\n");
}

/** `show spanning-tree`, or with a VLAN (NX-OS, IOS XE) just that VLAN's section. */
export function showSpanningTree(v: SwitchView, model: NetModel, only?: number): Result {
  const stp = stpOf(model, v.entity.id);
  if (!stp) return { text: NONE[v.os] };
  if (v.os === "eos") return { text: eosText(v, stp, linesOf(v, model, stp)) };
  const vlans = [...model.cfg(v.entity.id).vlans.keys()]
    .filter((id) => only === undefined || id === only)
    .sort((a, b) => a - b)
    .map((id) => ({ id, lines: linesOf(v, model, stp, id) }))
    .filter((s) => s.lines.length > 0);
  if (vlans.length === 0)
    return {
      text:
        only === undefined ? NONE[v.os] : `Spanning tree instance for VLAN${only} does not exist.`,
    };
  return { text: vlans.map((s) => pvstText(v, stp, s.id, s.lines)).join("\n\n") };
}
