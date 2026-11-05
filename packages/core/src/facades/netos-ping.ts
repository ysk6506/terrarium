/**
 * `ping` and `traceroute` from a switch (REQ-064, ADR-0061), printed the way each OS prints them. The
 * result is the world's: the packet really is followed hop by hop through the VLANs and routes as they are
 * configured now, and the reply must find its way back. Round-trip times are made up from the hop count.
 */
import { hashHex } from "@terrarium/core/kernel";
import {
  type Failure,
  hostIsUp,
  intToIp,
  ipToInt,
  type NetModel,
  type PingResult,
  ping,
  type Trace,
  trace,
  type WorldReader,
} from "@terrarium/core/world";
import type { Result, SwitchView } from "./netos-model";

const COUNT = 5;

/** A round-trip time in ms for one probe: a little per hop plus a repeatable wobble. */
function rtt(dst: number, hops: number, seq: number): number {
  const wobble = parseInt(hashHex(`rtt:${dst}:${seq}`).slice(0, 4), 16) / 65535;
  return Math.round((0.18 + 0.22 * hops + 0.25 * wobble) * 1000) / 1000;
}

/** How a failed ping shows: nothing came back, or a router said so. */
type Outcome =
  | { readonly kind: "ok"; readonly ttl: number; readonly hops: number }
  | { readonly kind: "timeout" }
  | { readonly kind: "unreachable"; readonly from: number; readonly what: "host" | "net" | "ttl" }
  | { readonly kind: "noroute" };

function outcomeOf(result: PingResult): Outcome {
  const f = result.forward;
  if (result.ok)
    return {
      kind: "ok",
      ttl: 64 - (result.back?.hops.length ?? 0),
      hops: f.hops.length + (result.back?.hops.length ?? 0),
    };
  if (f.delivered) return { kind: "timeout" };
  const from = f.hops.at(-1)?.ingress.ip ?? f.srcIp;
  const failure: Failure = f.failure ?? "no-route";
  if (failure === "no-route")
    return f.hops.length === 0 ? { kind: "noroute" } : { kind: "unreachable", from, what: "net" };
  if (failure === "host-unreachable") return { kind: "unreachable", from, what: "host" };
  // A switch has no gateway to miss, so the only other way a packet from one gets lost is a loop.
  return { kind: "unreachable", from, what: "ttl" };
}

const WHAT = {
  host: "Destination Host Unreachable",
  net: "Destination Net Unreachable",
  ttl: "Time to live exceeded",
} as const;

function stats(times: readonly number[]): { min: number; avg: number; max: number; mdev: number } {
  const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
  const mdev = Math.sqrt(times.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, times.length));
  return { min: Math.min(...times), avg, max: Math.max(...times), mdev };
}

const f1 = (n: number): string => n.toFixed(3);

function eosPing(dst: string, ip: number, o: Outcome): string {
  const head = `PING ${dst} (${dst}) 72(100) bytes of data.`;
  if (o.kind === "noroute") return `${head}\nping: connect: Network is unreachable`;
  const lines = Array.from({ length: COUNT }, (_, i) => {
    if (o.kind === "ok")
      return `80 bytes from ${dst}: icmp_seq=${i + 1} ttl=${o.ttl} time=${f1(rtt(ip, o.hops, i))} ms`;
    return o.kind === "unreachable"
      ? `From ${intToIp(o.from)} icmp_seq=${i + 1} ${WHAT[o.what]}`
      : "";
  }).filter((l) => l !== "");
  const times = o.kind === "ok" ? Array.from({ length: COUNT }, (_, i) => rtt(ip, o.hops, i)) : [];
  const got = o.kind === "ok" ? COUNT : 0;
  const loss =
    o.kind === "unreachable"
      ? `+${COUNT} errors, 100%`
      : `${Math.round(100 - (got * 100) / COUNT)}%`;
  const tail =
    o.kind === "ok"
      ? [
          `rtt min/avg/max/mdev = ${f1(stats(times).min)}/${f1(stats(times).avg)}/${f1(stats(times).max)}/${f1(stats(times).mdev)} ms, ipg/ewma 1.0/0.5 ms`,
        ]
      : [];
  return [
    head,
    ...lines,
    "",
    `--- ${dst} ping statistics ---`,
    `${COUNT} packets transmitted, ${got} received, ${loss} packet loss, time ${(COUNT - 1) * 1000}ms`,
    ...tail,
  ].join("\n");
}

