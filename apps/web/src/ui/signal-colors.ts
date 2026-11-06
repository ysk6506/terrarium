/**
 * The signal colours the app's tokens do not have (REQ-078, beta feedback 13): the orange of an alarm, the
 * grey of the impact range and the purple of work another team is doing (REQ-093). Both views that draw them (the topology board and the time bar) put this in their own
 * `<style>`, so no colour value is written anywhere else. Fault red (`--bad`) and the pulse blue (`--cobalt`) are the
 * app's own tokens. Each colour keeps 4.5:1 against the board's ground and its glass cards in both themes
 * (light: orange 4.7 / grey 4.6 / purple 6.4 on `--paper`; dark: orange 9.7 / grey 5.8 / purple 7.2).
 */
const DARK = `
    --topo-alarm: #f0b04a;
    --topo-range: #8590a4;
    --topo-partner: #b79cf2;
`;

export const SIGNAL_CSS = `
:root {
  --topo-alarm: #a15c00;
  --topo-range: #636f80;
  --topo-partner: #6b46c1;
}

/* Dark follows the app's own setting (data-theme), and the computer's when the app has none. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {${DARK}  }
}

:root[data-theme="dark"] {${DARK}}
`;
