/** The deep fake operating system (ADR-0117): a virtual file system, a process table, units and a journal under one shell. */

export { OS_EPOCH_MS } from "./clock";
export { instanceOn } from "./cmd-db";
export { ipOf } from "./host";
export { registerShellCommand, runLine, type ShellOutcome } from "./shell-exec";
export { changesWorld } from "./shell-parse";
export type { Cmd, Handler, R } from "./types";
