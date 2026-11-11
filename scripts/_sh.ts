import { readFileSync } from "node:fs";
import { lab } from "../tests/spec/test-support/deep-os-lab";
const { run } = lab();
let host = "srv-a2";
for (const line of readFileSync(process.argv[2] as string, "utf8").split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue;
  if (line.startsWith("@")) { host = line.slice(1).trim(); continue; }
  const r = run(host, line);
  process.stdout.write(`$ ${line}\n${r.stdout}${r.stderr ? `[stderr] ${r.stderr}\n` : ""}${r.stdout.endsWith("\n") || r.stdout === "" ? "" : "\n"}[exit ${r.exitCode}${r.outside.length ? ` outside ${r.outside}` : ""}]\n`);
}
