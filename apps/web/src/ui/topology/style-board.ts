/** The drawing of the topology view's board: bases, glyph paints, pipes, bars (see `style.ts` for the rest). */
export const BOARD_CSS = `
/* ── the drawing ── */

.topo-board .col {
  fill: var(--ink-3);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.topo-board .lbl {
  fill: var(--ink);
  font-size: 12px;
  font-weight: 600;
}

.topo-board .st {
  fill: var(--ink-3);
  font-size: 11px;
}

.topo-board .cnt {
  fill: var(--ink-3);
  font-size: 10.5px;
  font-weight: 500;
}

.topo-board .slab-top {
  fill: var(--topo-slab);
  stroke: var(--topo-slab-line);
}

.topo-board .slab-l {
  fill: var(--topo-slab-l);
}

.topo-board .slab-r {
  fill: var(--topo-slab-r);
}

.topo-board .shadow {
  fill: var(--ink);
  opacity: 0.06;
}

.topo-board .s-impact .slab-top {
  fill: var(--topo-impact-slab);
}

.topo-board .rim {
  fill: none;
  stroke-width: 2.2;
}

.topo-board .s-fault .rim {
  stroke: var(--bad);
}

.topo-board .s-alarm .rim {
  stroke: var(--topo-alarm);
}

.topo-board .s-touch .rim {
  stroke: var(--cobalt);
}

.topo-board .glow {
  opacity: 0.16;
}

.topo-board .s-fault .glow {
  fill: var(--bad);
}

.topo-board .s-alarm .glow {
  fill: var(--topo-alarm);
}

.topo-board .s-impact .glow {
  fill: var(--topo-range);
  opacity: 0.4;
}

.topo-board .s-touch .glow {
  fill: var(--cobalt);
}

.topo-board .ring {
  fill: none;
  stroke: var(--cobalt);
  stroke-width: 2;
  transform-box: fill-box;
  transform-origin: center;
  animation: topo-pulse 1.8s ease-out infinite;
}

/* What is picked in the 3D view shines here. */
.topo-board .pick {
  fill: var(--cobalt-soft);
  stroke: var(--cobalt);
  stroke-width: 2;
}

.bar-back {
  fill: var(--line);
}

.bar-ok {
  fill: var(--good);
}

.bar-impact {
  fill: var(--topo-range);
}

.bar-alarm {
  fill: var(--topo-alarm);
}

.bar-fault {
  fill: var(--bad);
}

.pipe-base {
  fill: none;
  stroke: var(--topo-slab);
  stroke-linecap: round;
  opacity: 0.9;
}

.pipe {
  fill: none;
  stroke-linecap: round;
}

.pipe-cold {
  stroke: var(--air-cold);
}

.pipe-hot {
  stroke: var(--air-hot);
}

.pipe-power {
  stroke: var(--cobalt);
  opacity: 0.55;
}

.pipe-net {
  stroke: var(--good);
  opacity: 0.6;
}

.pipe-dead {
  stroke: var(--line-strong);
  stroke-dasharray: 1 7;
}

.drop {
  fill: var(--air-cold);
}

.drop-hot {
  fill: var(--air-hot);
}

.led {
  fill: var(--topo-led);
}

.led-alarm {
  fill: var(--topo-alarm);
}

.led-fault {
  fill: var(--bad);
}

.fan {
  fill: var(--topo-steel-l);
}

.fan-hub {
  fill: var(--topo-steel-t);
}

.louvre {
  stroke: var(--topo-steel-l);
  stroke-width: 1.2;
}

.tone-steel .pt {
  fill: var(--topo-steel-t);
}

.tone-steel .pl {
  fill: var(--topo-steel-l);
}

.tone-steel .pr {
  fill: var(--topo-steel-r);
}

.tone-dark .pt {
  fill: var(--topo-dark-t);
}

.tone-dark .pl {
  fill: var(--topo-dark-l);
}

.tone-dark .pr {
  fill: var(--topo-dark-r);
}

.tone-green .pt {
  fill: var(--topo-green-t);
}

.tone-green .pl {
  fill: var(--topo-green-l);
}

.tone-green .pr {
  fill: var(--topo-green-r);
}

.tone-blue .pt {
  fill: var(--topo-blue-t);
}

.tone-blue .pl {
  fill: var(--topo-blue-l);
}

.tone-blue .pr {
  fill: var(--topo-blue-r);
}

.tone-olive .pt {
  fill: var(--topo-olive-t);
}

.tone-olive .pl {
  fill: var(--topo-olive-l);
}

.tone-olive .pr {
  fill: var(--topo-olive-r);
}

@keyframes topo-pulse {
  0% {
    opacity: 0.7;
    transform: scale(1);
  }

  100% {
    opacity: 0;
    transform: scale(1.7);
  }
}

@media (prefers-reduced-motion: reduce) {
  .topo-board .ring {
    animation: none;
  }
}
`;
