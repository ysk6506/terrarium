#!/usr/bin/env node
// Hashes of the shell module's inputs and output (ADR-0200). No dependencies, no Go.
//   node lock.mjs pin <a|b|c>          print one pinned value (for build.sh), e.g. go|version
//   node lock.mjs inputs               print the hash of every input of the build
//   node lock.mjs check                the lock file matches the sources and the .wasm in the repository
//   node lock.mjs write                after a build: record the hash of the inputs and of the .wasm
//   node lock.mjs verify               after a CI rebuild: the .wasm just built has the recorded hash
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = join(root, "toolchain.lock.json");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const read = () => JSON.parse(readFileSync(lockPath, "utf8"));

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** Every file the build reads, and the pins; the lock's own hashes are not part of it. */
export function inputs() {
  const files = ["go", "patches", "scripts/build.sh"]
    .flatMap((p) => (statSync(join(root, p)).isDirectory() ? walk(join(root, p)) : [join(root, p)]))
    .map((f) => relative(root, f))
    .sort();
  const lines = files.map((f) => `${sha(readFileSync(join(root, f)))}  ${f}`);
  lines.push(`${sha(JSON.stringify(read().pins))}  pins`);
  return { sha256: sha(lines.join("\n")), files: files.length, lines };
}

const outputOf = (lock) => {
  const b = readFileSync(join(root, lock.output.file));
  return { file: lock.output.file, bytes: b.length, sha256: sha(b) };
};

const [cmd, arg] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const lock = read();
  if (cmd === "pin") {
    const v = arg.split("|").reduce((o, k) => o?.[k], lock.pins) ?? "";
    process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
  } else if (cmd === "inputs") {
    console.log(inputs().lines.join("\n"));
  } else if (cmd === "write") {
    const i = inputs();
    writeFileSync(
      lockPath,
      `${JSON.stringify({ ...lock, inputs: { sha256: i.sha256, files: i.files }, output: outputOf(lock) }, null, 2)}\n`,
    );
    console.log(`inputs ${i.sha256}\noutput ${outputOf(read()).sha256}`);
  } else if (cmd === "check" || cmd === "verify") {
    const bad = [];
    const out = outputOf(lock);
    if (out.sha256 !== lock.output.sha256 || out.bytes !== lock.output.bytes)
      bad.push(`the .wasm is ${out.sha256}, the lock says ${lock.output.sha256}`);
    if (cmd === "check" && inputs().sha256 !== lock.inputs.sha256)
      bad.push("the sources changed since the lock was written: rebuild and write the lock");
    if (bad.length) {
      console.error(bad.join("\n"));
      process.exit(1);
    }
    console.log(`ok ${out.sha256} ${out.bytes} bytes`);
  } else {
    console.error("usage: lock.mjs pin|inputs|write|check|verify");
    process.exit(2);
  }
}
