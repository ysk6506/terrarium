/**
 * The shell of the deep operating-system fake (REQ-098, ADR-0117 decisions 1, 3 and 4): pipes and redirects, quoting,
 * the text commands doing what they say, writes that change the world, and `command not found` for what is not there.
 */
import { callEffect } from "@terrarium/core/tools";
import { registerShellCommand } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

describe("the shell reads a line the way bash does [REQ-098]", () => {
  test("pipes, &&, || and ; join commands; quotes keep words together", () => {
    const { sh } = lab();
    expect(sh("echo 'a  b' | wc -w")).toBe("2");
    expect(sh("echo one && echo two")).toBe("one\ntwo");
    expect(sh("false || echo then")).toBe("then");
    expect(sh("false && echo never; echo after")).toBe("after");
    expect(sh('echo "it\'s" \'say "hi"\'')).toBe(`it's say "hi"`);
    expect(sh("printf '%s\\n' a\\ b | wc -l")).toBe("1");
  });

  test("redirects: 2>&1 joins the streams, 2>/dev/null drops them, > and >> write files", () => {
    const { sh, run, world } = lab();
    expect(run("srv-a2", "cat /nope").stderr).toContain("No such file or directory");
    expect(run("srv-a2", "cat /nope 2>/dev/null").stderr).toBe("");
    expect(sh("cat /nope 2>&1 | wc -l")).toBe("1");
    sh("echo first > /tmp/note.txt");
    sh("echo second >> /tmp/note.txt");
    expect(sh("cat /tmp/note.txt")).toBe("first\nsecond");
    expect(
      world.events().filter((e) => e.type === "host.act" && e.action === "write"),
    ).toHaveLength(2);
  });

  test("a line with a variable, a substitution or a loop is refused with exit 2 and counted as outside", () => {
    const { run } = lab();
    for (const cmd of [
      "echo $HOME",
      "echo `date`",
      "for i in 1 2; do echo $i; done",
      "sleep 1 &",
    ]) {
      const r = run("srv-a2", cmd);
      expect(r.exitCode).toBe(2);
      expect(r.outside.length).toBeGreaterThan(0);
    }
  });

  test("an unknown command is bash's own words with exit 127; kubectl waits for the container layer", () => {
    const { run } = lab();
    const r = run("srv-a2", "kubectl get pods");
    expect(r).toMatchObject({
      exitCode: 127,
      stderr: "bash: kubectl: command not found",
      outside: ["kubectl"],
    });
    // ADR-0184: vim is a real command the fake host lacks, so the answer is the terrarium lines only (no bash line,
    // exit 127); a name no host has stays plain
    const vim = run("srv-a2", "vim /etc/hosts");
    expect(vim.exitCode).toBe(127);
    expect(vim.stderr.split("\n")[0]).toMatch(/^terrarium: 이 실험장은 vim 명령을/);
    expect(vim.stderr).not.toContain("bash:");
    expect(run("srv-a2", "nosuchcmd-xyz").stderr).toBe("bash: nosuchcmd-xyz: command not found");
  });

  test("globs are expanded against the file system", () => {
    const { sh } = lab();
    expect(sh("ls /etc/*.conf | head -3")).toContain("/etc/chrony.conf");
    expect(sh("cat /etc/host* | head -1")).toBe("srv-a2");
  });
});

