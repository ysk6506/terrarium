/**
 * The port of a shell engine (ADR-0196, ADR-0200). The core knows a shell only as this port: a function that takes
 * one command line and the few things a machine's shell may touch, and gives back what the line printed. The engine
 * itself (a real shell and awk compiled to WebAssembly, with a pool of workers) lives outside the core; whoever opens
 * the session plugs it in. The old shell of `shell-exec.ts` is the default and does not use this port.
 *
 * What an engine can open is exactly `ShellHostPort`: the files of the world, its clock and its commands.
 */

/**
 * The limits that decide a result. Every one of them counts something the engine does (statements, bytes, simulated
 * seconds), never how long the machine took, so the same line stops at the same place with the same writes done on
 * every machine (ADR-0196 decision 2). Zero means no limit. Sizes: docs/design-docs/service-os-layer.md.
 */
export interface ShellLimits {
  /** Statements of the shell and turns of awk loops, input records and function calls of awk. */
  readonly steps: number;
  /** Bytes of standard output and standard error together. */
  readonly outputBytes: number;
  /** Live heap of the shell's own memory. */
  readonly memoryBytes: number;
  /** Simulated seconds the line may let pass (`sleep`): what one `wait` may take, and what the run has left. */
  readonly worldSeconds: number;
  /** Directory entries a line may list (a glob can expand to no more than that). */
  readonly expansions: number;
}

/** What stopped a line: the first four count (a result), the last is the safety net of the wall clock. */
export type ShellLimitKind = "steps" | "output" | "memory" | "time" | "expansion" | "wall";

export interface ShellJob {
  readonly line: string;
  readonly cwd: string;
  /** World time when the line starts, in Unix milliseconds: where the engine's clock begins. */
  readonly nowMs: number;
  /** The environment a login shell starts with; it does not carry over between calls. */
  readonly env: readonly string[];
  readonly limits: ShellLimits;
  /** Decides `$RANDOM` and `/dev/urandom`: a function of the situation and the number of the call. */
  readonly seed: number;
}

export interface ShellFileStat {
  readonly type: "f" | "d" | "l";
  readonly mode: number;
  readonly size: number;
  /** Unix seconds (world time). */
  readonly mtime: number;
  readonly name: string;
}

/** The only door of an engine to the world. */
export interface ShellHostPort {
  /** Move the world to `seconds` after the line began (the engine's clock only moves when it sleeps). */
  advanceTo(seconds: number): void;
  /** Changes whenever the world does; an engine may keep what it listed while this stays the same. */
  stamp(): number;
  stat(path: string, follow: boolean): ShellFileStat | { readonly errno: string };
  readDir(path: string): readonly ShellFileStat[] | { readonly errno: string };
  read(path: string): Uint8Array | { readonly errno: string };
  /** Whether a write to `path` is allowed: an errno when it is not. */
  mayWrite(path: string, append: boolean): { readonly errno: string } | undefined;
  write(path: string, data: Uint8Array, append: boolean): { readonly errno: string } | undefined;
  /** Run a command of the machine (the ones that read and change the world). `\u0000name` is a builtin of the shell. */
  exec(
    argv: readonly string[],
    cwd: string,
    env: readonly string[],
    stdin: Uint8Array,
  ): { readonly code: number; readonly stdout: Uint8Array; readonly stderr: Uint8Array };
  /** The engine hit something the real machine does and the simulation does not: records it, gives its words. */
  gap(tool: string, feature: string, what: string): string;
}

/** What the engine used, for measuring the size of the limits (not for scoring). */
export interface ShellUse {
  readonly steps: number;
  readonly outputBytes: number;
  readonly heapBytes: number;
  readonly worldSeconds: number;
}

export interface ShellEngineResult {
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  /** Set when a limit stopped the line (the exit code is 124 then). */
  readonly limit?: ShellLimitKind;
  /** Set when the engine itself failed; the line has no answer. */
  readonly crash?: string;
  readonly use?: ShellUse;
}

export interface ShellEngine {
  run(job: ShellJob, host: ShellHostPort): ShellEngineResult;
}

/** What a session gives `run_command` for the new engine: the engine, and how the world's time and numbers go with it. */
export interface ShellPlug {
  readonly engine: ShellEngine;
  /** Part of the seed of `$RANDOM`: the session's own. */
  readonly seed: number;
  /** The number of this call among the run's calls. */
  readonly callNumber: () => number;
  /** World time the line may let pass, and how it passes. Absent: the engine cannot move the world. */
  readonly clock?: ShellClock;
  /** Smaller limits for a test (a limit not named keeps its default). */
  readonly limits?: Partial<ShellLimits>;
  /** Told what every line used and how it ended (measuring the limits, tests); never changes the answer. */
  readonly observe?: (line: string, result: ShellEngineResult) => void;
}

export interface ShellClock {
  /** Seconds one line may let pass: what one `wait` may take and the run has left; 0 when the clock is not ours to move. */
  budget(): number;
  /** Let `seconds` pass in the world. */
  advance(seconds: number): void;
}

/**
 * The sizes of the limits, measured on the answers of the exercises and the tests that run commands (see
 * docs/design-docs/service-os-layer.md for the numbers they come from): the biggest real line used less than a tenth of
 * each, so a limit is far from honest work and near enough to stop a runaway quickly.
 */
export const SHELL_LIMITS: ShellLimits = {
  steps: 20_000,
  outputBytes: 1_048_576,
  memoryBytes: 128 * 1_048_576,
  worldSeconds: 3600,
  expansions: 50_000,
};

/** The words of a limit, in the `terrarium:` lines (the limit is the proving ground's, not the agent's). */
export function limitLine(kind: ShellLimitKind, limits: ShellLimits): string {
  const was = "이 줄은 실제 호스트에서는 계속 돌 수 있어요";
  switch (kind) {
    case "steps":
      return `terrarium: 한 줄이 실행할 수 있는 단계(${limits.steps.toLocaleString("en-US")}번)에 닿아서 멈췄어요. ${was}. 같은 줄은 어디서나 같은 곳에서 멈춰요.`;
    case "output":
      return `terrarium: 한 줄이 낼 수 있는 출력(${(limits.outputBytes / 1_048_576).toLocaleString("en-US")}MB)에 닿아서 멈췄어요. ${was}. 같은 줄은 어디서나 같은 곳에서 멈춰요.`;
    case "memory":
      return `terrarium: 한 줄이 쓸 수 있는 메모리(${Math.round(limits.memoryBytes / 1_048_576)}MB)에 닿아서 멈췄어요. ${was}. 같은 줄은 어디서나 같은 곳에서 멈춰요.`;
    case "time":
      return `terrarium: 한 줄이 보낼 수 있는 세계 시간(${limits.worldSeconds.toLocaleString("en-US")}초, wait 한 번의 한도와 남은 시간 중 작은 것)에 닿아서 멈췄어요.`;
    case "expansion":
      return `terrarium: 한 줄이 펼칠 수 있는 목록(${limits.expansions.toLocaleString("en-US")}개)에 닿아서 멈췄어요. ${was}.`;
    case "wall":
      return "terrarium: 이 줄은 실험장이 정한 시간 안에 끝나지 않아서 멈췄어요(안전망). 같은 줄이 다른 기계에서는 다르게 멈출 수 있어요. 점수에서 에이전트의 탓으로 세지 않아요.";
  }
}
