/**
 * Behaviour that needs a product decision, shown as it is today with the switch on (TERRARIUM_SHELL=wasm) or off.
 * TERRARIUM_WASM_SLEEP=advance changes only what `sleep` does to the world clock.
 */
import { lab } from "../../../tests/spec/test-support/deep-os-lab";
import { last } from "../host/shell";

const { run, world } = lab();
const show = (title: string, lines: string[]): void => {
  console.log(`\n## ${title}`);
  for (const l of lines) {
    const t = performance.now();
    const r = run("srv-a2", l);
    const ms = performance.now() - t;
    const calls = last.result?.calls;
    console.log(`$ ${l.replace(/\n/g, "\\n")}   [${ms.toFixed(1)} ms${calls !== undefined ? `, ${calls} host calls` : ""}] exit=${r.exitCode}`);
    if (r.stdout) console.log(r.stdout.split("\n").slice(0, 6).map((x) => `  ${x}`).join("\n"));
    if (r.stderr) console.log(r.stderr.split("\n").slice(0, 3).map((x) => `  ! ${x}`).join("\n"));
  }
};

show("sleep and the clock", [
  "date +%T; sleep 5; date +%T",
  "echo $SECONDS; sleep 3; echo $SECONDS",
  "until systemctl is-active nosuch >/dev/null; do sleep 1; done; echo finished",
  "n=0; until [ $n -ge 3 ]; do n=$((n+1)); sleep 1; done; date +%T; echo $n",
]);
console.log(`world time now: ${world.t ?? "?"}`);

show("exit codes and signals", [
  "false; echo $?",
  "(exit 4); echo $?",
  "sh -c 'exit 3'; echo $?",
  "nosuchcmd; echo $?",
  "echo hi > /etc/passwd; echo $?",
  "/etc/hosts; echo $?",
  "trap 'echo got-term' TERM; kill -TERM $$; echo after",
  "kill -9 99999; echo $?",
  "exit 7",
  "timeout 1 sleep 5; echo $?",
  "set -e; false; echo not-reached",
  "set -o pipefail; false | true; echo $?",
]);

show("$PATH, environment, home directory", [
  "echo $HOME $PWD ~ $USER $LOGNAME $SHELL $HOSTNAME $LANG",
  "echo $PATH",
  "env | head -12",
  "printenv HOME; echo $UID $EUID",
  "id; whoami",
  "cd; pwd; cd /etc; pwd; cd -; cd ~root; pwd",
  "export FOO=bar; env | grep FOO; sh -c 'echo child:$FOO'",
  "FOO=1 env | grep FOO",
  "which ls; command -v systemctl; type kill",
]);

show("background jobs", [
  "echo a & echo b; wait; echo c",
  "sleep 2 & jobs; wait",
  "(sleep 1; echo late) & echo now; wait",
  "nohup echo hi",
  "ps | head -3; sleep 100 & ps | grep sleep",
]);

show("here-documents and strings", [
  "cat <<EOF\nhome=$HOME sum=$((1+2))\nEOF",
  "cat <<'EOF'\nno $HOME here\nEOF",
  "cat <<-EOF\n\tindented\nEOF",
  "grep -c a <<< 'banana'",
  "awk '{print NR\": \"$0}' <<EOF\nx\ny\nEOF",
  "cat <<EOF > /tmp/h1\nwritten\nEOF\ncat /tmp/h1",
]);

show("globbing against a described-on-demand file system", [
  "echo /proc/[0-9]* | wc -w",
  "echo /etc/* | wc -w",
  "echo /*/* | wc -w",
  "ls /var/log/*.log | head -3",
  "for f in /etc/*.conf; do echo $f; done | head -3",
  "echo /nonexistent/*",
  "shopt -s nullglob; echo /nonexistent/*; echo done",
  "echo /etc/h{ost,ostname}*",
  "echo /etc/**/hosts",
]);
process.exit(0);
