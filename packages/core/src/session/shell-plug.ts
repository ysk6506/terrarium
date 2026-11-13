/** The shell engine of `run_command` and how the world's time goes with it (ADR-0200). */
import type { ShellPlug } from "@terrarium/core/world";
import type { SessionConfig } from "./types";

/**
 * The shell engine of `run_command` and how the world's time goes with it (ADR-0200). In an event the world moves
 * here, as far as one `wait` may (3600 s) and the run has left. An operation's world follows its own clock, which a
 * synchronous call cannot hold, so there `sleep` returns at once.
 */
export function shellPlugOf(
  config: Pick<SessionConfig, "shellEngine" | "seed">,
  session: { readonly operating: boolean; remaining(): number },
  calls: readonly unknown[],
  advance: (seconds: number) => void,
): { shell?: ShellPlug } {
  if (!config.shellEngine) return {};
  return {
    shell: {
      engine: config.shellEngine,
      seed: config.seed,
      callNumber: () => calls.length,
      clock: {
        budget: () => (session.operating ? 0 : Math.max(0, Math.min(3600, session.remaining()))),
        advance: (seconds) => advance(Math.min(seconds, session.remaining())),
      },
    },
  };
}
