/**
 * IPv4 addresses the way a switch handles them (REQ-064, ADR-0061): dotted text in, a 32-bit number to compare,
 * prefix lengths and netmasks. Everything else in the network model (subnets, routes, ARP) is built on these.
 */
import { hashHex } from "@terrarium/core/kernel";

/** A locally administered MAC address for a device (and a port of it), in the `0200.1234.5678` form switches print. */
export function macOf(id: string, n = 0): string {
  const h = hashHex(`mac:${id}:${n}`);
  const hex = ["02", ...[0, 2, 4, 6, 8].map((i) => h.slice(i, i + 2))].join("");
  return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8, 12)}`;
}

/** `10.1.2.3` as a number, or undefined when it is not four 0–255 parts. */
export function ipToInt(text: string): number | undefined {
  const parts = text.split(".");
  if (parts.length !== 4) return undefined;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const byte = Number(part);
    if (byte > 255) return undefined;
    n = n * 256 + byte;
  }
  return n;
}

export function intToIp(n: number): string {
  return [(n / 16777216) & 255, (n / 65536) & 255, (n / 256) & 255, n & 255].join(".");
}

/** The first address of the subnet an address with this prefix length is in. */
export function networkOf(ip: number, len: number): number {
  if (len <= 0) return 0;
  const block = 2 ** (32 - len);
  return Math.floor(ip / block) * block;
}

export const inSubnet = (ip: number, net: number, len: number): boolean =>
  networkOf(ip, len) === networkOf(net, len);

/** `255.255.255.0` → 24; undefined when the mask is not a run of ones followed by zeros. */
export function maskToLen(mask: string): number | undefined {
  const n = ipToInt(mask);
  if (n === undefined) return undefined;
  for (let len = 0; len <= 32; len++) if (lenToMaskInt(len) === n) return len;
  return undefined;
}

const lenToMaskInt = (len: number): number => (len === 0 ? 0 : 2 ** 32 - 2 ** (32 - len));
export const lenToMask = (len: number): string => intToIp(lenToMaskInt(len));

/** The wildcard form NX-OS/IOS use in some places (`0.0.0.255` for /24). */
export const lenToWildcard = (len: number): string => intToIp(2 ** 32 - 1 - lenToMaskInt(len));

export interface Cidr {
  readonly net: number;
  readonly len: number;
}

/** `10.1.2.0/24`, or a lone address (a /32); undefined when it is neither. */
export function parseCidr(text: string): Cidr | undefined {
  const [addr = "", rest] = text.split("/");
  const ip = ipToInt(addr);
  if (ip === undefined) return undefined;
  if (rest === undefined) return { net: ip, len: 32 };
  if (!/^\d{1,2}$/.test(rest) || Number(rest) > 32) return undefined;
  return { net: networkOf(ip, Number(rest)), len: Number(rest) };
}

export const cidrText = (c: Cidr): string => `${intToIp(c.net)}/${c.len}`;

/** An address with its prefix as typed (`10.1.2.3/24`): the host address is kept, not rounded to the network. */
export function parseHostCidr(text: string): { ip: number; len: number } | undefined {
  const [addr = "", rest] = text.split("/");
  const ip = ipToInt(addr);
  if (ip === undefined || rest === undefined || !/^\d{1,2}$/.test(rest) || Number(rest) > 32)
    return undefined;
  return { ip, len: Number(rest) };
}
