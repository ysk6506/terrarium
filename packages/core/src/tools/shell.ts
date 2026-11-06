/**
 * The fake shell of `run_command` (REQ-087, ADR-0091). It is not a shell: a command is matched against a short list,
 * and the output is made from the host's state in the shape of the real tool (shell-output.ts). A command that
 * changes something (`systemctl restart`, `rm` on a log path, `logrotate`, `reboot`, `mount -o remount,rw`) is a
 * world event (`host.act`), so what it does shows in the host's state, in the services, and in scoring.
 * A command outside the list is not an error: the answer lists what works.
 */
import type { ServerModel } from "@terrarium/core/catalog";
import { InvalidValueError } from "@terrarium/core/kernel";
import {
  type HostOs,
  hostOsOf,
  hostVerdict,
  netModelOf,
  serviceDef,
  switchAlive,
  type WorldPort,
} from "@terrarium/core/world";
import {
  chronycOutput,
  dateLine,
  dfOutput,
  dmesgOutput,
  freeOutput,
  type HostView,
  journalOutput,
  mountOutput,
  psOutput,
  statusOutput,
  topOutput,
  uptimeLine,
} from "./shell-output";

export interface ShellResult {
  readonly output: string;
  readonly exitCode: number;
  /** False when the command is not one the shell knows (the output then lists the ones it does). */
  readonly supported: boolean;
}

export const SHELL_COMMANDS: readonly string[] = [
  "df -h",
  "free -m",
  "top -bn1",
  "ps aux",
  "systemctl status <unit>",
  "systemctl restart <unit>",
  "journalctl -n <N> [-u <unit>] [-p err]",
  "dmesg",
  "ping <host>",
  "curl -I <url>",
  "date",
  "uptime",
  "mount",
  "chronyc tracking",
  "rm <path under /var/log or /tmp>",
  "logrotate -f /etc/logrotate.conf",
  "reboot",
  "mount -o remount,rw /",
];

const MAX_LINES = 400;
const ok = (output: string): ShellResult => ({ output, exitCode: 0, supported: true });
const fail = (output: string, exitCode: number): ShellResult => ({
  output,
  exitCode,
  supported: true,
});
const NOT_YET = (cmd: string): ShellResult => ({
  output: `이 명령은 아직 못 해요: ${cmd}\n되는 명령: ${SHELL_COMMANDS.join(", ")}\n한 단계 파이프만 돼요: | grep [-i|-v|-c] <글자>, | tail [-n N], | head [-n N]`,
  exitCode: 127,
  supported: false,
});

interface Cmd {
  readonly world: WorldPort;
  readonly id: string;
  readonly view: HostView;
  readonly argv: readonly string[];
}

// ── the host ────────────────────────────────────────────────────────────────────────────────

function memoryMb(world: WorldPort, id: string): number {
  const e = world.index.entity(id);
  if (e.kind === "vm") return Number(e.props.memoryGiB ?? 16) * 1024;
  try {
    return (world.catalog.getOf(e.modelId ?? "", "server") as ServerModel).memoryGiB * 1024;
  } catch {
    return 262_144;
  }
}

function coresOf(world: WorldPort, id: string): number {
  const e = world.index.entity(id);
  if (e.kind === "vm") return Number(e.props.cpuCount ?? 4);
  try {
    const m = world.catalog.getOf(e.modelId ?? "", "server") as ServerModel;
    return m.cpuSockets * m.coresPerSocket;
  } catch {
    return 32;
  }
}

const spread = (s: string): number => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7);

/** The address of a host: the network plan's for a server that has one, else one made from its id. */
export function ipOf(world: WorldPort, id: string): string {
  const plan =
    world.index.find(id)?.kind === "server" ? netModelOf(world).plan.hosts.get(id) : undefined;
  if (plan) return plan.ip;
  const h = spread(id);
  return `10.20.${h % 200}.${((h >> 3) % 250) + 2}`;
}

function viewOf(world: WorldPort, id: string, os: HostOs): HostView {
  const name = world.index.entity(id).name;
  return {
    name,
    ip: ipOf(world, id),
    os,
    t: world.time(),
    memTotalMb: memoryMb(world, id),
    cores: coresOf(world, id),
  };
}

/** Whether you can log in: the machine is on, and its system is up. */
function reachable(world: WorldPort, id: string, os: HostOs): boolean {
  if (!os.up) return false;
  const s = world.stateOf(id);
  return s.kind === "server"
    ? s.powered && s.adminOn && !s.rebooting
    : s.kind === "vm"
      ? s.running
      : false;
}