describe("grep, awk, sed, sort and friends do what they say [REQ-098]", () => {
  test("grep: -i -v -c -n -E -r -l -w and a pattern that is a regular expression", () => {
    const { sh } = lab();
    expect(sh("grep -c . /etc/passwd")).toBe("6");
    expect(sh("grep -n -i OPS /etc/passwd")).toBe("5:ops:x:1000:1000:ops:/home/ops:/bin/bash");
    expect(sh("grep -v -E '^(root|ops|appsvc|syslog|chrony):' /etc/passwd")).toBe(
      "daemon:x:2:2:daemon:/sbin:/sbin/nologin",
    );
    expect(sh("grep -rl licd /etc/systemd")).toBe("/etc/systemd/system/licd.service");
    expect(sh("grep -w ops /etc/group")).toBe("ops:x:1000:");
    expect(sh("grep '[[:digit:]]\\{4\\}' /etc/group | head -1")).toBe("ops:x:1000:");
  });

  test("awk: fields, -F, NR, NF, patterns, BEGIN/END, sums, arrays and printf", () => {
    const { sh } = lab();
    expect(sh("echo 'a b c' | awk '{print $2}'")).toBe("b");
    expect(sh("awk -F: '$3 >= 1000 {print $1}' /etc/passwd")).toBe("ops\nappsvc");
    expect(sh("printf '1\\n2\\n3\\n' | awk '{s+=$1} END {print s}'")).toBe("6");
    expect(sh("awk -F: 'NR==1 {print NF}' /etc/passwd")).toBe("7");
    expect(sh("awk 'BEGIN {print 2*3+1}'")).toBe("7");
    expect(sh("awk -F: '/^o/ {printf \"%s=%d\\n\", $1, $3}' /etc/passwd")).toBe("ops=1000");
    expect(sh("ps aux | awk '{c[$1]++} END {print c[\"ops\"]}'")).toBe("2");
    expect(sh("echo 'x y' | awk '{ $2 = \"Z\"; print }'")).toBe("x Z");
    expect(sh("echo abc | awk '{print toupper(substr($0, 2, 2)), length($0)}'")).toBe("BC 3");
  });

  test("sed: s///g, -n with p, d, line ranges, back-references, in-place edits of a file", () => {
    const { sh } = lab();
    expect(sh("echo 'aaa' | sed 's/a/b/g'")).toBe("bbb");
    expect(sh("echo 'aaa' | sed 's/a/b/2'")).toBe("aba");
    expect(sh("printf '1\\n2\\n3\\n4\\n' | sed -n '2,3p'")).toBe("2\n3");
    expect(sh("printf '1\\n2\\n3\\n' | sed '/2/d'")).toBe("1\n3");
    expect(sh("echo 'foo bar' | sed -E 's/(foo) (bar)/\\2 \\1/'")).toBe("bar foo");
    sh("echo 'port=80' > /tmp/app.conf");
    sh("sed -i 's/80/8080/' /tmp/app.conf");
    expect(sh("cat /tmp/app.conf")).toBe("port=8080");
  });

  test("sort, uniq, cut, tr, wc, head, tail, xargs and find", () => {
    const { sh } = lab();
    expect(sh("printf '10\\n9\\n100\\n' | sort -n | tail -1")).toBe("100");
    expect(sh("printf '10\\n9\\n100\\n' | sort -nr | head -1")).toBe("100");
    expect(sh("printf 'b\\na\\nb\\n' | sort | uniq -c")).toBe("      1 a\n      2 b");
    expect(sh("echo 'a:b:c' | cut -d: -f2,3")).toBe("b:c");
    expect(sh("echo hello | tr a-z A-Z")).toBe("HELLO");
    expect(sh("echo 'a   b' | tr -s ' '")).toBe("a b");
    expect(sh("printf '1\\n2\\n3\\n' | head -n 2")).toBe("1\n2");
    expect(sh("printf '1\\n2\\n3\\n' | tail -n 2")).toBe("2\n3");
    expect(sh("echo 1 2 3 | xargs -n 1 echo n")).toBe("n 1\nn 2\nn 3");
    expect(sh("find /etc -name '*.pem'")).toBe("/etc/ssl/certs/licd.pem");
  });

  test("tail -f is not possible: it says so and shows the last lines, and counts as outside", () => {
    const { run } = lab();
    const r = run("srv-a2", "tail -f -n 2 /etc/passwd");
    expect(r.stdout.split("\n")).toHaveLength(2);
    // part of the answer is right (the last lines), so it is given with exit 0, and the terrarium lines say what is missing
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain("terrarium: 이 실험장은 tail의 -f 기능을 지원하지 않아요");
    expect(r.outside).toEqual(["tail -f"]);
  });
});

describe("writes change the world and are recorded as events [REQ-098]", () => {
  test("rm, truncate, kill, systemctl and a redirect are host actions; protected places are refused", () => {
    const { sh, world } = lab();
    const acts = () =>
      world
        .events()
        .filter((e) => e.type === "host.act")
        .map((e) => (e as { action: string }).action);
    sh("echo x > /tmp/a.tmp");
    sh("rm /tmp/a.tmp");
    expect(sh("ls /tmp")).not.toContain("a.tmp");
    expect(sh("rm /etc/passwd")).toBe("rm: cannot remove '/etc/passwd': Operation not permitted");
    expect(sh("rm /tmp/none")).toBe("rm: cannot remove '/tmp/none': No such file or directory");
    sh("systemctl stop licd");
    expect(sh("systemctl is-active licd")).toBe("inactive");
    sh("systemctl start licd");
    sh("systemctl disable licd");
    expect(sh("systemctl is-enabled licd")).toBe("disabled");
    sh("systemctl restart licd");
    expect(acts()).toEqual(["write", "remove", "stop", "start", "disable", "restart"]);
  });

  test("a restart gives the process a new PID; a polite kill ends it and a hard kill makes systemd start it again", () => {
    const { sh, physics, world } = lab();
    const pid = () => sh("pgrep licd");
    const first = pid();
    sh("systemctl restart licd");
    expect(pid()).not.toBe(first);
    const second = pid();
    sh(`kill -9 ${second}`);
    expect(pid()).not.toBe(second);
    sh(`kill ${pid()}`);
    physics.run(30);
    expect(sh("systemctl is-active licd")).toBe("inactive");
    expect(world.stateAs("svc-license", "service").status).toBe("down");
    sh("systemctl start licd");
    physics.run(60);
    expect(sh("systemctl is-active licd")).toBe("active");
    expect(world.stateAs("svc-license", "service").status).toBe("healthy");
  });

  test("on a read-only file system writes fail with the real words and mount shows ro", () => {
    const { sh, inject, physics } = lab();
    inject("fs_readonly", "srv-a2");
    physics.run(60);
    expect(sh("echo x > /var/lib/licd/x")).toBe("bash: /var/lib/licd/x: Read-only file system");
    expect(sh("touch /var/log/x")).toContain("Read-only file system");
    expect(sh("mount | grep ' / '")).toContain("(ro,");
    sh("mount -o remount,rw /");
    expect(sh("echo x > /var/lib/licd/x && cat /var/lib/licd/x")).toBe("x");
  });
});

