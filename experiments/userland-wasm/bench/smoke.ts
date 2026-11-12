import { lab } from "../../../tests/spec/test-support/deep-os-lab";

const { run } = lab();
const lines = process.argv.slice(2);
for (const l of lines) {
  const t = performance.now();
  const r = run("srv-a2", l);
  console.log(`$ ${l}   [${(performance.now() - t).toFixed(1)} ms]`);
  console.log(JSON.stringify({ out: r.stdout, err: r.stderr, code: r.exitCode, outside: r.outside }));
}
process.exit(0);
