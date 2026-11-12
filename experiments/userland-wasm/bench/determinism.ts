/**
 * Prints a sha256 over the output of a fixed script of lines plus the world events it caused. Run it in fresh
 * processes (and with TZ, LANG, LC_ALL, another Node flag, a busy machine) and compare the digests.
 */
import { createHash } from "node:crypto";
import { lab } from "../../../tests/spec/test-support/deep-os-lab";

const LINES = [
  "set | head -40",
  "declare -p | head -30",
  "env | sort",
  "compgen -v | sort | head -20",
  "declare -A m; m[b]=2; m[a]=1; m[c]=3; for k in \"${!m[@]}\"; do echo $k=${m[$k]}; done",
  "a=(z y x); for i in \"${a[@]}\"; do echo $i; done | sort",
  "echo $RANDOM $RANDOM $RANDOM; echo $$ $BASHPID $PPID; echo $SECONDS",
  "date; date +%s; date -d '1 hour ago'",
  "awk 'BEGIN{srand(); print rand(), rand()}'",
  "awk 'BEGIN{a[\"x\"]=1;a[\"y\"]=2;a[\"z\"]=3; for(k in a) print k, a[k]}'",
  "awk 'BEGIN{print systime()}'",
  "printf '%s\\n' b a C A ä é z | sort",
  "printf '%s\\n' 10 9 1 | sort -n | head -2; printf 'B\\na\\n' | sort -f",
  "echo ${HOME} ${PATH} ${USER} ${HOSTNAME} ${LANG} ${LC_ALL:-unset} ${TZ:-unset}",
  "time true 2>&1 | head -3",
  "for i in {1..5}; do echo $((RANDOM % 7)); done",
  "echo 'ä가🙂' | wc -c; echo 'ä가🙂' | awk '{print length($0), toupper($0)}'",
  "ls /proc | head -5; ls /etc | head -5; echo /var/log/*",
  "x=$(uptime); echo ${x%%,*}",
  "echo a > /tmp/d1; echo b >> /tmp/d1; cat /tmp/d1; wc -c /tmp/d1",
  "jobs; echo a & wait; echo done",
  "trap 'echo bye' EXIT; echo run",
  "mapfile -t L < /etc/hosts; echo ${#L[@]}",
  "printf '%q\\n' 'a b' \"it's\"",
  "ulimit -n; umask; echo $-",
  "cd /tmp && pwd && cd - ",
];

const { run, world } = lab();
const h = createHash("sha256");
for (const l of LINES) {
  const r = run("srv-a2", l);
  h.update(`${l}\n${r.stdout}\n--\n${r.stderr}\n--\n${r.exitCode}\n`);
  if (process.env.SHOW) console.log(`$ ${l}\n${r.stdout}${r.stderr ? `[err] ${r.stderr}` : ""}`);
}
h.update(JSON.stringify(world.events()));
console.log(h.digest("hex"));
process.exit(0);
