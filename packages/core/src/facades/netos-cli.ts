/**
 * The command line of a switch (REQ-062, ADR-0059): a login session with modes (user, privileged,
 * configuration, interface configuration), the commands each OS has, and the prompts and error texts it
 * prints. `shutdown` and `no shutdown` on a port change the world; `hostname` and `description` are
 * remembered beside it (SNMP's sysName and ifAlias read the same notes). Commands the world has nothing
 * behind (VLANs, MAC tables, routes) are not offered: they get the OS's "invalid input" answer.
 */
import { TerrariumError } from "@terrarium/core/kernel";
import type { ProfileRegistry } from "@terrarium/core/profiles";
import {
  type Entity,
  type NetChange,
  type NetModel,
  netModelOf,
  type WorldPort,
} from "@terrarium/core/world";
import { bgpConfigSpecs, bgpShowSpecs, stpShowSpecs } from "./netos-bgp-config";
import { interfaceDescription, interfaceDetail, interfaceStatus } from "./netos-iface";
import { macRows, showMacTable, showTrunk, showVlan } from "./netos-l2";
import { arpRows, showIpArp, showIpInterfaceBrief } from "./netos-l3";
import { enterSvi, l23ConfigSpecs } from "./netos-l23-config";
import {
  findPort,
  type Memo,
  type Os,
  type PortView,
  type Result,
  type SwitchView,
  shutPort,
  switchView,
} from "./netos-model";
import {
  applyFilter,
  type FailKind,
  failureText,
  isFailure,
  matchCommand,
  parseFilter,
  splitPipes,
  type Token,
  tokenize,
  type Word,
} from "./netos-parse";
import { runPing, runTraceroute } from "./netos-ping";
import { showIpRoute } from "./netos-routes";
import { runningConfig, showClock, showHostname, showLldp, showVersion } from "./netos-show";

export type Mode =
  | "user"
  | "priv"
  | "config"
  | "config-if"
  | "config-vlan"
  | "config-bgp"
  | "config-bgp-nbr";

/** A line the CLI cannot act on, at the token that is wrong. */
export class CliFailure extends Error {
  constructor(
    readonly kind: FailKind,
    readonly at: number,
  ) {
    super(kind);
  }
}

export interface Call {
  readonly session: CliSession;
  readonly v: SwitchView;
  readonly args: readonly string[];
  readonly argAt: readonly number[];
}

export interface Spec {
  readonly words: readonly Word[];
  readonly modes: readonly Mode[];
  readonly run: (call: Call) => Result | undefined;
}

export interface Step {
  readonly command: string;
  /** The prompt the command was typed at. */
  readonly prompt: string;
  readonly output: string;
  readonly ok: boolean;
  /** What a show command produced (text and, where the OS has one, JSON); absent for other commands. */
  readonly result?: Result;
  /** Why the line failed. */
  readonly failure?: string;
}

const CONFIG: readonly Mode[] = [
  "config",
  "config-if",
  "config-vlan",
  "config-bgp",
  "config-bgp-nbr",
];
const PRIV_UP: readonly Mode[] = ["priv", ...CONFIG];
const ALL: readonly Mode[] = ["user", ...PRIV_UP];

/** `show {IF} <port> status` → words; `<x>` is a value, `<x...>` takes the rest of the line. */
function wordsOf(text: string, os: Os): Word[] {
  return text
    .replace("{IF}", os === "nxos" ? "interface" : "interfaces")
    .split(" ")
    .map((w) => {
      if (!w.startsWith("<")) return w;
      const rest = w.endsWith("...>");
      return rest ? { arg: w.slice(1, -4), rest: true as const } : { arg: w.slice(1, -1) };
    });
}

export type Maker = (text: string, modes: readonly Mode[], run: Spec["run"]) => Spec;

function portArg(call: Call, i = 0): PortView {
  const text = call.args[i] as string;
  const port = findPort(call.v.ports, call.v.os, text);
  if (!port) throw new CliFailure("invalid", call.argAt[i] ?? 0);
  return port;
}

