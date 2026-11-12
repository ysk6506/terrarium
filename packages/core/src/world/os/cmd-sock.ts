/** Socket and interface commands of the fake shell: ss, netstat, ip, lsof (ADR-0117 decision 4). Listeners come from the process table. */
import { hash53 } from "@terrarium/core/kernel";
import { has, parseArgs } from "./args";
import { normalize } from "./fs";
import { DB_PORT, portOf } from "./layout";
import { processTable } from "./procs";
import { badFlag } from "./real-options";
import { type Cmd, emulationGap, fail, joinLines, ok, type R } from "./types";

interface Sock {
  readonly proto: "tcp" | "udp";
  readonly state: "LISTEN" | "ESTAB" | "UNCONN";
  readonly local: string;
  readonly peer: string;
  readonly proc: string;
  readonly pid: number;
  readonly port: number;
}

const WELL_KNOWN: Readonly<Record<string, Array<[number, "tcp" | "udp", string]>>> = {
  sshd: [[22, "tcp", "0.0.0.0"]],
  chronyd: [[323, "udp", "127.0.0.1"]],
  "systemd-resolved": [
    [53, "udp", "127.0.0.53"],
    [53, "tcp", "127.0.0.53"],
  ],
  postgresql: [[DB_PORT, "tcp", "0.0.0.0"]],
  "calico-node": [[9099, "tcp", "127.0.0.1"]],
  "sdn-controller": [[6653, "tcp", "0.0.0.0"]],
  "nginx-ingress": [
    [443, "tcp", "0.0.0.0"],
    [80, "tcp", "0.0.0.0"],
  ],
};

function sockets(c: Cmd): Sock[] {
  const out: Sock[] = [];
  for (const p of processTable(c.h)) {
    if (!p.unit) continue;
    const known = WELL_KNOWN[p.unit];
    const app = c.h.services.some((s) => s.process === p.unit);
    const ports: Array<[number, "tcp" | "udp", string]> =
      known ?? (app ? [[portOf(p.unit), "tcp", "0.0.0.0"]] : []);
    for (const [port, proto, addr] of ports) {
      out.push({
        proto,
        state: proto === "udp" ? "UNCONN" : "LISTEN",
        local: `${addr}:${port}`,
        peer: proto === "udp" ? "0.0.0.0:*" : "0.0.0.0:*",
        proc: p.unit,
        pid: p.pid,
        port,
      });
      if (app && proto === "tcp")
        for (let k = 0; k < 2; k++) {
          const from = `10.20.${hash53(`${c.h.id}|peer${k}`) % 200}.${10 + k}`;
          out.push({
            proto,
            state: "ESTAB",
            local: `${c.h.ip}:${port}`,
            peer: `${from}:${40_000 + (hash53(`${c.h.id}|pp${k}`) % 20_000)}`,
            proc: p.unit,
            pid: p.pid,
            port,
          });
        }
    }
  }
  return out;
}

function pickSockets(c: Cmd, p: ReturnType<typeof parseArgs>): Sock[] {
  const all = has(p, "a");
  const listening = has(p, "l");
  const tcp = has(p, "t");
  const udp = has(p, "u");
  return sockets(c).filter((s) => {
    if (tcp !== udp && (tcp ? s.proto !== "tcp" : s.proto !== "udp")) return false;
    if (all) return true;
    return listening ? s.state !== "ESTAB" : s.state === "ESTAB";
  });
}

const SS_SUPPORTED = "-t -u -l -n -p -a -H -4 -6 -r -e (소켓 목록; 필터 식은 안 돼요)";
/** The words a real ss filter starts with (`ss -tn state established`, `sport = :22`, `( dport = :80 )`). */
const SS_FILTER_WORDS = new Set(
  "state exclude dst src dport sport dev fwmark cgroup autobound not and or (".split(" "),
);

function ssFilterRefusal(rest: readonly string[]): R {
  const first = (rest[0] ?? "").toLowerCase();
  if (!SS_FILTER_WORDS.has(first))
    return fail(`Error: an inet prefix is expected rather than "${rest[0]}".`, 1);
  return emulationGap({
    tool: "ss",
    feature: "filter",
    what: `필터 ${rest.join(" ")}`,
    supported: SS_SUPPORTED,
    example: "ss -tln",
  });
}

