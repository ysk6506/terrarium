/** The text of `chronyc tracking` (ADR-0117): the offset is the host's, so `date`, `timedatectl` and this agree. */
import { dateAt, dateLine } from "./clock";
import type { OsHost } from "./host";
import { skewAt } from "./journal";
import { joinLines } from "./types";

export function chronycTracking(h: OsHost): string {
  const off = h.os.ntpOffsetS;
  return joinLines([
    "Reference ID    : 0A140002 (ntp1.dc.local)",
    "Stratum         : 3",
    `Ref time (UTC)  : ${dateLine(dateAt(h.t, skewAt(h, h.t)))}`,
    `System time     : ${Math.abs(off).toFixed(9)} seconds ${off < 0 ? "slow" : "fast"} of NTP time`,
    `Last offset     : ${off >= 0 ? "+" : "-"}${Math.abs(off).toFixed(9)} seconds`,
    "RMS offset      : 0.000021349 seconds",
    "Frequency       : 3.412 ppm slow",
    `Leap status     : ${Math.abs(off) > 1 ? "Not synchronised" : "Normal"}`,
  ]);
}