function nxosPing(dst: string, ip: number, o: Outcome): string {
  const head = `PING ${dst} (${dst}): 56 data bytes`;
  if (o.kind === "noroute")
    return `${head}\nping: sendto ${dst} 64 chars, No route to host\nRequest 0 timed out`;
  const lines = Array.from({ length: COUNT }, (_, i) =>
    o.kind === "ok"
      ? `64 bytes from ${dst}: icmp_seq=${i} ttl=${o.ttl} time=${f1(rtt(ip, o.hops, i))} ms`
      : `Request ${i} timed out`,
  );
  const times = o.kind === "ok" ? Array.from({ length: COUNT }, (_, i) => rtt(ip, o.hops, i)) : [];
  const got = o.kind === "ok" ? COUNT : 0;
  const tail =
    o.kind === "ok"
      ? [
          `round-trip min/avg/max = ${stats(times).min.toFixed(3)}/${stats(times).avg.toFixed(3)}/${stats(times).max.toFixed(3)} ms`,
        ]
      : [];
  return [
    head,
    ...lines,
    "",
    `--- ${dst} ping statistics ---`,
    `${COUNT} packets transmitted, ${got} packets received, ${(100 - (got * 100) / COUNT).toFixed(2)}% packet loss`,
    ...tail,
  ].join("\n");
}

function iosPing(dst: string, ip: number, o: Outcome): string {
  const marks =
    o.kind === "ok"
      ? "!".repeat(COUNT)
      : o.kind === "unreachable"
        ? "U".repeat(COUNT)
        : ".".repeat(COUNT);
  const got = o.kind === "ok" ? COUNT : 0;
  const times =
    o.kind === "ok"
      ? Array.from({ length: COUNT }, (_, i) => Math.max(1, Math.round(rtt(ip, o.hops, i))))
      : [];
  const tail =
    o.kind === "ok"
      ? `, round-trip min/avg/max = ${Math.min(...times)}/${Math.round(stats(times).avg)}/${Math.max(...times)} ms`
      : "";
  return [
    "Type escape sequence to abort.",
    `Sending ${COUNT}, 100-byte ICMP Echos to ${dst}, timeout is 2 seconds:`,
    marks,
    `Success rate is ${(got * 100) / COUNT} percent (${got}/${COUNT})${tail}`,
  ].join("\n");
}

/** `ping <address>` from a switch. Names are not resolved (no DNS in the world). */
export function runPing(
  v: SwitchView,
  model: NetModel,
  world: WorldReader,
  target: string,
): Result {
  const dst = ipToInt(target);
  if (dst === undefined)
    return {
      text:
        v.os === "iosxe"
          ? "% Unrecognized host or address or protocol not running"
          : `ping: unknown host ${target}`,
    };
  const result = ping(model, { kind: "router", sw: v.entity.id }, dst, (h) => hostIsUp(world, h));
  const o = outcomeOf(result);
  const text =
    v.os === "eos"
      ? eosPing(target, dst, o)
      : v.os === "nxos"
        ? nxosPing(target, dst, o)
        : iosPing(target, dst, o);
  return { text };
}

function traceRows(t: Trace, dst: number): string[][] {
  const hops = t.hops.map((h) => intToIp(h.ingress.ip));
  const rows = hops.map((ip, i) => [ip, ...[0, 1, 2].map((k) => f1(rtt(dst, i + 1, k + i)))]);
  if (t.delivered)
    rows.push([intToIp(dst), ...[0, 1, 2].map((k) => f1(rtt(dst, hops.length + 1, k)))]);
  else for (let i = 0; i < 3; i++) rows.push(["*", "*", "*"]);
  return rows;
}

/** `traceroute <address>`: the routers the packet passes, then the destination, or stars where it stops. */
export function runTraceroute(
  v: SwitchView,
  model: NetModel,
  world: WorldReader,
  target: string,
): Result {
  const dst = ipToInt(target);
  if (dst === undefined)
    return {
      text:
        v.os === "iosxe"
          ? "% Unrecognized host or address or protocol not running"
          : `traceroute: unknown host ${target}`,
    };
  const t = trace(model, { kind: "router", sw: v.entity.id }, dst, (h) => hostIsUp(world, h));
  const rows = traceRows(t, dst);
  if (v.os === "iosxe")
    return {
      text: [
        "Type escape sequence to abort.",
        `Tracing the route to ${target}`,
        "VRF info: (vrf in name/id, vrf out name/id)",
        ...rows.map((r, i) =>
          r[0] === "*"
            ? `  ${i + 1}  *  *  *`
            : `  ${i + 1} ${r[0]} ${Math.round(Number(r[1]))} msec ${Math.round(Number(r[2]))} msec ${Math.round(Number(r[3]))} msec`,
        ),
      ].join("\n"),
    };
  const bytes = v.os === "eos" ? 60 : 40;
  return {
    text: [
      `traceroute to ${target} (${target}), 30 hops max, ${bytes} byte packets`,
      ...rows.map((r, i) =>
        r[0] === "*"
          ? `${String(i + 1).padStart(2)}  * * *`
          : `${String(i + 1).padStart(2)}  ${r[0]} (${r[0]})  ${r[1]} ms  ${r[2]} ms  ${r[3]} ms`,
      ),
    ].join("\n"),
  };
}