export function ss(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "tulnpaH46sre", long: {} });
  if (p.bad) return badFlag("ss", p);
  if (has(p, "s"))
    return emulationGap({
      tool: "ss",
      feature: "flag:-s",
      what: "-s",
      supported: SS_SUPPORTED,
      example: "ss -tln",
    });
  if (p.rest.length > 0) return ssFilterRefusal(p.rest);
  const rows = pickSockets(c, p).map((s) => {
    const who = has(p, "p") ? `  users:(("${s.proc}",pid=${s.pid},fd=${3 + (s.port % 7)}))` : "";
    const state = s.state === "ESTAB" ? "ESTAB " : s.state === "UNCONN" ? "UNCONN" : "LISTEN";
    return `${has(p, "u") && !has(p, "t") ? "udp " : has(p, "a") ? `${s.proto} ` : ""}${state} 0      ${s.state === "LISTEN" ? "128" : "0  "}  ${s.local.padStart(21)} ${s.peer.padStart(21)}${who}`;
  });
  const showHead = !has(p, "H");
  const netid = has(p, "a") || (has(p, "u") && has(p, "t"));
  const head = `${netid ? "Netid " : ""}State  Recv-Q Send-Q ${"Local Address:Port".padStart(21)} ${"Peer Address:Port".padStart(21)}${has(p, "p") ? " Process" : ""}`;
  return ok(joinLines([...(showHead ? [head] : []), ...rows]));
}

export function netstat(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "tulnpaer46", long: {} });
  if (p.bad) return badFlag("netstat", p);
  if (has(p, "r")) return ok(routeTable(c));
  const rows = pickSockets(c, p).map((s) => {
    const prog = has(p, "p") ? `${s.pid}/${s.proc}` : "";
    return `${s.proto.padEnd(5)}  0      0 ${s.local.padEnd(23)} ${s.peer.padEnd(23)} ${(s.state === "ESTAB" ? "ESTABLISHED" : s.state === "UNCONN" ? "" : "LISTEN").padEnd(11)} ${prog}`.trimEnd();
  });
  const title =
    has(p, "l") && !has(p, "a")
      ? "Active Internet connections (only servers)"
      : "Active Internet connections (w/o servers)";
  return ok(
    joinLines([
      title,
      `Proto Recv-Q Send-Q Local Address           Foreign Address         State       ${has(p, "p") ? "PID/Program name" : ""}`.trimEnd(),
      ...rows,
    ]),
  );
}

const gateway = (ip: string): string => `${ip.split(".").slice(0, 3).join(".")}.1`;

function routeTable(c: Cmd): string {
  const net = `${c.h.ip.split(".").slice(0, 3).join(".")}.0`;
  return joinLines([
    "Kernel IP routing table",
    "Destination     Gateway         Genmask         Flags   MSS Window  irtt Iface",
    `0.0.0.0         ${gateway(c.h.ip).padEnd(15)} 0.0.0.0         UG        0 0          0 eth0`,
    `${net.padEnd(15)} 0.0.0.0         255.255.255.0   U         0 0          0 eth0`,
  ]);
}

export function ip(c: Cmd): R {
  const flags = c.args.filter((a) => a.startsWith("-"));
  const brief = flags.some((f) => f === "-br" || f === "-brief" || f === "-o");
  const [obj = "addr"] = c.args.filter((a) => !a.startsWith("-"));
  const mac = `52:54:00:${[1, 2, 3].map((k) => (hash53(`${c.h.id}|mac${k}`) % 256).toString(16).padStart(2, "0")).join(":")}`;
  if (/^a(ddr(ess)?)?$/.test(obj)) {
    if (brief)
      return ok(
        `lo               UNKNOWN        127.0.0.1/8\neth0             UP             ${c.h.ip}/24\n`,
      );
    return ok(
      joinLines([
        "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000",
        "    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00",
        "    inet 127.0.0.1/8 scope host lo",
        "2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000",
        `    link/ether ${mac} brd ff:ff:ff:ff:ff:ff`,
        `    inet ${c.h.ip}/24 brd ${c.h.ip.split(".").slice(0, 3).join(".")}.255 scope global eth0`,
      ]),
    );
  }
  if (/^r(oute)?$/.test(obj))
    return ok(
      joinLines([
        `default via ${gateway(c.h.ip)} dev eth0 proto static metric 100`,
        `${c.h.ip.split(".").slice(0, 3).join(".")}.0/24 dev eth0 proto kernel scope link src ${c.h.ip} metric 100`,
      ]),
    );
  if (/^l(ink)?$/.test(obj))
    return ok(
      joinLines([
        "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000",
        "    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00",
        "2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP mode DEFAULT group default qlen 1000",
        `    link/ether ${mac} brd ff:ff:ff:ff:ff:ff`,
      ]),
    );
  return ipRefusal(obj);
}

