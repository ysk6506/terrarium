/**
 * Directories, symbolic links and whole-tree walks of the deep operating-system fake (REQ-098, ADR-0117): `mkdir`,
 * `ln -s` and `readlink` write through the same world command as every other change, `find /` and `du /` walk the
 * whole tree, and a line with an empty command is a syntax error the way bash says it.
 */
import { callEffect } from "@terrarium/core/tools";
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

describe("a whole-tree walk finishes and its output is bounded [REQ-098]", () => {
  test("[REQ-098] find / and du / list the host without overflowing the stack", () => {
    const { run } = lab();
    const found = run("srv-a2", "find / | wc -l");
    expect(found.exitCode).toBe(0);
    expect(Number(found.stdout)).toBeGreaterThan(150);
    const everything = run("srv-a2", "find /");
    expect(everything.exitCode).toBe(0);
    expect(everything.output.split("\n").length).toBeLessThanOrEqual(401);
    expect(everything.output.startsWith("/\n/boot\n")).toBe(true);
    const sum = run("srv-a2", "du -s /");
    expect(sum.exitCode).toBe(0);
    expect(sum.stdout).toMatch(/^\d+\s+\/$/);
    const tree = run("srv-a2", "du /");
    expect(tree.exitCode).toBe(0);
    expect(tree.stdout.trim().split("\n").at(-1)).toMatch(/\s\/$/);
  });

  test("[REQ-098] the walk visits a directory before what is in it, in name order", () => {
    const { sh } = lab();
    const lines = sh("find /etc -maxdepth 1").split("\n");
    expect(lines[0]).toBe("/etc");
    expect(lines.slice(1)).toEqual([...lines.slice(1)].sort());
  });
});

describe("an empty command is a syntax error like in bash [REQ-098]", () => {
  test("[REQ-098] ; ; and a leading ; are refused, a trailing ; and blank lines are not", () => {
    const { run } = lab();
    const twice = run("srv-a2", "echo a ; ; echo b");
    expect(twice).toMatchObject({ exitCode: 2, stdout: "" });
    expect(twice.stderr).toBe("bash: syntax error near unexpected token `;'");
    expect(run("srv-a2", "; echo a").stderr).toContain("near unexpected token `;'");
    expect(run("srv-a2", "echo a;;").stderr).toContain("near unexpected token `;'");
    expect(run("srv-a2", "echo a && ; echo b").stderr).toContain("near unexpected token `;'");
    expect(run("srv-a2", "echo a ;").stdout).toBe("a");
    expect(run("srv-a2", "echo a\n\necho b").stdout).toBe("a\nb");
    expect(run("srv-a2", "echo a ;\necho b").stdout).toBe("a\nb");
  });
});

describe("mkdir makes directories as a world event [REQ-098]", () => {
  test("[REQ-098] a new directory shows in ls, cd and find, and the change is a host.act", () => {
    const { run, sh, world } = lab();
    expect(run("srv-a2", "mkdir /tmp/work").exitCode).toBe(0);
    expect(sh("ls -ld /tmp/work")).toMatch(/^drwxr-xr-x/);
    expect(sh("cd /tmp/work && pwd")).toBe("/tmp/work");
    expect(sh("find /tmp -name work -type d")).toBe("/tmp/work");
    sh("echo hi > /tmp/work/note");
    expect(sh("cat /tmp/work/note")).toBe("hi");
    expect(
      world.events().filter((e) => e.type === "host.act" && e.action === "mkdir"),
    ).toHaveLength(1);
    expect(sh("journalctl -n 20 | grep -c 'mkdir /tmp/work'")).toBe("1");
  });

  test("[REQ-098] -p makes the parents, -v says so, and a plain mkdir refuses what bash refuses", () => {
    const { run, sh } = lab();
    expect(sh("mkdir -pv /tmp/a/b/c")).toBe(
      "mkdir: created directory '/tmp/a'\nmkdir: created directory '/tmp/a/b'\nmkdir: created directory '/tmp/a/b/c'",
    );
    expect(run("srv-a2", "mkdir -p /tmp/a/b").exitCode).toBe(0);
    expect(run("srv-a2", "mkdir /tmp/a").stderr).toBe(
      "mkdir: cannot create directory '/tmp/a': File exists",
    );
    expect(run("srv-a2", "mkdir /tmp/x/y").stderr).toBe(
      "mkdir: cannot create directory '/tmp/x/y': No such file or directory",
    );
    expect(run("srv-a2", "mkdir /usr/newdir").stderr).toBe(
      "mkdir: cannot create directory '/usr/newdir': Permission denied",
    );
    expect(run("srv-a2", "mkdir").stderr).toContain("missing operand");
    sh("echo x > /tmp/file");
    expect(run("srv-a2", "mkdir -p /tmp/file/sub").stderr).toContain("Not a directory");
    expect(run("srv-a2", "mkdir -p /tmp/file").stderr).toContain("File exists");
    expect(run("srv-a2", "mkdir -m 700 /tmp/m")).toMatchObject({ exitCode: 2 });
    // ADR-0184: -z is no mkdir option, so mkdir's own refusal and nothing outside
    expect(run("srv-a2", "mkdir -z /tmp/m")).toMatchObject({ exitCode: 1, outside: [] });
    expect(run("srv-a2", "mkdir /tmp/one /tmp/two").exitCode).toBe(0);
    expect(run("srv-a2", "mkdir /tmp/one /tmp/three").exitCode).toBe(1);
    expect(sh("ls /tmp")).toContain("three");
  });

  test("[REQ-098] a removed directory can be made again, and a read-only file system refuses", () => {
    const { run, sh, inject, physics } = lab();
    sh("mkdir /tmp/d; touch /tmp/d/f");
    sh("rm -r /tmp/d");
    expect(run("srv-a2", "ls /tmp/d").exitCode).toBe(2);
    expect(run("srv-a2", "mkdir /tmp/d").exitCode).toBe(0);
    expect(sh("ls /tmp/d")).toBe("");
    inject("fs_readonly", "srv-a2");
    physics.run(60);
    expect(run("srv-a2", "mkdir /var/log/new").stderr).toContain("Read-only file system");
    expect(run("srv-a2", "mkdir /tmp/still-ok").exitCode).toBe(0);
  });

  test("[REQ-098] mkdir and ln count as actions, also inside sudo; readlink only observes", () => {
    const call = (cmd: string) => callEffect("run_command", { host: "srv-a2", cmd });
    expect(call("mkdir /tmp/x")).toBe("act");
    expect(call("sudo ln -s /a /tmp/b")).toBe("act");
    expect(call("readlink /tmp/b")).toBe("observe");
  });
});

