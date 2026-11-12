/**
 * Emulation gaps (ADR-0184): the one way the fake tools say "the real tool can do this, this proving ground cannot".
 *
 * Terrarium imitates UNIX utilities and switch CLIs so an agent can work on them as it would on real equipment. Two
 * kinds of failure exist and must not be mixed up:
 * - the real tool would also refuse the input (a flag it does not have, a malformed program): the fake answers with
 *   what the real tool says, and nothing else. A hint here would make the test easier than reality.
 * - the real tool would do it and the fake does not (an emulation gap): the fake says, in `terrarium:` lines only,
 *   that the limit is the proving ground's, what does work, and one command that works anywhere. It makes up no error
 *   line in the tool's style, since the real tool would show none. When part of the result can still be given correctly
 *   (`tail -f` shows the last lines) it is given with exit 0; when none can, the exit is non-zero.
 *
 * A gap is also a record: `tool` and `feature` are stable keys picked from fixed tables, never text the agent typed,
 * so the run can count them without carrying commands, file names or rows (principle: logs never hold secrets).
 */

/** What is recorded when a call hits a gap: a stable pair, no free text. */
export interface EmulationGap {
  /** The tool as the agent calls it: `awk`, `ls`, `shell`, `switch-cli`. */
  readonly tool: string;
  /** The feature the fake lacks, a short key: `getline`, `flag:--lines`, `command`. */
  readonly feature: string;
}

/** Everything a gap says to the agent, besides the pair that is recorded. */
export interface GapNotice extends EmulationGap {
  /** How the feature reads in the sentence: `-Z`, `getline`, `kubectl logs`. */
  readonly what: string;
  /** What does work, compact, in the tool's own vocabulary. */
  readonly supported: string;
  /**
   * One concrete command that works in any world (a test runs it). Left out when no command is right everywhere; a
   * gap never gives an example that only fits one world.
   */
  readonly example?: string;
}

/** `awk:getline`: the key a gap is counted under. */
export const gapKey = (g: EmulationGap): string => `${g.tool}:${g.feature}`;

export const gapOf = (g: EmulationGap): EmulationGap => ({ tool: g.tool, feature: g.feature });

/** The `terrarium:` lines: whose limit it is, what works, a command that works. Deterministic for a given notice. */
export function gapLines(g: GapNotice): string[] {
  const whole = g.feature === "command";
  const lines = [
    whole
      ? `terrarium: 이 실험장은 ${g.tool} 명령을 갖추지 못했어요. 실제 호스트에는 있는 명령이에요.`
      : `terrarium: 이 실험장은 ${g.tool}의 ${g.what} 기능을 지원하지 않아요. 실제 ${g.tool}에는 있어요.`,
    whole
      ? `terrarium: 이 셸에서 되는 명령: ${g.supported}`
      : `terrarium: ${g.tool}에서 되는 것: ${g.supported}`,
  ];
  return g.example === undefined
    ? lines
    : [...lines, `terrarium: 대신 이 명령은 돼요: ${g.example}`];
}

/**
 * The whole text of a gap, one line per line, no trailing newline. It is `terrarium:` lines only: the real tool does
 * not refuse this input, so a first line in the tool's own style would be an error that does not exist.
 */
export const gapText = (g: GapNotice): string => gapLines(g).join("\n");

/** Whether a text carries a gap's lines (the web and the tests tell the two kinds of failure apart by this). */
export const hasGapLines = (text: string): boolean => /(^|\n)terrarium: /.test(text);

/** Count gaps by key, most frequent first, ties by key (the order never depends on the order of the calls). */
export function tallyGaps(
  gaps: readonly EmulationGap[],
): ReadonlyArray<EmulationGap & { readonly n: number }> {
  const counts = new Map<string, EmulationGap & { n: number }>();
  for (const g of gaps) {
    const hit = counts.get(gapKey(g));
    if (hit) hit.n++;
    else counts.set(gapKey(g), { tool: g.tool, feature: g.feature, n: 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || gapKey(a).localeCompare(gapKey(b)));
}
