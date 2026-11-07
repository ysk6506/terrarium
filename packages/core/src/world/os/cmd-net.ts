/** Network commands of the fake shell: ping, curl, dig, nslookup (ADR-0117 decision 4). Answers follow the same state as the services. */

import { hash53 } from "@terrarium/core/kernel";
import { serviceDef } from "../service";
import { hostVerdict } from "../service-health";
import { has, parseArgs } from "./args";
import { ctime, dateAt } from "./clock";
import { lbHealthReply } from "./cmd-lb";
import { skewAt } from "./journal";
import { portOf } from "./layout";
import { addressOf, IP, pingable, resolveName, resolverAnswers, resolverOf } from "./net-names";
import { type Cmd, fail, joinLines, ok, type R, unsupported } from "./types";

// ── ping ────────────────────────────────────────────────────────────────────────────────────

export function ping(c: Cmd): R {
  const p = parseArgs(c.args, { bool: "nqA46", val: "cWwisI" });
  if (p.bad) return unsupported("ping", p.bad);
  const count = Math.min(Number(p.flags.get("c") ?? 4) || 4, 10);
  const target = p.rest[0];
  if (!target) return fail("ping: usage error: Destination address required", 2);
  if (!IP.test(target) && !c.h.os.dnsOk)
    return fail(`ping: ${target}: Name or service not known`, 2);
  const found = resolveName(c.h.world, target);
  if (!found)
    return IP.test(target)
      ? lost(target, target, count, c)
      : fail(`ping: ${target}: Name or service not known`, 2);
  const ip = addressOf(c.h.world, found);
  return pingable(c.h.world, found.id) ? replies(target, ip, count) : lost(target, ip, count, c);
}

function replies(target: string, ip: string, count: number): R {
  const rows = Array.from(
    { length: count },
    (_, i) =>
      `64 bytes from ${target} (${ip}): icmp_seq=${i + 1} ttl=63 time=0.${380 + ((i * 37) % 90)} ms`,
  );
  return ok(
    joinLines([
      `PING ${target} (${ip}) 56(84) bytes of data.`,
      ...rows,
      "",
      `--- ${target} ping statistics ---`,
      `${count} packets transmitted, ${count} received, 0% packet loss, time ${(count - 1) * 1001}ms`,
      "rtt min/avg/max/mdev = 0.380/0.412/0.447/0.021 ms",
    ]),
  );
}

function lost(target: string, ip: string, count: number, c: Cmd): R {
  const rows = Array.from(
    { length: count },
    (_, i) => `From ${c.h.ip} icmp_seq=${i + 1} Destination Host Unreachable`,
  );
  return {
    out: joinLines([
      `PING ${target} (${ip}) 56(84) bytes of data.`,
      ...rows,
      "",
      `--- ${target} ping statistics ---`,
      `${count} packets transmitted, 0 received, +${count} errors, 100% packet loss, time ${count * 1000}ms`,
    ]),
    code: 1,
  };
}

// ── curl ────────────────────────────────────────────────────────────────────────────────────

type Reply =
  | {
      readonly kind: "http";
      readonly code: string;
      readonly headers: string[];
      readonly body: string;
    }
  | { readonly kind: "error"; readonly exit: number; readonly message: string };

const header = (code: string, extra: string[] = []): string[] => [
  `HTTP/1.1 ${code}`,
  "Server: nginx",
  "Content-Type: text/html",
  ...extra,
];

function serviceReply(c: Cmd, serviceId: string, host: string, port: number): Reply {
  const { world } = c.h;
  const state = world.stateAs(serviceId, "service");
  const def = serviceDef(world.index.entity(serviceId));
  if (state.status === "healthy")
    return {
      kind: "http",
      code: "200 OK",
      headers: header("200 OK", ["X-Response-Time: 38ms"]),
      body: '{"status":"ok"}',
    };
  if (state.status === "degraded")
    return {
      kind: "http",
      code: "200 OK",
      headers: header("200 OK", ["X-Response-Time: 2310ms"]),
      body: '{"status":"degraded"}',
    };
  const cause = state.runsOn
    .map((h) => hostVerdict(world, h, def))
    .find((v) => v.state === "dead")?.cause;
  const http = (code: string, extra: string[] = []): Reply => ({
    kind: "http",
    code,
    headers: header(code, extra),
    body: "",
  });
  if (cause === "cert")
    return {
      kind: "error",
      exit: 60,
      message: "curl: (60) SSL certificate problem: certificate has expired",
    };
  if (cause === "ntp")
    return http("401 Unauthorized", [
      "WWW-Authenticate: Negotiate",
      "X-Reason: clock skew too great",
    ]);
  if (cause === "dns") return http("502 Bad Gateway");
  if (cause === "disk" || cause === "fs") return http("500 Internal Server Error");
  if (cause === "process" || cause === "zombie" || cause === "memory")
    return {
      kind: "error",
      exit: 7,
      message: `curl: (7) Failed to connect to ${host} port ${port}: Connection refused`,
    };
  return {
    kind: "error",
    exit: 28,
    message: "curl: (28) Connection timed out after 5001 milliseconds",
  };
}