/** The objects of the real ip (iproute2 `ip help`); the fake has addr, route and link. */
const REAL_IP_OBJECTS =
  "address addrlabel fou ila ioam l2tp link macsec maddress monitor mptcp mroute mrule neighbor neighbour netconf netns nexthop ntable ntbl route rule sr tap tcpmetrics token tunnel tuntap vrf xfrm".split(
    " ",
  );

function ipRefusal(obj: string): R {
  const real = REAL_IP_OBJECTS.find((o) => o.startsWith(obj));
  if (!real) return fail(`Object "${obj}" is unknown, try "ip help".`, 1);
  return emulationGap({
    tool: "ip",
    feature: `object:${real}`,
    what: `ip ${obj}`,
    supported: "ip addr, ip route, ip link (-br -o)",
    example: "ip -br addr",
  });
}

const LSOF_HEAD = "COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME";

export function lsof(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "nPtl", val: "ipicu", long: {} });
  if (p.bad) return badFlag("lsof", p);
  const table = processTable(c.h);
  const row = (
    cmd: string,
    pid: number,
    user: string,
    fd: string,
    type: string,
    name: string,
  ): string =>
    `${cmd.padEnd(9)} ${String(pid).padStart(3)} ${user.padEnd(6)} ${fd.padEnd(4)} ${type.padEnd(4)} 0t0 ${name}`.replace(
      /^/,
      "",
    );
  const iFlag = p.flags.get("i");
  if (iFlag !== undefined || has(p, "i")) {
    const port = /:(\d+)$/.exec(iFlag ?? "")?.[1];
    const rows = sockets(c)
      .filter(
        (s) => s.proto === "tcp" && s.state !== "UNCONN" && (!port || s.port === Number(port)),
      )
      .map((s) =>
        row(
          s.proc,
          s.pid,
          "root",
          "3u",
          "IPv4",
          `${s.local}${s.state === "ESTAB" ? `->${s.peer}` : ""} (${s.state === "ESTAB" ? "ESTABLISHED" : "LISTEN"})`,
        ),
      );
    return rows.length ? ok(joinLines([LSOF_HEAD, ...rows])) : { out: "", code: 1 };
  }
  const pid = p.flags.get("p");
  if (pid !== undefined) {
    const proc = table.find((r) => r.pid === Number(pid));
    if (!proc) return fail(`lsof: no process ID ${pid}`, 1);
    return ok(
      joinLines([
        LSOF_HEAD,
        row(proc.comm, proc.pid, proc.user, "cwd", "DIR", "/"),
        row(proc.comm, proc.pid, proc.user, "txt", "REG", proc.args.split(" ")[0] ?? ""),
        row(proc.comm, proc.pid, proc.user, "1u", "unix", "socket"),
      ]),
    );
  }
  const file = p.rest[0];
  if (!file)
    return emulationGap({
      tool: "lsof",
      feature: "no-arguments",
      what: "인자 없이 (모든 열린 파일)",
      supported: "-i[:포트] -P -n -t -l, -p PID, 파일 경로",
      example: "lsof -i -P -n",
    });
  const path = normalize(c.cwd, file);
  const owner = table.find((r) => r.unit && path.startsWith(`/var/log/${r.unit}/`));
  return owner
    ? ok(joinLines([LSOF_HEAD, row(owner.comm, owner.pid, owner.user, "4w", "REG", path)]))
    : { out: "", code: 1 };
}