function showSpecs(s: Maker, os: Os): Spec[] {
  const shows: readonly Mode[] = os === "iosxe" ? ["user", "priv"] : ALL;
  const priv: readonly Mode[] = os === "iosxe" ? ["priv"] : PRIV_UP;
  return [
    s("show version", shows, (c) => showVersion(c.v)),
    s("show clock", shows, (c) => showClock(c.v)),
    s("show {IF} status", shows, (c) => interfaceStatus(c.v)),
    s("show {IF} <port> status", shows, (c) => interfaceStatus(c.v, portArg(c))),
    s("show {IF} description", shows, (c) => interfaceDescription(c.v)),
    s("show {IF} <port>", shows, (c) => interfaceDetail(c.v, portArg(c))),
    s("show {IF}", shows, (c) => interfaceDetail(c.v)),
    s("show ip interface brief", shows, (c) => showIpInterfaceBrief(c.v, c.session.model())),
    s("show vlan", shows, (c) => showVlan(c.v, c.session.model())),
    s("show vlan brief", shows, (c) => showVlan(c.v, c.session.model())),
    s("show mac address-table", shows, (c) =>
      showMacTable(c.v, macRows(c.v, c.session.model(), c.session.world)),
    ),
    s("show mac address-table vlan <id>", shows, (c) =>
      showMacTable(c.v, macRows(c.v, c.session.model(), c.session.world, Number(c.args[0]))),
    ),
    s("show {IF} trunk", shows, (c) => showTrunk(c.v)),
    s("show ip route", shows, (c) => showIpRoute(c.v, c.session.model())),
    s("show ip arp", shows, (c) =>
      showIpArp(c.v, arpRows(c.v, c.session.model(), c.session.world)),
    ),
    s("ping <host>", shows, (c) =>
      runPing(c.v, c.session.model(), c.session.world, c.args[0] as string),
    ),
    s("traceroute <host>", shows, (c) =>
      runTraceroute(c.v, c.session.model(), c.session.world, c.args[0] as string),
    ),
    s("show lldp neighbors", shows, (c) => showLldp(c.v)),
    s("show running-config", priv, (c) => runningConfig(c.v, c.session.model(), c.session.memo)),
    s("show running-config interface <port>", priv, (c) =>
      runningConfig(c.v, c.session.model(), c.session.memo, portArg(c)),
    ),
    ...(os === "iosxe" ? [] : [s("show hostname", shows, (c) => showHostname(c.v))]),
    ...bgpShowSpecs(s, os, shows),
    ...stpShowSpecs(s, os, shows),
  ];
}

/** Ends the session (`exit` at the top level, `logout`). */
const close: Spec["run"] = (c) => {
  c.session.closed = true;
  return undefined;
};

/** Moves the session to a mode, or closes it. */
const goto =
  (mode: Mode, banner?: string): Spec["run"] =>
  (c) => {
    c.session.mode = mode;
    return banner ? { text: banner } : undefined;
  };

const BANNER = "Enter configuration commands, one per line.  End with CNTL/Z.";

function sessionSpecs(s: Maker, os: Os): Spec[] {
  const banner = os === "eos" ? undefined : BANNER;
  const specs = [
    s("configure terminal", ["priv"], goto("config", banner)),
    s("configure", ["priv"], goto("config", banner)),
    s("end", CONFIG, goto("priv")),
    s("exit", ["config-if", "config-vlan", "config-bgp"], goto("config")),
    s("exit", ["config-bgp-nbr"], goto("config-bgp")),
    s("exit", ["config"], goto("priv")),
    s("exit", ["user", "priv"], close),
    s("logout", ALL, close),
    s("terminal length <n>", ALL, () => undefined),
    s("terminal width <n>", ALL, () => undefined),
    s("write memory", ["priv"], () => ({
      text: os === "nxos" ? "Copy complete." : "Copy completed successfully.",
    })),
    s("write", ["priv"], () => ({
      text: os === "nxos" ? "Copy complete." : "Copy completed successfully.",
    })),
    s("copy running-config startup-config", ["priv"], () => ({
      text:
        os === "nxos"
          ? "Copy complete, now saving to disk (please wait)...\nCopy complete."
          : "Copy completed successfully.",
    })),
  ];
  if (os === "nxos") return specs;
  return [
    ...specs,
    s("enable", ["user", "priv"], goto("priv")),
    s("disable", ["priv"], goto("user")),
    ...(os === "iosxe"
      ? [s("do <line...>", CONFIG, (c) => ({ text: c.session.nested(c.args[0] as string) }))]
      : []),
  ];
}

