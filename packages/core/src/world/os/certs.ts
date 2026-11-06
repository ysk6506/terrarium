/** The certificates of a fake host (ADR-0117): readable dates in the file, the same dates for `openssl x509`. */
import { hash53 } from "@terrarium/core/kernel";
import { certDate, dateAt } from "./clock";
import { certExpiry } from "./events-fault";
import { activeSpan, culpritName, type OsHost } from "./host";

const DAY = 86_400;

export interface CertWindow {
  /** World times. */
  readonly notBefore: number;
  readonly notAfter: number;
}

/** The validity of the certificate a process presents: past while a `cert_expired` fault is on, far off otherwise. */
export function certWindow(h: OsHost, proc: string): CertWindow {
  const expired = proc === culpritName(h) ? activeSpan(h, "cert_expired") : undefined;
  return {
    notBefore: -300 * DAY,
    notAfter: expired ? certExpiry(expired) : 700 * DAY,
  };
}

export const notAfterText = (w: CertWindow): string => certDate(dateAt(w.notAfter));
export const notBeforeText = (w: CertWindow): string => certDate(dateAt(w.notBefore));

/** The processes that have a certificate file: the services here. */
export const certNames = (h: OsHost): string[] => h.services.map((s) => s.process);

function body(h: OsHost, proc: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  return Array.from({ length: 6 }, (_, row) =>
    Array.from({ length: 64 }, (_, i) => alphabet[hash53(`${h.id}|${proc}|${row}|${i}`) % 64]).join(
      "",
    ),
  ).join("\n");
}

/** The PEM file, with the dates in a header comment so `cat` shows them. */
export function pemText(h: OsHost, proc: string): string {
  const w = certWindow(h, proc);
  return [
    `# subject=CN=${proc}.dc.local`,
    "# issuer=CN=Terrarium Internal CA",
    `# notBefore=${notBeforeText(w)}`,
    `# notAfter=${notAfterText(w)}`,
    "-----BEGIN CERTIFICATE-----",
    body(h, proc),
    "-----END CERTIFICATE-----",
    "",
  ].join("\n");
}
