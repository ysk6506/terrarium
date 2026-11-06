/** Number and mode formats shared by `ls`, `du`, `df`, `stat` and `find`. */
import { dateAt, lsStamp } from "./clock";
import type { FsStat } from "./fs";

/** `4.0K`, `12M`, `1.3G`: the way `-h` prints a size (1024-based, rounded up like `du`). */
export function human(bytes: number, round = "up"): string {
  const units = ["", "K", "M", "G", "T"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  if (u === 0) return String(bytes);
  const scaled = round === "up" ? Math.ceil(v * 10) / 10 : Math.round(v * 10) / 10;
  return `${v >= 10 ? Math.ceil(v) : scaled.toFixed(1)}${units[u]}`;
}

/** `-rw-r--r--` for a mode. */
export function modeText(type: FsStat["type"], mode: number): string {
  const bits = "rwxrwxrwx";
  let s = type === "d" ? "d" : type === "l" ? "l" : "-";
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? bits.charAt(i) : "-";
  return s;
}

/** Disk blocks of 1 KiB a file takes (rounded up to 4 KiB). */
export const blocks1k = (bytes: number): number => Math.ceil(bytes / 4096) * 4;

/** One line of `ls -l`. */
export function longLine(name: string, st: FsStat, human_ = false): string {
  const size = human_ ? human(st.size) : String(st.size);
  const links = st.type === "d" ? 2 : 1;
  const shown = st.type === "l" && st.target ? `${name} -> ${st.target}` : name;
  return `${modeText(st.type, st.mode)} ${links} ${st.owner.padEnd(8)} ${st.group.padEnd(8)} ${size.padStart(10)} ${lsStamp(dateAt(st.mtime))} ${shown}`;
}
