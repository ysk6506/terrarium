/**
 * Switch CLI commands the real OS has and the fake lacks (ADR-0184). When a line cannot be read, the fake first asks
 * whether the real OS would read it: a line that matches an entry here is an emulation gap (the OS's own error line, then
 * the `terrarium:` lines, and a record), a line that matches none is a mistake the real OS rejects too and gets only the
 * OS's own text.
 *
 * The tables are written from the vendors' command references (Arista EOS 4.x, Cisco NX-OS 10.x, Cisco IOS XE 17.x
 * command references) and cover the commands an operator reaches for on a switch; a command not listed is treated as a
 * mistake, so the list is meant to grow when an agent reaches for a real command it lacks.
 */
import { type GapNotice, gapText } from "@terrarium/core/world";
import type { Mode } from "./netos-cli";
import type { Os } from "./netos-model";
import {
  type Failure,
  failureText,
  matchCommand,
  type Token,
  type Word,
  wordsOf,
} from "./netos-parse";

type Where = "show" | "config" | "if";

interface Entry {
  readonly words: readonly Word[];
  readonly text: string;
  readonly where: Where;
}

const SHOW = [
  "show ip ospf",
  "show ip ospf neighbor",
  "show ip ospf interface",
  "show ip ospf database",
  "show ip protocols",
  "show ip route <prefix>",
  "show {IF} counters",
  "show {IF} <port> counters",
  "show {IF} transceiver",
  "show {IF} switchport",
  "show inventory",
  "show logging",
  "show users",
  "show startup-config",
  "show access-lists",
  "show vrf",
  "show ipv6 route",
  "show ipv6 interface brief",
];
const CONFIG = [
  "ip access-list <name>",
  "router ospf <id>",
  "ntp server <ip>",
  "logging host <ip>",
  "snmp-server community <name> <perm>",
  "username <name> <rest...>",
  "banner motd <text...>",
  "spanning-tree mode <mode>",
  "ip name-server <ip>",
  "ip domain-name <name>",
  "clock timezone <rest...>",
  "ip prefix-list <name> <rest...>",
  "route-map <name> <rest...>",
];
const IF = [
  "mtu <n>",
  "speed <s>",
  "channel-group <n> mode <m>",
  "ip ospf cost <n>",
  "ip helper-address <ip>",
  "ip access-group <name> <dir>",
  "load-interval <n>",
  "storm-control broadcast level <n>",
];

/** What each OS has besides the common lists. */
const BY_OS: Readonly<Record<Os, Readonly<Record<Where, readonly string[]>>>> = {
  eos: {
    show: [
      "show port-channel summary",
      "show processes top",
      "show environment temperature",
      "show ntp status",
      "show module",
    ],
    config: ["vrf instance <name>", "enable secret <rest...>", "lldp run"],
    if: ["spanning-tree portfast", "switchport port-security"],
  },
  nxos: {
    show: [
      "show port-channel summary",
      "show processes cpu",
      "show environment",
      "show ntp peer-status",
      "show cdp neighbors",
      "show module",
      "show feature",
    ],
    config: ["vrf context <name>", "feature <name>"],
    if: ["spanning-tree port type edge"],
  },
  iosxe: {
    show: [
      "show etherchannel summary",
      "show processes cpu",
      "show environment",
      "show ntp status",
      "show cdp neighbors",
    ],
    config: ["ip vrf <name>", "enable secret <rest...>", "lldp run"],
    if: ["spanning-tree portfast", "switchport port-security", "duplex <d>"],
  },
};

const cache = new Map<Os, readonly Entry[]>();

function entriesFor(os: Os): readonly Entry[] {
  const known = cache.get(os);
  if (known) return known;
  const mk = (where: Where, texts: readonly string[]): Entry[] =>
    texts.map((text) => ({ text, where, words: wordsOf(text, os) }));
  const extra = BY_OS[os];
  const all = [
    ...mk("show", [...SHOW, ...extra.show]),
    ...mk("config", [...CONFIG, ...extra.config]),
    ...mk("if", [...IF, ...extra.if]),
  ];
  cache.set(os, all);
  return all;
}

/** Whether a command of this kind can be typed in this mode on this OS (a gap only counts where the real OS would read the line). */
function typedHere(os: Os, mode: Mode, where: Where): boolean {
  if (where === "config") return mode === "config";
  if (where === "if") return mode === "config-if";
  return os === "iosxe" ? mode === "user" || mode === "priv" : true;
}

/** The feature key: the command as the OS words it, values named, no spaces. */
const featureOf = (text: string): string =>
  text
    .replace("{IF}", "interfaces")
    .replace(/<([^>.]+)(\.\.\.)?>/g, "$1")
    .replace(/ /g, "-");

const wordText = (w: Word): string => (typeof w === "string" ? w : `<${w.arg}>`);

/** What works here under the same first word, compact (the commands the fake has, in the order it lists them). */
function supportedOf(specs: readonly { readonly words: readonly Word[] }[], first: string): string {
  const same = specs
    .map((s) => s.words.map(wordText).join(" "))
    .filter((t) => t.split(" ")[0] === first)
    .filter((t, i, a) => a.indexOf(t) === i);
  const shown = same.slice(0, 12);
  const more = same.length - shown.length;
  return `${shown.join(" · ")}${more > 0 ? ` 외 ${more}개` : ""}`;
}

/** A command the fake can run here, that stands for "something that works" in the hint. */
function exampleOf(os: Os, mode: Mode): string {
  if (mode === "user" || mode === "priv")
    return os === "nxos" ? "show interface status" : "show interfaces status";
  return os === "iosxe" ? "do show running-config" : "show running-config";
}

/** The gap a line is, when the real OS reads it and the fake does not; undefined for a line the OS rejects too. */
export function cliGap(
  os: Os,
  mode: Mode,
  tokens: readonly Token[],
  here: readonly { readonly words: readonly Word[] }[],
): GapNotice | undefined {
  const entries = entriesFor(os).filter((e) => typedHere(os, mode, e.where));
  const found = matchCommand(entries, tokens);
  if ("kind" in found) return undefined;
  const first = wordText(found.spec.words[0] as Word);
  return {
    tool: os,
    feature: featureOf(found.spec.text),
    what: found.spec.text.replace("{IF}", os === "nxos" ? "interface" : "interfaces"),
    supported: supportedOf(here, first),
    example: exampleOf(os, mode),
  };
}

/** The whole text of a CLI gap: the OS's own error for the line, then the `terrarium:` lines. */
export function cliGapText(
  gap: GapNotice,
  os: Os,
  failure: Failure,
  tokens: readonly Token[],
  prompt: string,
  line: string,
): string {
  return gapText({ ...gap, said: failureText(os, failure, tokens, prompt, line) });
}
