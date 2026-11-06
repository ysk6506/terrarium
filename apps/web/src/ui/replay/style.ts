/**
 * The style of the time bar (REQ-078 step 2, ADR-0084 item 8), kept as a string the bar puts in a `<style>`: the bar is
 * used by the run page, the result page, the side-by-side view and the builder, and comes down with the first of them.
 * Colours are the app's tokens and the signal colours (`--topo-alarm`, from `signal-colors.ts`); the marks are the board's own colours.
 */
export const REPLAY_CSS = `
.rb {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 4px 14px;
  min-width: min(520px, 100%);
  padding: 8px 16px 6px;
  color: var(--ink-2);
  font-size: 13px;
}

.rb-play {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--ink);
  color: var(--surface);
  cursor: pointer;
}

.rb-play:focus-visible,
.rb-track:focus-visible,
.rb-tick:focus-visible {
  outline: 2px solid var(--cobalt);
  outline-offset: 2px;
}

.rb-track {
  position: relative;
  height: 30px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
}

.rb-line,
.rb-fill {
  position: absolute;
  top: 13px;
  left: 0;
  height: 4px;
  border-radius: 2px;
}

.rb-line {
  right: 0;
  background: var(--line);
}

.rb-fill {
  background: var(--cobalt);
}

.rb-knob {
  position: absolute;
  top: 5px;
  width: 20px;
  height: 20px;
  border: 3px solid var(--cobalt);
  border-radius: 50%;
  background: var(--surface);
  box-shadow: var(--card-shadow);
  transform: translateX(-50%);
}

.rb-mark {
  position: absolute;
  top: 8px;
  width: 14px;
  height: 14px;
  border: 2px solid var(--surface);
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--line);
  transform: translateX(-50%);
  pointer-events: none;
}

.rb-mark.again {
  top: 11px;
  width: 8px;
  height: 8px;
  border-width: 1px;
  opacity: 0.8;
}

.m-fault {
  background: var(--bad);
}

.m-alarm {
  background: var(--topo-alarm);
}

.m-read {
  background: color-mix(in srgb, var(--cobalt) 55%, var(--surface));
}

.m-act {
  background: var(--cobalt);
}

.m-recover {
  background: var(--good);
}

.t-fault {
  --mark: var(--bad);
}

.t-alarm {
  --mark: var(--topo-alarm);
}

.t-read {
  --mark: color-mix(in srgb, var(--cobalt) 70%, var(--ink-2));
}

.t-act {
  --mark: var(--cobalt);
}

.t-recover {
  --mark: var(--good);
}

.rb-value {
  min-width: 9.5em;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.rb-speed {
  grid-column: 3;
  justify-self: end;
}

.rb-speed select {
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink-2);
  font-size: 12px;
}

.rb-ticks {
  position: relative;
  grid-column: 2;
  height: 34px;
  font-size: 11px;
}

.rb-tick {
  position: absolute;
  padding: 0 2px;
  border: 0;
  background: none;
  color: var(--mark, var(--ink-3));
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  transform: translateX(-50%);
  cursor: pointer;
}

.rb-tick.row-1 {
  top: 16px;
}

.replay-stage {
  position: relative;
  height: 560px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 18px;
}

.replay-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.replay-pair .replay-stage {
  height: 520px;
}

/* Two boards share the width: the boxes wrap, and the speech bubble hangs under them at the left. */
.replay-pair .topo-agent-slot {
  justify-content: flex-start;
}

.replay-pair .topo-agent {
  max-width: 100%;
}

@media (max-width: 900px) {
  .replay-pair {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .rb {
    grid-template-columns: auto 1fr;
  }

  .rb-value {
    grid-column: 1 / -1;
    text-align: left;
  }

  .rb-ticks,
  .rb-speed {
    grid-column: 1 / -1;
  }
}
`;
