import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { lab } from "../tests/spec/test-support/deep-os-lab";
const { run } = lab();
let bad = 0;
for (const line of readFileSync(process.argv[2] as string, "utf8").split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue;
  const r = run("srv-a2", line);
  let real = "";
  try { real = execFileSync("bash", ["-c", line], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e: any) { real = (e.stdout ?? "") + "[fail]"; }
  const sim = r.stdout + (r.exitCode ? "[fail]" : "");
  const same = sim.trimEnd() === real.trimEnd();
  if (!same) bad++;
  else if (process.env.GEN) appendFileSync(process.env.GEN, `  [${JSON.stringify(line)}, ${JSON.stringify(real.replace(/\[fail\]$/, "").trimEnd())}${r.exitCode ? ", true" : ""}],\n`);
  process.stdout.write(`${same ? "OK  " : "DIFF"} ${line}\n${same ? "" : `   sim : ${JSON.stringify(sim)}${r.stderr ? ` err=${r.stderr}` : ""}\n   real: ${JSON.stringify(real)}\n`}`);
}
process.stdout.write(`${bad} differ\n`);