describe("a call that changes the host is an act, wherever the command hides [REQ-098]", () => {
  test("pipes, xargs, find -exec, sudo and redirects are looked into", () => {
    const effect = (cmd: string) => callEffect("run_command", { host: "srv-a2", cmd });
    for (const cmd of [
      "rm /tmp/x",
      "find /var/log -size +1G | xargs rm",
      "find /tmp -name '*.tmp' -exec rm {} ;",
      "find /tmp -delete",
      "sudo systemctl restart licd",
      "nice -n 5 rm /tmp/x",
      "echo x > /tmp/x",
      "sed -i 's/a/b/' /tmp/x",
    ])
      expect(effect(cmd), cmd).toBe("act");
    for (const cmd of [
      "df -h | grep sda",
      "find /var/log -size +1G | xargs ls -l",
      "cat /etc/hosts 2>/dev/null",
      "systemctl status licd",
      "journalctl -u licd | tail",
    ])
      expect(effect(cmd), cmd).toBe("observe");
  });
});

describe("the files and the processes agree with each other [REQ-098]", () => {
  test("ps, top and /proc/<pid>/status print the same process", () => {
    const { sh } = lab();
    const pid = sh("pgrep licd");
    expect(sh("ps aux | grep licd")).toContain(` ${pid} `);
    expect(sh("top -b -n 1")).toContain(`${pid} appsvc`);
    expect(sh(`cat /proc/${pid}/status | grep -E '^(Name|PPid)'`)).toBe("Name:\tlicd\nPPid:\t1");
    expect(sh(`cat /proc/${pid}/cmdline`)).toBe("/opt/app/bin/licd --config /etc/licd.conf");
  });

  test("free, /proc/meminfo and top show one memory; df and du show one disk", () => {
    const { sh } = lab();
    const total = Number(sh("free -m | awk '/^Mem:/ {print $2}'"));
    expect(Number(sh("grep MemTotal /proc/meminfo | awk '{print $2}'"))).toBe(total * 1024);
    expect(sh("top -b -n 1 | grep 'MiB Mem'")).toContain(`${total}.0 total`);
    const used = sh("df -h / | tail -1 | awk '{print $5}'");
    expect(used).toMatch(/^\d+%$/);
  });

  test("ls, du and stat agree about a file's size", () => {
    const { sh } = lab();
    sh("echo hello > /tmp/five.txt");
    expect(sh("stat -c %s /tmp/five.txt")).toBe("6");
    expect(sh("ls -l /tmp/five.txt | awk '{print $5}'")).toBe("6");
    expect(sh("wc -c < /tmp/five.txt")).toBe("6");
  });
});

describe("another layer can add a command [REQ-098]", () => {
  test("a registered command is found, runs in pipes, and shows up in which; the container layer adds kubectl and crictl this way", () => {
    const { sh, run } = lab();
    expect(run("srv-a2", "hookctl get things").exitCode).toBe(127);
    registerShellCommand("hookctl", (c) => ({
      out: `hook ${c.args.join(" ")} on ${c.h.name}\n`,
      code: 0,
    }));
    expect(sh("hookctl get things | tr a-z A-Z")).toBe("HOOK GET THINGS ON SRV-A2");
    expect(sh("which hookctl")).toBe("/usr/bin/hookctl");
    expect(sh("ls /usr/bin | grep -c hookctl")).toBe("1");
    expect(run("srv-a2", "hookctl").outside).toEqual([]);
  });
});