function configSpecs(s: Maker, os: Os): Spec[] {
  return [
    s("interface <port>", CONFIG, (c) => {
      const svi = /^vlan\s*(\d+)$/i.exec(c.args[0] as string);
      if (svi) return enterSvi(c, Number(svi[1]));
      c.session.port = portArg(c).n;
      c.session.svi = 0;
      c.session.mode = "config-if";
      return undefined;
    }),
    ...l23ConfigSpecs(s, os),
    ...bgpConfigSpecs(s, os),
    s(
      "hostname <name>",
      ["config"],
      (c) => void c.session.memo.set("sysName", c.args[0] as string),
    ),
    s("no hostname", ["config"], (c) => void c.session.memo.delete("sysName")),
    s(
      "description <text...>",
      ["config-if"],
      (c) => void c.session.memo.set(c.session.aliasKey(), c.args[0] as string),
    ),
    s("no description", ["config-if"], (c) => void c.session.memo.set(c.session.aliasKey(), "")),
    s("shutdown", ["config-if"], (c) => c.session.setShut(c.v, true)),
    s("no shutdown", ["config-if"], (c) => c.session.setShut(c.v, false)),
  ];
}

const tables = new Map<Os, readonly Spec[]>();

function specsFor(os: Os): readonly Spec[] {
  const known = tables.get(os);
  if (known) return known;
  const s: Maker = (text, modes, run) => ({ words: wordsOf(text, os), modes, run });
  const all = [...showSpecs(s, os), ...sessionSpecs(s, os), ...configSpecs(s, os)];
  tables.set(os, all);
  return all;
}

const PROMPT_TAIL: Readonly<Record<Mode, string>> = {
  user: ">",
  priv: "#",
  config: "(config)#",
  "config-if": "(config-if)#",
  "config-vlan": "(config-vlan)#",
  "config-bgp": "(config-router)#",
  "config-bgp-nbr": "(config-router-neighbor)#",
};

/** A command the OS has but not at this privilege level (EOS says so in words). */
class PrivilegeError extends Error {}

/** A line run through `do` that failed; its message is what the OS printed. */
class NestedFailure extends Error {}

export class CliSession {
  mode: Mode;
  closed = false;
  /** The port `interface` selected (0 when none, or when a VLAN interface is selected). */
  port = 0;
  /** The VLAN interface `interface vlan` selected (0 when none). */
  svi = 0;
  /** The VLAN `vlan` selected, in VLAN configuration mode. */
  vlan = 0;
  /** The BGP neighbor `neighbor` selected (NX-OS), in neighbor configuration mode. */
  neighbor = "";

  constructor(
    readonly world: WorldPort,
    private readonly entity: Entity,
    private readonly profiles: ProfileRegistry,
    readonly memo: Memo,
    start: Mode,
  ) {
    this.mode = start;
  }

  get deviceId(): string {
    return this.entity.id;
  }

  /** The network as it stands now (read again for every call, so it sees the commands just typed). */
  model(): NetModel {
    return netModelOf(this.world);
  }

  /** A layer-2/3 configuration change on this switch. */
  change(change: NetChange): void {
    this.world.apply(
      { type: "net.set", target: this.entity.id, change },
      `network:${this.entity.id}`,
    );
  }

  /** The note a description is kept under: the port's, or the VLAN interface's. */
  aliasKey(): string {
    return this.svi > 0 ? `sviAlias.${this.svi}` : `ifAlias.${this.port}`;
  }

  view(): SwitchView {
    return switchView(this.world, this.entity, this.profiles, this.memo);
  }

