/**
 * Gap coverage. Runs every known gap on the shell selected by TERRARIUM_SHELL and on the real bash of this machine
 * (LC_ALL=C, a scratch directory inside the worktree) and writes results/gaps-<label>.json.
 *   TERRARIUM_SHELL=wasm tsx bench/gaps.ts wasm      |      tsx bench/gaps.ts old
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { lab } from "../../../tests/spec/test-support/deep-os-lab";

export type Owner = "shell" | "awk" | "util" | "world";
export interface Item {
  id: string;
  src: string;
  owner: Owner;
  /** `@D@` is a scratch directory, different for the fake machine and for the real one. */
  cmd: string;
  /** Not comparable with a real run on this machine (output depends on the machine): only "no gap hint, exit 0" counts. */
  loose?: true;
}

export const ITEMS: Item[] = [
  // ── TD-0010 ──
  { id: "sed-n", src: "TD-0010", owner: "util", cmd: "printf 'a\\nb\\nc\\n' | sed -n 'n;p'" },
  { id: "sed-N", src: "TD-0010", owner: "util", cmd: "printf 'a\\nb\\n' | sed 'N;s/\\n/,/'" },
  { id: "sed-w", src: "TD-0010", owner: "util", cmd: "printf 'a\\nb\\n' | sed -n 's/a/Q/w @D@/o'; cat @D@/o" },
  { id: "sed-addr-plus", src: "TD-0010", owner: "util", cmd: "printf 'a\\nb\\nc\\n' | sed -n '/a/,+1p'" },
  { id: "awk-getline", src: "TD-0010", owner: "awk", cmd: "awk 'BEGIN{\"echo 5\" | getline a; print a}'" },
  { id: "awk-function", src: "TD-0010", owner: "awk", cmd: "awk 'function f(x){return x*2} BEGIN{print f(3)}'" },
  { id: "awk-pipe-out", src: "TD-0010", owner: "awk", cmd: "printf '2\\n1\\n' | awk '{print | \"sort\"}'" },
  { id: "sort-M", src: "TD-0010", owner: "util", cmd: "printf 'Feb\\nJan\\n' | sort -M" },
  { id: "sort-z", src: "TD-0010", owner: "util", cmd: "printf 'b\\0a\\0' | sort -z | tr '\\0' ' '" },
  { id: "sort-g", src: "TD-0010", owner: "util", cmd: "printf '1e2\\n5\\n' | sort -g" },
  { id: "cp-r", src: "TD-0010", owner: "util", cmd: "mkdir -p @D@/d1; echo a > @D@/d1/f; cp -r @D@/d1 @D@/d2; ls @D@/d2" },
  { id: "cp-multi", src: "TD-0010", owner: "util", cmd: "echo 1 > @D@/a; echo 2 > @D@/b; mkdir -p @D@/dd; cp @D@/a @D@/b @D@/dd; ls @D@/dd" },
  { id: "mv-multi", src: "TD-0010", owner: "util", cmd: "echo 1 > @D@/a; echo 2 > @D@/b; mkdir -p @D@/dd; mv @D@/a @D@/b @D@/dd; ls @D@/dd" },
  { id: "ls-ap", src: "TD-0010", owner: "util", cmd: "mkdir -p @D@/x/sub; echo 1 > @D@/x/.h; echo 1 > @D@/x/f; ls -ap @D@/x" },
  { id: "stat-c", src: "TD-0010", owner: "util", cmd: "echo abc > @D@/s; stat -c '%s %F' @D@/s" },
  { id: "rm-d", src: "TD-0010", owner: "util", cmd: "mkdir -p @D@/e; rm -d @D@/e; ls @D@" },
  { id: "truncate-rel", src: "TD-0010", owner: "util", cmd: "echo abcdef > @D@/t; truncate -s -2 @D@/t; cat @D@/t" },
  { id: "df-width", src: "TD-0010", owner: "util", cmd: "df -h / | head -1", loose: true },
  { id: "free-width", src: "TD-0010", owner: "util", cmd: "free -m | head -1", loose: true },
  // ── ADR-0184 (tests/spec/emulation-gaps.test.ts GAPS) ──
  { id: "awk-gensub", src: "ADR-0184", owner: "awk", cmd: "awk 'BEGIN{print gensub(/a/, \"b\", \"g\", \"aaa\")}'" },
  { id: "xargs-P", src: "ADR-0184", owner: "util", cmd: "printf '1\\n2\\n' | xargs -P 2 -n1 echo | sort" },
  { id: "ps-Z", src: "ADR-0184", owner: "util", cmd: "ps -Z | head -1", loose: true },
  { id: "head-lines", src: "ADR-0184", owner: "util", cmd: "printf 'a\\nb\\n' | head --lines=1" },
  { id: "find-print0", src: "ADR-0184", owner: "util", cmd: "mkdir -p @D@/f; echo 1 > @D@/f/a; find @D@/f -type f -print0 | tr '\\0' ' '" },
  { id: "ln-hard", src: "ADR-0184", owner: "util", cmd: "echo x > @D@/h1; ln @D@/h1 @D@/h2; echo y >> @D@/h1; cat @D@/h2" },
  { id: "systemctl-list-timers", src: "ADR-0184", owner: "world", cmd: "systemctl list-timers", loose: true },
  { id: "ip-neigh", src: "ADR-0184", owner: "world", cmd: "ip neigh", loose: true },
  { id: "vim", src: "ADR-0184", owner: "world", cmd: "vim --version | head -1", loose: true },
  { id: "export", src: "ADR-0184", owner: "shell", cmd: "export FOO=1; echo $FOO" },
  { id: "variable", src: "ADR-0184", owner: "shell", cmd: "X=abc; echo $X ${X#a}" },
  { id: "if", src: "ADR-0184", owner: "shell", cmd: "if true; then echo a; fi" },
  // ── research report, section 2.3 ──
  { id: "r-syntax", src: "report", owner: "shell", cmd: "if grep -q x /dev/null; then echo y; fi; v=abc; echo ${v:1:1} ${v#a} ${v/b/X} ${v:-z}" },
  { id: "r-for", src: "report", owner: "shell", cmd: "for i in 1 2 3; do echo $i; done" },
  { id: "r-while", src: "report", owner: "shell", cmd: "i=0; while [ $i -lt 3 ]; do i=$((i+1)); done; echo $i" },
  { id: "r-case", src: "report", owner: "shell", cmd: "case abc in a*) echo yes;; *) echo no;; esac" },
  { id: "r-func", src: "report", owner: "shell", cmd: "f() { echo in-$1; }; f 7" },
  { id: "r-subst", src: "report", owner: "shell", cmd: "echo $(echo a $(echo b))" },
  { id: "r-heredoc", src: "report", owner: "shell", cmd: "cat <<EOF\nx $((1+2))\nEOF" },
  { id: "r-array", src: "report", owner: "shell", cmd: "a=(x y z); echo ${#a[@]} ${a[1]}" },
  { id: "r-awk-system", src: "report", owner: "awk", cmd: "echo 1 | awk '{system(\"echo s\")}'" },
  { id: "r-awk-var", src: "report", owner: "awk", cmd: "printf 'a b\\n' | awk -v n=2 '{print $n, NF}'" },
];