// ── tokens and pipes ────────────────────────────────────────────────────────────────────────

function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

/** One pipe stage: grep, tail or head. */
function filter(output: string, stage: readonly string[]): string | undefined {
  const [prog, ...args] = stage;
  const lines = output.split("\n");
  if (prog === "grep") return grep(lines, args);
  if (prog !== "tail" && prog !== "head") return undefined;
  const flag = args.indexOf("-n");
  const raw = flag >= 0 ? args[flag + 1] : args.find((a) => /^-\d+$/.test(a))?.slice(1);
  const n = Number(raw ?? 10);
  if (!Number.isInteger(n) || n < 0) return undefined;
  return (prog === "tail" ? lines.slice(-n || lines.length) : lines.slice(0, n)).join("\n");
}

function grep(lines: string[], args: readonly string[]): string | undefined {
  const flags = args.filter((a) => /^-[ivc]+$/.test(a)).join("");
  const pattern = args.filter((a) => !/^-[ivc]+$/.test(a)).join(" ");
  if (pattern === "") return undefined;
  const text = flags.includes("i") ? pattern.toLowerCase() : pattern;
  const hit = (l: string) =>
    (flags.includes("i") ? l.toLowerCase() : l).includes(text) !== flags.includes("v");
  const found = lines.filter(hit);
  return flags.includes("c") ? String(found.length) : found.join("\n");
}

function clip(output: string): string {
  const lines = output.split("\n");
  if (lines.length <= MAX_LINES) return output;
  return `${lines.slice(0, MAX_LINES).join("\n")}\n... (출력이 길어서 ${MAX_LINES}줄만 보여요. 전체 ${lines.length.toLocaleString("en-US")}줄. | grep 이나 | tail 로 좁혀 보세요)`;
}

// ── commands that look ──────────────────────────────────────────────────────────────────────

function journal(c: Cmd): ShellResult {
  const a = c.argv;
  const at = (flag: string) => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const n = Number(at("-n") ?? 10);
  if (!Number.isInteger(n) || n < 1) return NOT_YET(a.join(" "));
  const unit = at("-u")?.replace(/\.service$/, "");
  return ok(
    journalOutput(c.view, {
      n: Math.min(n, 200),
      ...(unit ? { unit } : {}),
      errorsOnly: at("-p") === "err",
    }),
  );
}

function status(c: Cmd): ShellResult {
  const unit = (c.argv[2] ?? "").replace(/\.service$/, "");
  const p = c.view.os.processes.find((q) => q.name === unit);
  if (!p) return fail(`Unit ${unit}.service could not be found.`, 4);
  return ok(statusOutput(c.view, p));
}

/** A name a person types for a thing in the world: its id or name, or a service's process, with or without a domain. */
function resolve(world: WorldPort, name: string): { id: string; service?: string } | undefined {
  const bare = (name.split(".")[0] ?? "").toLowerCase();
  const direct = world.index
    .all()
    .find((e) => e.id.toLowerCase() === bare || e.name.toLowerCase() === bare);
  if (direct && direct.kind !== "service") return { id: direct.id };
  for (const s of world.index.ofKind("service")) {
    if (
      serviceDef(s).process.toLowerCase() === bare ||
      s.id.toLowerCase() === bare ||
      s.id.replace(/^svc-/, "").toLowerCase() === bare
    )
      return { id: world.stateAs(s.id, "service").runsOn[0] ?? s.id, service: s.id };
  }
  return direct ? { id: direct.id, service: direct.id } : undefined;
}

/** A service with the default conditions, to ask how a place is doing without a particular service in mind. */
const PROBE = serviceDef({ id: "probe", kind: "service", name: "probe", props: {} });

const IP = /^\d{1,3}(\.\d{1,3}){3}$/;

function ping(c: Cmd): ShellResult {
  const args = c.argv.slice(1);
  const countAt = args.indexOf("-c");
  const count = countAt >= 0 ? Math.min(Number(args[countAt + 1] ?? 4) || 4, 10) : 4;
  const target = args.filter((a, i) => !a.startsWith("-") && args[i - 1] !== "-c")[0];
  if (!target) return NOT_YET(c.argv.join(" "));
  if (!IP.test(target) && !c.view.os.dnsOk)
    return fail(`ping: ${target}: Name or service not known`, 2);
  const found = resolve(c.world, target);
  if (!found)
    return IP.test(target)
      ? lost(target, target, count, c)
      : fail(`ping: ${target}: Name or service not known`, 2);
  const ip = ipOf(c.world, found.id);
  const up = pingable(c.world, found.id);
  return up ? replies(target, ip, count) : lost(target, ip, count, c);
}

