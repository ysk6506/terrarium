/**
 * The styles of the topology view (REQ-078, ADR-0084), kept as a string that the view puts in a `<style>` when it
 * opens: they come down with the view and not with the first screen. Colours are the app's tokens; the two the app
 * does not have (the orange of an alarm, the grey of the impact range) and the paint of the isometric bases are
 * defined at the top, with a dark counterpart, and no colour value is written anywhere else.
 */
export const TOPOLOGY_CSS = `

:root {
  --topo-alarm: #e9962f;
  --topo-range: #c3ccd8;
  --topo-touch-read: color-mix(in srgb, var(--cobalt) 45%, var(--surface));
  /* The ground and the bases come from the app's own tokens, so the board is light or dark with the app. */
  --topo-ground-a: color-mix(in srgb, var(--surface) 55%, var(--paper));
  --topo-ground-b: var(--paper);
  --topo-slab: var(--surface);
  --topo-slab-line: var(--line);
  --topo-slab-l: color-mix(in srgb, var(--ink) 14%, var(--surface));
  --topo-slab-r: color-mix(in srgb, var(--ink) 7%, var(--surface));
  --topo-steel-t: #e6ecf3;
  --topo-steel-l: #9fb0c4;
  --topo-steel-r: #c3cfdc;
  --topo-dark-t: #4e5968;
  --topo-dark-l: #2a3340;
  --topo-dark-r: #3b4654;
  --topo-green-t: #dfe9d8;
  --topo-green-l: #9db48f;
  --topo-green-r: #bfd0b2;
  --topo-blue-t: #cfe0f5;
  --topo-blue-l: #7d9ec8;
  --topo-blue-r: #a6c0e0;
  --topo-olive-t: #e1dfc4;
  --topo-olive-l: #a8a371;
  --topo-olive-r: #c6c295;
  --topo-led: #4cc27a;
  --topo-hover: color-mix(in srgb, var(--cobalt) 8%, transparent);
  --topo-impact-slab: color-mix(in srgb, var(--topo-range) 30%, var(--topo-slab));
}

/* Dark follows the app's own setting (data-theme), and the computer's when the app has none. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --topo-alarm: #f0b04a;
    --topo-range: #566176;
    --topo-steel-t: #5a6678;
    --topo-steel-l: #3a4352;
    --topo-steel-r: #4a5566;
    --topo-dark-t: #11141a;
    --topo-dark-l: #090b0f;
    --topo-dark-r: #0d1015;
    --topo-green-t: #3d5a45;
    --topo-green-l: #2b4132;
    --topo-green-r: #34503c;
    --topo-blue-t: #4b6a96;
    --topo-blue-l: #324a6c;
    --topo-blue-r: #3d5a82;
    --topo-olive-t: #6b6a45;
    --topo-olive-l: #4a4930;
    --topo-olive-r: #5a5a3b;
  }
}

:root[data-theme="dark"] {
  --topo-alarm: #f0b04a;
  --topo-range: #566176;
  --topo-steel-t: #5a6678;
  --topo-steel-l: #3a4352;
  --topo-steel-r: #4a5566;
  --topo-dark-t: #11141a;
  --topo-dark-l: #090b0f;
  --topo-dark-r: #0d1015;
  --topo-green-t: #3d5a45;
  --topo-green-l: #2b4132;
  --topo-green-r: #34503c;
  --topo-blue-t: #4b6a96;
  --topo-blue-l: #324a6c;
  --topo-blue-r: #3d5a82;
  --topo-olive-t: #6b6a45;
  --topo-olive-l: #4a4930;
  --topo-olive-r: #5a5a3b;
}

.topo {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, var(--topo-ground-a) 0%, var(--topo-ground-b) 100%);
}

.topo-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--glass-92);
}

.topo-crumbs {
  align-items: center;
}

.topo-body {
  position: relative;
  flex: 1;
  min-height: 0;
}

.topo-scroll {
  position: absolute;
  inset: 0;
  overflow: auto;
  padding: 112px 16px 120px;
}

.topo-empty {
  margin: 0;
  color: var(--ink-2);
}

.topo-board {
  position: relative;
  width: 100%;
  min-width: 720px;
  max-width: 1280px;
  margin: 0 auto;
}

.topo-board svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

/* The tiles are buttons over the picture, at the places the picture draws them. */
.topo-hits {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.topo-hits li {
  position: absolute;
}

.topo-hits button,
.topo-still {
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: 14px;
  background: transparent;
  cursor: pointer;
}

.topo-still {
  cursor: default;
}

.topo-hits button:hover {
  background: var(--topo-hover);
}

.topo-hits button:focus-visible {
  outline: 2px solid var(--cobalt);
  outline-offset: 2px;
}

/* ── the glass cards ── */

.topo-top {
  position: absolute;
  top: 14px;
  left: 16px;
  right: 16px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  pointer-events: none;
}

.topo-foot {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 14px;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px 12px;
  pointer-events: none;
}

.topo-card {
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--glass-92);
  box-shadow: var(--card-shadow);
  backdrop-filter: blur(10px);
  pointer-events: auto;
}

.topo-impact {
  min-width: 230px;
  max-width: 340px;
  padding: 12px 16px;
}

.topo-impact .t {
  margin-bottom: 2px;
  color: var(--ink-3);
  font-size: 12px;
}

.topo-impact .n {
  font-size: 17px;
  font-weight: 700;
}

.topo-impact .topo-none {
  color: var(--ink-2);
  font-size: 14px;
  font-weight: 500;
}

.topo-impact .w {
  margin-top: 4px;
  color: var(--warn);
  font-size: 13px;
  font-weight: 500;
}

.topo-agent-slot {
  flex: 1;
  display: flex;
  justify-content: center;
}

.topo-caption {
  margin: 0;
  padding: 6px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--glass-92);
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
}

.topo-agent {
  max-width: 300px;
  padding: 10px 14px;
  border-color: var(--cobalt);
  box-shadow: 0 10px 28px color-mix(in srgb, var(--cobalt) 16%, transparent);
  font-size: 12px;
  animation: topo-bubble 0.25s ease-out;
}

.topo-agent-read {
  border-color: color-mix(in srgb, var(--cobalt) 45%, var(--line));
}

.topo-agent .who {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 4px;
  color: var(--cobalt);
  font-weight: 600;
}

.topo-agent .who i {
  display: inline-block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8ab4ff, #1b64da);
}

.topo-agent code {
  display: inline-block;
  max-width: 100%;
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink);
  font-size: 11.5px;
  overflow-wrap: anywhere;
}

.topo-agent .when {
  display: block;
  margin-top: 4px;
  color: var(--ink-3);
}

.topo-agent .when.bad {
  color: var(--bad);
}

@keyframes topo-bubble {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .topo-agent {
    animation: none;
  }
}

.topo-drawn {
  padding: 6px 14px;
  color: var(--ink-2);
  font-size: 12px;
  border-radius: 999px;
}

.topo-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 7px 14px;
  list-style: none;
  color: var(--ink-2);
  font-size: 12px;
  border-radius: 999px;
}

.topo-legend i {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 5px;
  border-radius: 50%;
  vertical-align: 1px;
}

.dot-fault {
  background: var(--bad);
}

.dot-alarm {
  background: var(--topo-alarm);
}

.dot-touch {
  background: var(--cobalt);
}

.dot-impact {
  background: var(--topo-range);
}

.topo-picked {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  max-width: 260px;
  padding: 10px 14px;
  font-size: 13px;
}

.topo-picked span {
  color: var(--ink-2);
}

.topo-bar {
  flex: 1;
  min-width: 300px;
}
`;