const SCRATCH = new URL("../.build/oracle/", import.meta.url).pathname;
const label = process.argv[2] ?? "run";
const { run } = lab();
const strip = (s: string): string => s.replace(/\n+$/, "");

const results = ITEMS.map((it, i) => {
  const vdir = `/tmp/g${i}`;
  const rdir = `${SCRATCH}g${i}`;
  rmSync(rdir, { recursive: true, force: true });
  mkdirSync(rdir, { recursive: true });
  const fake = run("srv-a2", `mkdir -p ${vdir}; ${it.cmd.replaceAll("@D@", vdir)}`) as {
    stdout: string;
    stderr: string;
    exitCode: number;
    gaps: { tool: string; feature: string }[];
    outside: string[];
  };
  const real = spawnSync("bash", ["-c", it.cmd.replaceAll("@D@", rdir)], {
    env: { PATH: process.env.PATH ?? "", LC_ALL: "C", HOME: rdir },
    cwd: rdir,
    encoding: "utf8",
    timeout: 10000,
  });
  const norm = (s: string, d: string): string => strip(s).replaceAll(d, "@D@");
  return {
    ...it,
    fake: {
      stdout: norm(fake.stdout, vdir),
      stderr: fake.stderr,
      code: fake.exitCode,
      gaps: fake.gaps.map((g) => `${g.tool}:${g.feature}`),
      outside: fake.outside,
    },
    real: { stdout: norm(real.stdout ?? "", rdir), stderr: real.stderr, code: real.status },
  };
});
writeFileSync(
  new URL(`../results/gaps-${label}.json`, import.meta.url).pathname,
  JSON.stringify(results, null, 1),
);
console.log(`wrote ${results.length} items for ${label}`);
process.exit(0);