function pingable(world: WorldPort, id: string): boolean {
  const kind = world.index.entity(id).kind;
  if (kind === "switch") return switchAlive(world, id);
  if (kind !== "server" && kind !== "vm" && kind !== "storage") return true;
  const dead = hostVerdict(world, id, PROBE);
  return !(
    dead.state === "dead" &&
    ["power", "off", "reboot", "network", "os_down", "hardware"].includes(dead.cause ?? "")
  );
}

function replies(target: string, ip: string, count: number): ShellResult {
  const rows = Array.from(
    { length: count },
    (_, i) =>
      `64 bytes from ${target} (${ip}): icmp_seq=${i + 1} ttl=63 time=0.${380 + ((i * 37) % 90)} ms`,
  );
  return ok(
    [
      `PING ${target} (${ip}) 56(84) bytes of data.`,
      ...rows,
      "",
      `--- ${target} ping statistics ---`,
      `${count} packets transmitted, ${count} received, 0% packet loss, time ${(count - 1) * 1001}ms`,
      "rtt min/avg/max/mdev = 0.380/0.412/0.447/0.021 ms",
    ].join("\n"),
  );
}

function lost(target: string, ip: string, count: number, c: Cmd): ShellResult {
  const rows = Array.from(
    { length: count },
    (_, i) => `From ${c.view.ip} icmp_seq=${i + 1} Destination Host Unreachable`,
  );
  return fail(
    [
      `PING ${target} (${ip}) 56(84) bytes of data.`,
      ...rows,
      "",
      `--- ${target} ping statistics ---`,
      `${count} packets transmitted, 0 received, +${count} errors, 100% packet loss, time ${count * 1000}ms`,
    ].join("\n"),
    1,
  );
}