describe("ln -s and readlink make and read symbolic links [REQ-098]", () => {
  test("[REQ-098] a link shows as l with its target, reads through, and readlink says where it points", () => {
    const { run, sh, world } = lab();
    expect(run("srv-a2", "ln -s /etc/hosts /tmp/hosts-link").exitCode).toBe(0);
    expect(sh("ls -l /tmp/hosts-link")).toMatch(
      /^lrwxrwxrwx 1 root +root +\d+ .* \/tmp\/hosts-link -> \/etc\/hosts$/,
    );
    expect(sh("cat /tmp/hosts-link")).toBe(sh("cat /etc/hosts"));
    expect(sh("readlink /tmp/hosts-link")).toBe("/etc/hosts");
    expect(sh("readlink -f /tmp/hosts-link")).toBe("/etc/hosts");
    expect(sh("find /tmp -type l")).toBe("/tmp/hosts-link");
    expect(sh("stat -c %F /tmp/hosts-link")).toBe("symbolic link");
    expect(
      world.events().filter((e) => e.type === "host.act" && e.action === "symlink"),
    ).toHaveLength(1);
    expect(sh("journalctl -n 20 | grep -c 'ln -s /etc/hosts /tmp/hosts-link'")).toBe("1");
  });

  test("[REQ-098] a link to a directory can be listed, entered and read through", () => {
    const { run, sh } = lab();
    sh("mkdir /tmp/real; echo inside > /tmp/real/f");
    sh("ln -s /tmp/real /tmp/alias");
    expect(sh("ls /tmp/alias")).toBe("f");
    expect(sh("cd /tmp/alias && pwd")).toBe("/tmp/alias");
    expect(sh("cat /tmp/alias/f")).toBe("inside");
    expect(sh("ls -ld /tmp/alias")).toContain("-> /tmp/real");
    expect(sh("ls -l /tmp/alias")).toContain("-> /tmp/real");
    expect(sh("find /tmp/alias")).toBe("/tmp/alias");
    expect(sh("readlink -f /tmp/alias/f")).toBe("/tmp/real/f");
    sh("ln -s ../real /tmp/real/up");
    expect(sh("readlink /tmp/real/up")).toBe("../real");
    expect(sh("readlink -f /tmp/real/up")).toBe("/tmp/real");
    expect(run("srv-a2", "ls /tmp/real/up/up/up").exitCode).toBe(0);
    expect(sh("du -s /tmp/alias")).toMatch(/^\d+\s+\/tmp\/alias$/);
  });

  test("[REQ-098] a file written through a link lands where the link leads; removing the link leaves the target", () => {
    const { sh, run } = lab();
    sh("mkdir /tmp/real; ln -s /tmp/real /tmp/alias");
    sh("echo one > /tmp/alias/f; echo two >> /tmp/alias/f; touch /tmp/alias/g");
    expect(sh("cat /tmp/real/f")).toBe("one\ntwo");
    expect(sh("ls /tmp/real")).toBe("f\ng");
    sh("ln -s /tmp/real/f /tmp/flink; echo three > /tmp/flink");
    expect(sh("cat /tmp/real/f")).toBe("three");
    sh("mkdir /tmp/alias/sub; ln -s /tmp/real/g /tmp/alias/glink");
    expect(sh("ls /tmp/real")).toBe("f\nglink\ng\nsub".split("\n").sort().join("\n"));
    expect(run("srv-a2", "rm /tmp/alias").exitCode).toBe(0);
    expect(sh("ls /tmp/real")).toContain("sub");
    expect(run("srv-a2", "echo x > /tmp/gone/f").stderr).toContain("No such file or directory");
    expect(run("srv-a2", "touch /tmp/gone/f").stderr).toContain("No such file or directory");
  });

  test("[REQ-098] ln refuses what it refuses in bash, and -f replaces", () => {
    const { run, sh } = lab();
    sh("ln -s /etc/hosts /tmp/l1");
    expect(run("srv-a2", "ln -s /etc/passwd /tmp/l1").stderr).toBe(
      "ln: failed to create symbolic link '/tmp/l1': File exists",
    );
    expect(run("srv-a2", "ln -sf /etc/passwd /tmp/l1").exitCode).toBe(0);
    expect(sh("readlink /tmp/l1")).toBe("/etc/passwd");
    expect(run("srv-a2", "ln -s /etc/hosts /tmp/nope/l2").stderr).toContain(
      "No such file or directory",
    );
    expect(run("srv-a2", "ln -s /etc/hosts /usr/l3").stderr).toContain("Permission denied");
    expect(run("srv-a2", "ln -s").stderr).toBe("ln: missing file operand");
    expect(run("srv-a2", "ln -s a b c").stderr).toBe("ln: extra operand");
    expect(sh("ln -sv /etc/hosts /tmp/l4")).toBe("'/tmp/l4' -> '/etc/hosts'");
    sh("mkdir /tmp/dir");
    expect(run("srv-a2", "ln -s /etc/hosts /tmp/dir").exitCode).toBe(0);
    expect(sh("readlink /tmp/dir/hosts")).toBe("/etc/hosts");
    sh("cd /tmp && ln -s /etc/hosts");
    expect(sh("readlink /tmp/hosts")).toBe("/etc/hosts");
    expect(run("srv-a2", "mkdir /tmp/e; ln -s /tmp/e /tmp/dirlink").exitCode).toBe(0);
    expect(run("srv-a2", "ln -s /etc/hosts /tmp/dirlink/").exitCode).toBe(0);
  });

  test("[REQ-098] a hard link is not simulated: it says so and is counted as outside", () => {
    const { run } = lab();
    const r = run("srv-a2", "ln /etc/hosts /tmp/hard");
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("이 흉내에서는 안 돼요");
    expect(r.outside).toEqual(["ln 하드 링크"]);
    expect(run("srv-a2", "ln -x a b")).toMatchObject({ exitCode: 1, outside: [] });
  });

  test("[REQ-098] readlink on a file, a missing path, a loop and a dangling link", () => {
    const { run, sh } = lab();
    expect(run("srv-a2", "readlink /etc/hosts")).toMatchObject({ exitCode: 1, stdout: "" });
    expect(run("srv-a2", "readlink").exitCode).toBe(1);
    expect(sh("readlink -f /etc/./hosts")).toBe("/etc/hosts");
    expect(run("srv-a2", "readlink -f /nowhere/x").exitCode).toBe(1);
    expect(sh("readlink -f /etc/nope")).toBe("/etc/nope");
    expect(run("srv-a2", "readlink -e /etc/nope").exitCode).toBe(1);
    expect(sh("readlink -m /no/such/x")).toBe("/no/such/x");
    expect(sh("readlink -n /etc/hosts; echo done")).toBe("done");
    sh("ln -s /tmp/b /tmp/a; ln -s /tmp/a /tmp/b");
    expect(run("srv-a2", "cat /tmp/a").stderr).toContain("No such file or directory");
    expect(run("srv-a2", "readlink -e /tmp/a").exitCode).toBe(1);
    sh("ln -s /tmp/missing /tmp/dangling");
    expect(run("srv-a2", "cat /tmp/dangling").exitCode).toBe(1);
    expect(run("srv-a2", "readlink -e /tmp/dangling").exitCode).toBe(1);
    expect(sh("readlink /tmp/dangling")).toBe("/tmp/missing");
    expect(run("srv-a2", "readlink -z /tmp/a").outside.join()).toContain("-z");
    expect(sh("readlink /tmp/a /tmp/dangling")).toBe("/tmp/b\n/tmp/missing");
  });

  test("[REQ-098] a link is removed by rm without touching its target", () => {
    const { run, sh } = lab();
    sh("ln -s /etc/hosts /tmp/gone");
    expect(run("srv-a2", "rm /tmp/gone").exitCode).toBe(0);
    expect(run("srv-a2", "readlink /tmp/gone").exitCode).toBe(1);
    expect(sh("cat /etc/hosts")).toContain("localhost");
  });
});

describe("a replay builds the same tree [REQ-098]", () => {
  test("[REQ-098] the same commands on two fresh worlds give the same text, links and directories included", () => {
    const script = [
      "mkdir -p /tmp/p/q",
      "ln -s /tmp/p /tmp/pl",
      "echo x > /tmp/p/q/f",
      "ls -lR /tmp",
      "readlink -f /tmp/pl/q",
      "find /tmp",
      "du -a /tmp",
      "journalctl -n 30",
    ];
    const play = () => {
      const { sh } = lab();
      return script.map((cmd) => sh(cmd));
    };
    expect(play()).toEqual(play());
  });
});