  prompt(v: SwitchView = this.view()): string {
    return `${v.hostname}${this.tail(v)}${v.os === "nxos" ? " " : ""}`;
  }

  private tail(v: SwitchView): string {
    if (v.os !== "eos") return PROMPT_TAIL[this.mode];
    if (this.mode === "config-vlan") return `(config-vlan-${this.vlan})#`;
    if (this.mode === "config-bgp") return "(config-router-bgp)#";
    if (this.mode !== "config-if") return PROMPT_TAIL[this.mode];
    return this.svi > 0
      ? `(config-if-Vl${this.svi})#`
      : `(config-if-${v.ports[this.port - 1]?.short ?? ""})#`;
  }

  /** `shutdown` / `no shutdown` on the selected port. */
  setShut(v: SwitchView, down: boolean): undefined {
    if (this.svi > 0) {
      const svi = this.model().cfg(this.entity.id).svis.get(this.svi);
      if (svi) this.change({ op: "svi", vlan: this.svi, cfg: { ...svi, shut: down } });
      return undefined;
    }
    const p = v.ports[this.port - 1];
    if (p) shutPort(this.world, this.entity.id, p, this.memo, down);
    return undefined;
  }

  /** Runs a line in privileged mode from inside configuration mode (`do show ...`). */
  nested(line: string): string {
    const saved = this.mode;
    this.mode = "priv";
    try {
      const step = this.exec(line);
      if (!step.ok) throw new NestedFailure(step.output);
      return step.output;
    } finally {
      this.mode = saved;
    }
  }

  exec(line: string): Step {
    const v = this.view();
    const prompt = this.prompt(v);
    const { command, pipes } = splitPipes(line);
    const tokens = tokenize(command);
    if (tokens.length === 0) return { command: line, prompt, output: "", ok: true };
    try {
      const result = this.dispatch(v, tokens);
      const output = this.pipe(v, result, pipes);
      return { command: line, prompt, output, ok: true, ...(result ? { result } : {}) };
    } catch (error) {
      const failure = this.explain(v, error, command, tokens, prompt);
      return { command: line, prompt, output: failure, ok: false, failure };
    }
  }

  private specs(mode: Mode, os: Os): Spec[] {
    return specsFor(os).filter((spec) => spec.modes.includes(mode));
  }

  private dispatch(v: SwitchView, tokens: readonly Token[]): Result | undefined {
    const found = matchCommand(this.specs(this.mode, v.os), tokens);
    if (!isFailure(found))
      return found.spec.run({ session: this, v, args: found.args, argAt: found.argAt });
    // A command EOS has, but not in this mode, says so instead of calling it invalid.
    if (
      v.os === "eos" &&
      this.mode === "user" &&
      !isFailure(matchCommand(this.specs("priv", v.os), tokens))
    )
      throw new PrivilegeError();
    throw new CliFailure(found.kind, found.at);
  }

  private pipe(v: SwitchView, result: Result | undefined, pipes: readonly string[]): string {
    let text = result?.text ?? "";
    for (const pipe of pipes) {
      const filter = parseFilter(v.os, pipe);
      if (!filter) throw new CliFailure("invalid", 0);
      if (filter.name === "json") {
        if (!result?.data || v.os === "iosxe") throw new CliFailure("invalid", 0);
        text = JSON.stringify(result.data, null, v.os === "eos" ? 4 : undefined);
        continue;
      }
      const next = applyFilter(filter, text);
      if (next === undefined) throw new CliFailure("invalid", 0);
      text = next;
    }
    return text;
  }

  private explain(
    v: SwitchView,
    error: unknown,
    command: string,
    tokens: readonly Token[],
    prompt: string,
  ): string {
    if (error instanceof PrivilegeError) return "% Invalid input (privileged mode required)";
    if (error instanceof NestedFailure) return error.message;
    if (error instanceof CliFailure)
      return failureText(v.os, { kind: error.kind, at: error.at }, tokens, prompt, command.trim());
    if (error instanceof TerrariumError) return `% ${error.message}`;
    throw error;
  }
}