function curl(c: Cmd): ShellResult {
  const args = c.argv.slice(1);
  const head = args.some((a) => /^-[a-zA-Z]*I[a-zA-Z]*$/.test(a) || a === "--head");
  const url = args.find((a) => !a.startsWith("-"));
  if (!head || !url) return NOT_YET(c.argv.join(" "));
  const host = url.replace(/^\w+:\/\//, "").split(/[/:]/)[0] ?? "";
  const https = url.startsWith("https");
  const port = https ? 443 : 80;
  if (!IP.test(host) && !c.view.os.dnsOk)
    return fail(`curl: (6) Could not resolve host: ${host}`, 6);
  const found = resolve(c.world, host);
  if (!found?.service)
    return fail(`curl: (7) Failed to connect to ${host} port ${port}: Connection refused`, 7);
  return serviceReply(c, found.service, host, port);
}

const header = (code: string, extra: string[] = []): string =>
  [`HTTP/1.1 ${code}`, "Server: nginx", "Content-Type: text/html", ...extra].join("\n");

function serviceReply(c: Cmd, serviceId: string, host: string, port: number): ShellResult {
  const state = c.world.stateAs(serviceId, "service");
  const def = serviceDef(c.world.index.entity(serviceId));
  if (state.status === "healthy") return ok(header("200 OK", ["X-Response-Time: 38ms"]));
  if (state.status === "degraded") return ok(header("200 OK", ["X-Response-Time: 2310ms"]));
  const cause = state.runsOn
    .map((h) => hostVerdict(c.world, h, def))
    .find((v) => v.state === "dead")?.cause;
  if (cause === "cert")
    return fail("curl: (60) SSL certificate problem: certificate has expired", 60);
  if (cause === "ntp")
    return ok(
      header("401 Unauthorized", ["WWW-Authenticate: Negotiate", "X-Reason: clock skew too great"]),
    );
  if (cause === "dns") return ok(header("502 Bad Gateway"));
  if (cause === "disk" || cause === "fs") return ok(header("500 Internal Server Error"));
  if (cause === "process" || cause === "zombie" || cause === "memory")
    return fail(`curl: (7) Failed to connect to ${host} port ${port}: Connection refused`, 7);
  return fail("curl: (28) Connection timed out after 5001 milliseconds", 28);
}

// ── commands that change the world ──────────────────────────────────────────────────────────

const LOG_PATH = /^\/(var\/log|tmp)(\/|$)/;

function write(
  c: Cmd,
  action: "restart" | "free_disk" | "remount_rw" | "reboot",
  arg?: string,
): void {
  c.world.apply(
    { type: "host.act", target: c.id, action, ...(arg !== undefined ? { arg } : {}) },
    "tool:run_command",
  );
}

function restart(c: Cmd): ShellResult {
  const unit = (c.argv[2] ?? "").replace(/\.service$/, "");
  if (!c.view.os.processes.some((p) => p.name === unit))
    return fail(`Failed to restart ${unit}.service: Unit ${unit}.service not found.`, 5);
  write(c, "restart", unit);
  return ok("");
}

function remove(c: Cmd): ShellResult {
  const paths = c.argv.slice(1).filter((a) => !a.startsWith("-"));
  if (paths.length === 0 || paths.some((p) => !LOG_PATH.test(p) || p.includes("..")))
    return {
      ...NOT_YET(c.argv.join(" ")),
      output: `이 명령은 아직 못 해요: ${c.argv.join(" ")}\n지울 수 있는 곳은 /var/log 와 /tmp 아래뿐이에요.`,
    };
  if (c.view.os.fs === "ro")
    return fail(paths.map((p) => `rm: cannot remove '${p}': Read-only file system`).join("\n"), 1);
  write(c, "free_disk", paths.join(" "));
  return ok("");
}

function rotate(c: Cmd): ShellResult {
  if (c.view.os.fs === "ro")
    return fail(
      "error: error creating output file /var/log/messages-20261105: Read-only file system",
      1,
    );
  write(c, "free_disk", "/var/log");
  return ok("");
}

function remount(c: Cmd): ShellResult {
  const i = c.argv.indexOf("-o");
  if (i < 0) return ok(mountOutput(c.view));
  if (c.argv[i + 1] !== "remount,rw" || !c.argv[i + 2]) return NOT_YET(c.argv.join(" "));
  write(c, "remount_rw");
  return ok("");
}

// ── dispatch ────────────────────────────────────────────────────────────────────────────────

const SIMPLE: Readonly<Record<string, (c: Cmd) => ShellResult>> = {
  df: (c) =>
    ok(
      dfOutput(
        c.view,
        c.argv.find((a, i) => i > 0 && !a.startsWith("-")),
      ),
    ),
  free: (c) => ok(freeOutput(c.view)),
  top: (c) => ok(topOutput(c.view)),
  ps: (c) => (c.argv[1] === "aux" ? ok(psOutput(c.view)) : NOT_YET(c.argv.join(" "))),
  journalctl: journal,
  dmesg: (c) => ok(dmesgOutput(c.view)),
  date: (c) => ok(dateLine(c.view)),
  uptime: (c) => ok(uptimeLine(c.view)),
  ping,
  curl,
  mount: remount,
  rm: remove,
  logrotate: rotate,
  reboot: (c) => {
    write(c, "reboot");
    return ok(`Connection to ${c.view.name} closed by remote host.`);
  },
  chronyc: (c) =>
    c.argv[1] === "tracking" ? ok(chronycOutput(c.view)) : NOT_YET(c.argv.join(" ")),
  systemctl: (c) =>
    c.argv[1] === "status"
      ? status(c)
      : c.argv[1] === "restart"
        ? restart(c)
        : NOT_YET(c.argv.join(" ")),
};

/** Run one command line on a server or VM. */
export function runShell(world: WorldPort, id: string, line: string): ShellResult {
  const kind = world.index.entity(id).kind;
  if (kind !== "server" && kind !== "vm")
    throw new InvalidValueError(`'${id}' is a ${kind}; run_command needs a server or VM`);
  const os = hostOsOf(world, id);
  if (!reachable(world, id, os))
    return fail(
      `ssh: connect to host ${world.index.entity(id).name} port 22: Connection timed out`,
      255,
    );
  const [left, right, ...extra] = line.split("|").map((s) => s.trim());
  const argv = words(left ?? "");
  const run = SIMPLE[argv[0] ?? ""];
  if (!run || extra.length > 0) return NOT_YET(line);
  const result = run({ world, id, view: viewOf(world, id, os), argv });
  if (right === undefined || !result.supported) return { ...result, output: clip(result.output) };
  const filtered = filter(result.output, words(right));
  return filtered === undefined ? NOT_YET(line) : { ...result, output: clip(filtered) };
}
