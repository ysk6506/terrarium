/** Clock and certificate commands of the fake shell: timedatectl, chronyc, openssl x509 (ADR-0117 decisions 1, 4 and 7). */

import { chronycTracking } from "./chrony";
import { dateAt, OS_EPOCH_MS, sdStamp } from "./clock";
import { normalize } from "./fs";
import { skewAt } from "./journal";
import { NTP_SOURCE } from "./layout";
import { type Cmd, fail, joinLines, ok, type R, unsupported } from "./types";

export function timedatectl(c: Cmd): R {
  const verb = c.args.find((a) => !a.startsWith("-")) ?? "status";
  if (verb !== "status" && verb !== "show") return unsupported("timedatectl", verb);
  const skew = skewAt(c.h, c.h.t);
  const local = `${sdStamp(dateAt(c.h.t, skew))} UTC`;
  const synced = Math.abs(skew) < 1;
  if (verb === "show")
    return ok(
      joinLines([
        "Timezone=UTC",
        "LocalRTC=no",
        `NTPSynchronized=${synced ? "yes" : "no"}`,
        "NTP=yes",
      ]),
    );
  return ok(
    joinLines([
      `               Local time: ${local}`,
      `           Universal time: ${local}`,
      `                 RTC time: ${sdStamp(dateAt(c.h.t)).replace(/^\w+ /, "")}`,
      "                Time zone: UTC (UTC, +0000)",
      `System clock synchronized: ${synced ? "yes" : "no"}`,
      "              NTP service: active",
      "          RTC in local TZ: no",
    ]),
  );
}

export function chronyc(c: Cmd): R {
  const verb = c.args[0];
  if (verb === "tracking") return ok(chronycTracking(c.h));
  if (verb === "sources" || verb === "sourcestats") {
    const off = c.h.os.ntpOffsetS;
    const synced = Math.abs(off) < 1;
    return ok(
      joinLines([
        "MS Name/IP address         Stratum Poll Reach LastRx Last sample",
        "===============================================================================",
        `^${synced ? "*" : "?"} ${NTP_SOURCE.padEnd(26)} ${synced ? " 2" : " 0"}   6   377    ${synced ? "38" : "9m"}  ${synced ? `${Math.round(off * 1e6)}us[${Math.round(off * 1e6)}us] +/-   12ms` : `${(off * 1000).toFixed(0)}ms[${(off * 1000).toFixed(0)}ms] +/-   12ms`}`,
      ]),
    );
  }
  return unsupported("chronyc", verb ?? "(대화형)");
}

const MONTHS: Readonly<Record<string, number>> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

/** `Nov  5 09:12:44 2026 GMT` as epoch seconds. */
function certEpoch(text: string): number | undefined {
  const m = /^(\w{3})\s+(\d+)\s+(\d\d):(\d\d):(\d\d)\s+(\d{4})/.exec(text.trim());
  if (!m || MONTHS[m[1] as string] === undefined) return undefined;
  return (
    Date.UTC(
      Number(m[6]),
      MONTHS[m[1] as string] as number,
      Number(m[2]),
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
    ) / 1000
  );
}

/** The single-dash options of `openssl x509`; each is a switch or takes the next word. */
const X509_SWITCH = new Set([
  "-noout",
  "-dates",
  "-enddate",
  "-startdate",
  "-subject",
  "-issuer",
  "-text",
  "-fingerprint",
]);
const X509_VALUE = new Set(["-in", "-checkend"]);

function x509Options(args: readonly string[]): {
  on: Set<string>;
  value: Map<string, string>;
  bad?: string;
} {
  const on = new Set<string>();
  const value = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (X509_SWITCH.has(a)) on.add(a);
    else if (X509_VALUE.has(a)) value.set(a, args[++i] ?? "");
    else return { on, value, bad: a };
  }
  return { on, value };
}

/** The lines `openssl x509` prints for the switches given. */
function x509Lines(o: { on: Set<string> }, field: (k: string) => string): string[] {
  const out: string[] = [];
  if (o.on.has("-dates") || o.on.has("-startdate")) out.push(`notBefore=${field("notBefore")}`);
  if (o.on.has("-dates") || o.on.has("-enddate")) out.push(`notAfter=${field("notAfter")}`);
  if (o.on.has("-subject")) out.push(`subject=${field("subject")}`);
  if (o.on.has("-issuer")) out.push(`issuer=${field("issuer")}`);
  return out;
}

/** `-checkend N`: whether the certificate is still valid N seconds from the host's clock. */
function checkEnd(c: Cmd, notAfter: string, ahead: string): R {
  const end = certEpoch(notAfter);
  const now = c.h.t + skewAt(c.h, c.h.t) + OS_EPOCH_MS / 1000;
  const expires = end === undefined || end < now + Number(ahead);
  return { out: `Certificate will ${expires ? "" : "not "}expire\n`, code: expires ? 1 : 0 };
}

export function openssl(c: Cmd): R {
  if (c.args[0] !== "x509") return unsupported("openssl", c.args[0] ?? "(대화형)");
  const o = x509Options(c.args.slice(1));
  if (o.bad) return unsupported("openssl x509", o.bad);
  if (o.on.has("-text") || o.on.has("-fingerprint"))
    return unsupported("openssl x509", "-text/-fingerprint");
  const file = o.value.get("-in");
  if (!file) return fail("openssl x509: no input file (-in)", 1);
  const text = c.fs.read(normalize(c.cwd, file));
  if (text === undefined)
    return fail(`Could not open file or uri for loading certificate from ${file}`, 1);
  const field = (k: string): string => new RegExp(`^# ${k}=(.*)$`, "m").exec(text)?.[1] ?? "";
  const ahead = o.value.get("-checkend");
  return ahead !== undefined
    ? checkEnd(c, field("notAfter"), ahead)
    : ok(joinLines(x509Lines(o, field)));
}
