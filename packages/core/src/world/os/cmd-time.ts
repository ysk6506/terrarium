/** Clock and certificate commands of the fake shell: timedatectl, chronyc, openssl x509 (ADR-0117 decisions 1, 4 and 7). */

import { chronycTracking } from "./chrony";
import { dateAt, OS_EPOCH_MS, sdStamp } from "./clock";
import { normalize } from "./fs";
import { skewAt } from "./journal";
import { NTP_SOURCE } from "./layout";
import { genuineOption } from "./real-options";
import { type Cmd, emulationGap, fail, joinLines, ok, type R } from "./types";

/** Commands of the real timedatectl (systemd man page) other than status and show. */
const REAL_TIMEDATECTL = new Set(
  "set-time set-timezone list-timezones set-local-rtc set-ntp timesync-status show-timesync".split(
    " ",
  ),
);

function timedatectlRefusal(verb: string): R {
  if (!REAL_TIMEDATECTL.has(verb)) return fail(`Unknown command verb '${verb}'.`, 1);
  return emulationGap({
    tool: "timedatectl",
    feature: `command:${verb}`,
    what: verb,
    supported: "timedatectl status, timedatectl show",
    example: "timedatectl status",
  });
}

export function timedatectl(c: Cmd): R {
  const verb = c.args.find((a) => !a.startsWith("-")) ?? "status";
  if (verb !== "status" && verb !== "show") return timedatectlRefusal(verb);
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

function chronycSources(c: Cmd): string {
  const off = c.h.os.ntpOffsetS;
  const synced = Math.abs(off) < 1;
  return joinLines([
    "MS Name/IP address         Stratum Poll Reach LastRx Last sample",
    "===============================================================================",
    `^${synced ? "*" : "?"} ${NTP_SOURCE.padEnd(26)} ${synced ? " 2" : " 0"}   6   377    ${synced ? "38" : "9m"}  ${synced ? `${Math.round(off * 1e6)}us[${Math.round(off * 1e6)}us] +/-   12ms` : `${(off * 1000).toFixed(0)}ms[${(off * 1000).toFixed(0)}ms] +/-   12ms`}`,
  ]);
}

export function chronyc(c: Cmd): R {
  const verb = c.args[0];
  if (verb === "tracking") return ok(chronycTracking(c.h));
  if (verb === "sources" || verb === "sourcestats") return ok(chronycSources(c));
  if (verb?.startsWith("-")) return genuineOption("chronyc", verb);
  if (verb !== undefined && !REAL_CHRONYC.has(verb)) return fail("501 Not implemented", 1);
  return emulationGap({
    tool: "chronyc",
    feature: verb === undefined ? "interactive" : `command:${verb}`,
    what: verb === undefined ? "대화형 모드" : `chronyc ${verb}`,
    supported: "chronyc tracking, chronyc sources, chronyc sourcestats",
    example: "chronyc tracking",
  });
}

/** Commands of the real chronyc (chrony 4 manual) other than the three the fake has. */
const REAL_CHRONYC = new Set(
  "accheck activity add allow authdata burst clients cmdaccheck cmdallow cmddeny delete deny dns dump keygen local makestep manual maxdelay maxpoll minpoll minstratum ntpdata offline online refresh rekey reselect reselectdist reset retries rtcdata selectdata serverstats settime shutdown smoothing smoothtime sourcename tracking trimrtc waitsync writertc".split(
    " ",
  ),
);

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

const OPENSSL_SUPPORTED =
  "openssl x509 -in 파일 -noout -dates|-enddate|-startdate|-subject|-issuer -checkend 초";
const OPENSSL_EXAMPLE = "openssl x509 -in /etc/pki/tls/certs/server.crt -noout -enddate";

/** Subcommands of the real openssl (`openssl help`, 3.x) other than x509; the fake has only x509. */
const REAL_OPENSSL = new Set(
  "asn1parse ca ciphers cms crl crl2pkcs7 dgst dhparam dsa dsaparam ec ecparam enc engine errstr gendsa genpkey genrsa help info list nseq ocsp passwd pkcs12 pkcs7 pkcs8 pkey pkeyparam pkeyutl prime rand rehash req rsa rsautl s_client s_server s_time sess_id smime speed spkac srp storeutl ts verify version".split(
    " ",
  ),
);
/** Options of `openssl x509` (3.x `openssl x509 -help`) the fake does not read. */
const REAL_X509 = new Set(
  "-text -fingerprint -serial -hash -subject_hash -issuer_hash -pubkey -modulus -purpose -ocsp_uri -email -nameopt -certopt -days -out -inform -outform -keyform -passin -sha1 -sha256 -sha384 -sha512 -md5 -signkey -req -CA -CAkey -CAserial -CAcreateserial -x509toreq -set_serial -trustout -clrtrust -addtrust -alias -noout -dates -enddate -startdate -subject -issuer -checkend -in -extfile -extensions -force_pubkey -checkhost -checkemail -checkip -ext -subject_hash_old -issuer_hash_old".split(
    " ",
  ),
);

function opensslCommandRefusal(verb: string | undefined): R {
  if (verb !== undefined && !REAL_OPENSSL.has(verb))
    return fail(`Invalid command '${verb}'; type "help" for a list.`, 1);
  return emulationGap({
    tool: "openssl",
    feature: verb === undefined ? "interactive" : `subcommand:${verb}`,
    what: verb === undefined ? "대화형 모드" : `openssl ${verb}`,
    supported: OPENSSL_SUPPORTED,
    example: OPENSSL_EXAMPLE,
  });
}

function x509OptionRefusal(option: string): R {
  if (!REAL_X509.has(option))
    return fail(`x509: Unknown option: ${option}\nx509: Use -help for summary.`, 1);
  return emulationGap({
    tool: "openssl",
    feature: `x509:${option}`,
    what: `x509 ${option}`,
    supported: OPENSSL_SUPPORTED,
    example: OPENSSL_EXAMPLE,
  });
}

export function openssl(c: Cmd): R {
  if (c.args[0] !== "x509") return opensslCommandRefusal(c.args[0]);
  const o = x509Options(c.args.slice(1));
  if (o.bad) return x509OptionRefusal(o.bad);
  const unsupported = ["-text", "-fingerprint"].find((f) => o.on.has(f));
  if (unsupported) return x509OptionRefusal(unsupported);
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
