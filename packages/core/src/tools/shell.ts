/**
 * The shell of `run_command` (REQ-087, ADR-0117). It used to match a command against a short list; now a host has
 * a small fake Linux (world/os): a virtual file system, a process table, units and a journal, with pipes,
 * redirects and the text commands (`grep`, `awk`, `sed`, ...) running for real. This file only checks that the host
 * can be logged in to and shapes the answer; everything else is in `@terrarium/core/world`.
 *
 * A command the fake cannot do is `command not found` (exit 127) or "이 흉내에서는 안 돼요", and is listed in
 * `outside` so the run's result can say where the fake is thin (ADR-0117 decision 6).
 */
import { InvalidValueError } from "@terrarium/core/kernel";
import { type EmulationGap, hostOsOf, runLine, type WorldPort } from "@terrarium/core/world";
import "./shell-layers";

export interface ShellResult {
  /** What a person would see: standard output, then standard error. */
  readonly output: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** The commands and features of this call that the simulation could not do. */
  readonly outside: string[];
  /** The emulation gaps of this call: the real tool does it, the proving ground does not (ADR-0184). */
  readonly gaps: EmulationGap[];
}

const MAX_LINES = 400;

function clip(output: string): string {
  const lines = output.split("\n");
  if (lines.length <= MAX_LINES) return output;
  return `${lines.slice(0, MAX_LINES).join("\n")}\n... (출력이 길어서 ${MAX_LINES}줄만 보여요. 전체 ${lines.length.toLocaleString("en-US")}줄. | grep 이나 | tail 로 좁혀 보세요)`;
}

/** Whether you can log in: the machine is on, and its system is up. */
function reachable(world: WorldPort, id: string): boolean {
  if (!hostOsOf(world, id).up) return false;
  const s = world.stateOf(id);
  return s.kind === "server"
    ? s.powered && s.adminOn && !s.rebooting
    : s.kind === "vm" && s.running;
}

const trimEnd = (s: string): string => s.replace(/\n$/, "");

/** Run one command line on a server or VM. */
export function runShell(world: WorldPort, id: string, line: string): ShellResult {
  const kind = world.index.entity(id).kind;
  if (kind !== "server" && kind !== "vm")
    throw new InvalidValueError(`'${id}' is a ${kind}; run_command needs a server or VM`);
  if (!reachable(world, id)) {
    const stderr = `ssh: connect to host ${world.index.entity(id).name} port 22: Connection timed out`;
    return { output: stderr, stdout: "", stderr, exitCode: 255, outside: [], gaps: [] };
  }
  const r = runLine(world, id, line);
  const output = clip(trimEnd(r.stdout + r.stderr));
  return {
    output,
    stdout: trimEnd(r.stdout),
    stderr: trimEnd(r.stderr),
    exitCode: r.exitCode,
    outside: r.outside,
    gaps: r.gaps,
  };
}