function target(c: Cmd, host: string): { service: string } | undefined {
  if (host === "localhost" || host === "127.0.0.1") {
    const first = c.h.services[0];
    return first ? { service: first.id } : undefined;
  }
  const found = resolveName(c.h.world, host);
  return found?.service ? { service: found.service } : undefined;
}

export function curl(c: Cmd): R {
  const p = parseArgs(c.args, {
    bool: "sSkLIivfgs",
    val: "oXwmdHAuT",
    long: {
      head: "bool",
      silent: "bool",
      "max-time": "val",
      "write-out": "val",
      output: "val",
      insecure: "bool",
      location: "bool",
      fail: "bool",
      "show-error": "bool",
      "connect-timeout": "val",
    },
  });
  if (p.bad) return unsupported("curl", p.bad);
  const url = p.rest[0];
  if (!url) return fail("curl: try 'curl --help' for more information", 2);
  if (p.flags.has("X") || p.flags.has("d") || has(p, "v") || p.flags.has("T"))
    return unsupported("curl", "POST·-v 같은 옵션");
  const host =
    url
      .replace(/^\w+:\/\//, "")
      .replace(/^[^@/]*@/, "")
      .split(/[/:?]/)[0] ?? "";
  const https = url.startsWith("https");
  const port = Number(/^\w+:\/\/[^/:]+:(\d+)/.exec(url)?.[1] ?? (https ? 443 : 80));
  const path = /^\w+:\/\/[^/]+(\/[^?#]*)/.exec(url)?.[1] ?? "/";
  const reply = lookupReply(c, host, port, path);
  return formatCurl(p, reply);
}

function lookupReply(c: Cmd, host: string, port: number, path: string): Reply {
  const local = host === "localhost" || host === "127.0.0.1";
  if (!IP.test(host) && !local && !c.h.os.dnsOk)
    return { kind: "error", exit: 6, message: `curl: (6) Could not resolve host: ${host}` };
  const t = target(c, host);
  const listens = (id: string): boolean => {
    const proc = c.h.world.index.find(id) ? serviceDef(c.h.world.index.entity(id)).process : "";
    return [80, 443, portOf(proc)].includes(port);
  };
  if (!t || !listens(t.service))
    return {
      kind: "error",
      exit: 7,
      message: `curl: (7) Failed to connect to ${host} port ${port}: Connection refused`,
    };
  const health = path === "/healthz" ? lbHealthReply(c.h.world, t.service) : undefined;
  if (health) return { kind: "http", ...health };
  return serviceReply(c, t.service, host, port);
}

/** The standard error of a failed curl: shown unless `-s`, and always with `-S`. */
function curlError(p: ReturnType<typeof parseArgs>, reply: Extract<Reply, { kind: "error" }>): R {
  const quiet = has(p, "s") || has(p, "--silent");
  const shown = !quiet || has(p, "S") || has(p, "--show-error");
  return { out: "", err: shown ? `${reply.message}\n` : "", code: reply.exit };
}

function formatCurl(p: ReturnType<typeof parseArgs>, reply: Reply): R {
  if (reply.kind === "error") return curlError(p, reply);
  const head = has(p, "I") || has(p, "--head");
  const sink = p.flags.get("o") ?? p.flags.get("--output");
  const writeOut = p.flags.get("w") ?? p.flags.get("--write-out");
  const text = head ? joinLines(reply.headers) : reply.body === "" ? "" : `${reply.body}\n`;
  const extra = writeOut
    ? writeOut.replace(/%\{http_code\}/g, reply.code.slice(0, 3)).replace(/\\n/g, "\n")
    : "";
  const failing = (has(p, "f") || has(p, "--fail")) && /^[45]/.test(reply.code);
  return { out: `${sink === "/dev/null" ? "" : text}${extra}`, code: failing ? 22 : 0 };
}

// ── dig / nslookup ──────────────────────────────────────────────────────────────────────────

interface DnsAnswer {
  readonly server: string;
  readonly status: "NOERROR" | "NXDOMAIN" | "TIMEOUT";
  readonly name: string;
  readonly ip?: string;
}

function query(c: Cmd, name: string, via?: string): DnsAnswer {
  const server = via ?? resolverOf(c.fs.read("/etc/resolv.conf"));
  const usable = resolverAnswers(server) && (via !== undefined || c.h.os.dnsOk);
  const fqdn = name.includes(".") ? name : `${name}.dc.local`;
  if (!usable) return { server, status: "TIMEOUT", name: fqdn };
  const found = resolveName(c.h.world, name);
  return found
    ? { server, status: "NOERROR", name: fqdn, ip: addressOf(c.h.world, found) }
    : { server, status: "NXDOMAIN", name: fqdn };
}

export function dig(c: Cmd): R {
  const words = c.args.filter((a) => !a.startsWith("+"));
  const via = words.find((a) => a.startsWith("@"))?.slice(1);
  const name = words.find(
    (a) =>
      !a.startsWith("@") && !a.startsWith("-") && !/^(A|AAAA|MX|TXT|NS|CNAME|PTR|SOA|ANY)$/.test(a),
  );
  const unknown = c.args.find((a) => a.startsWith("-") && a !== "-4" && a !== "-6" && a !== "-x");
  if (unknown) return unsupported("dig", unknown);
  if (!name) return ok("; <<>> DiG 9.16.23-RH <<>>\n;; global options: +cmd\n");
  const a = query(c, name, via);
  const short = c.args.includes("+short");
  if (a.status === "TIMEOUT")
    return {
      out: short
        ? ";; connection timed out; no servers could be reached\n"
        : `\n; <<>> DiG 9.16.23-RH <<>> ${c.args.join(" ")}\n;; global options: +cmd\n;; connection timed out; no servers could be reached\n\n`,
      code: 9,
    };
  if (short) return ok(a.ip ? `${a.ip}\n` : "");
  const now = ctime(dateAt(c.h.t, skewAt(c.h, c.h.t)));
  const id = hash53(`${c.h.id}|${name}|dig`) % 65_000;
  return ok(
    joinLines([
      "",
      `; <<>> DiG 9.16.23-RH <<>> ${c.args.join(" ")}`,
      ";; global options: +cmd",
      ";; Got answer:",
      `;; ->>HEADER<<- opcode: QUERY, status: ${a.status}, id: ${id}`,
      `;; flags: qr rd ra; QUERY: 1, ANSWER: ${a.ip ? 1 : 0}, AUTHORITY: 0, ADDITIONAL: 1`,
      "",
      ";; QUESTION SECTION:",
      `;${a.name}.\t\tIN\tA`,
      ...(a.ip ? ["", ";; ANSWER SECTION:", `${a.name}.\t300\tIN\tA\t${a.ip}`] : []),
      "",
      ";; Query time: 1 msec",
      `;; SERVER: ${a.server}#53(${a.server})`,
      `;; WHEN: ${now} UTC`,
      `;; MSG SIZE  rcvd: ${a.ip ? 62 : 90}`,
      "",
    ]),
  );
}

export function nslookup(c: Cmd): R {
  const [name, via] = c.args.filter((a) => !a.startsWith("-"));
  if (!name) return unsupported("nslookup", "(대화형)");
  const a = query(c, name, via);
  if (a.status === "TIMEOUT")
    return { out: ";; connection timed out; no servers could be reached\n\n", code: 1 };
  if (a.status === "NXDOMAIN")
    return {
      out: `Server:\t\t${a.server}\nAddress:\t${a.server}#53\n\n** server can't find ${name}: NXDOMAIN\n\n`,
      code: 1,
    };
  return ok(
    `Server:\t\t${a.server}\nAddress:\t${a.server}#53\n\nName:\t${a.name}\nAddress: ${a.ip}\n\n`,
  );
}
