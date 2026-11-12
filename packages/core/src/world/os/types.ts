/** What a shell command receives and returns (ADR-0117 decision 4). */
import { type EmulationGap, type GapNotice, gapOf, gapText } from "../emulation-gap";
import type { HostAction } from "../host-os";
import type { WorldPort } from "../world";
import type { VirtualFs } from "./fs";
import type { OsHost } from "./host";

/** The result of one command: its two output streams, its exit code, and what the fake could not do. */
export interface R {
  readonly out: string;
  readonly err?: string;
  readonly code: number;
  /** Set when the command asked for something outside the simulation (ADR-0117 decision 6). */
  readonly outside?: string;
  /** Set when the real tool can do what was asked and this proving ground cannot (ADR-0184). */
  readonly gap?: EmulationGap;
}

export interface Cmd {
  readonly name: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly h: OsHost;
  readonly fs: VirtualFs;
  readonly world: WorldPort;
  readonly cwd: string;
  /** Run another command in this shell (for `xargs`). */
  readonly run: (argv: readonly string[], stdin: string) => R;
}

export type Handler = (c: Cmd) => R;

export const ok = (out: string): R => ({ out, code: 0 });
export const fail = (err: string, code = 1): R => ({ out: "", err, code });
/** How the older `outside` list names a gap: the feature, with the tool in front unless the feature already says it. */
const outsideOf = (n: GapNotice): string =>
  n.what.startsWith(`${n.tool} `) ? n.what : `${n.tool} ${n.what}`;

/**
 * A command with a flag or feature the real tool has and the simulation does not (ADR-0184): the tool-style first
 * line, the `terrarium:` lines, exit status 2, and the gap itself for the run's record. `outside` keeps the older,
 * looser list of what the fake could not do (ADR-0117 decision 6).
 */
export const emulationGap = (n: GapNotice, code = 2): R => ({
  out: "",
  err: `${gapText(n)}\n`,
  code,
  gap: gapOf(n),
  outside: outsideOf(n),
});

/** A gap that still gives what it can (`tail -f` shows the last lines): the result keeps its output and exit status. */
export const softGap = (r: R, n: GapNotice): R => ({
  ...r,
  err: `${r.err ?? ""}${gapText(n)}\n`,
  gap: gapOf(n),
  outside: outsideOf(n),
});

/** Whether an action on a path goes through a symbolic link in the last part of the path (a write does, a removal does not). */
const FOLLOWS_LINK: Readonly<Partial<Record<HostAction, boolean>>> = {
  write: true,
  truncate: true,
  mkdir: false,
  symlink: false,
  remove: false,
};

/** The path of an action with the links on the way resolved, so a file written through a link lands where the link leads. */
function placed(c: Cmd, action: HostAction, arg: string | undefined): string | undefined {
  const follow = FOLLOWS_LINK[action];
  if (arg === undefined || follow === undefined) return arg;
  return arg
    .split("\n")
    .map((p) => c.fs.resolve(p, follow))
    .join("\n");
}

/** Change the world the way an operator on the host would; the event is the same one the old tool wrote. */
export function act(c: Cmd, action: HostAction, arg?: string, data?: string): void {
  const where = placed(c, action, arg);
  c.world.apply(
    {
      type: "host.act",
      target: c.h.id,
      action,
      ...(where !== undefined ? { arg: where } : {}),
      ...(data !== undefined ? { data } : {}),
    },
    "tool:run_command",
  );
}

/** Lines of a text without the trailing empty one. */
export function linesOf(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export const joinLines = (lines: readonly string[]): string =>
  lines.length === 0 ? "" : `${lines.join("\n")}\n`;

/** Bytes of a text in UTF-8. */
export const byteLength = (s: string): number => new TextEncoder().encode(s).length;
