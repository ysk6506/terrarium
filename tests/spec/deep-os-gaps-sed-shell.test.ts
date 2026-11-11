/**
 * Corners of `sed` and of the shell's reading of a command line in the deep operating-system fake (REQ-098, ADR-0117
 * decisions 3 and 4): groups that did not match, the hold space, NUL-separated records, backslashes in double quotes, a
 * redirect without a file, and which lines the tool counts as changing the host.
 */
import { changesWorld } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { lab } from "./test-support/deep-os-lab";

describe("sed [REQ-098]", () => {
  test("[REQ-098] a group that matched nothing, or matched the empty text, puts nothing into the replacement", () => {
    const { sh } = lab();
    expect(sh("echo b | sed -E 's/(a)?b/[\\1]/'")).toBe("[]");
    expect(sh("echo ab | sed -E 's/(x*)b/[\\1]/'")).toBe("a[]");
    expect(sh("echo ab | sed -E 's/(a)(b)/\\2\\1/'")).toBe("ba");
  });

  test("[REQ-098] \\n and \\t in a replacement are a newline and a tab, any other escaped character is itself", () => {
    const { sh } = lab();
    expect(sh("echo a,b | sed 's/,/\\n/'")).toBe("a\nb");
    expect(sh("echo a,b | sed 's/,/\\t/'")).toBe("a\tb");
    expect(sh("echo a,b | sed 's/,/\\./'")).toBe("a.b");
    expect(sh("echo a,b | sed 's/,/\\&/'")).toBe("a&b");
  });

  test("[REQ-098] g copies the hold space over the pattern space, h and x move lines around", () => {
    const { sh } = lab();
    sh("printf 'a\\nb\\nc\\n' > /tmp/h");
    expect(sh("sed '1h;2g' /tmp/h")).toBe("a\na\nc");
    expect(sh("sed -n '1h;3{g;p}' /tmp/h")).toBe("a");
    expect(sh("sed 'x' /tmp/h")).toBe("\na\nb");
  });

  test("[REQ-098] -z reads NUL-separated records, and text without a NUL is one record without a line end added", () => {
    const { sh } = lab();
    expect(sh("printf 'a\\0b\\0' | sed -z 's/a/x/' | tr '\\0' '|'")).toBe("x|b|");
    expect(sh("printf 'one two' | sed -z 's/one/1/'")).toBe("1 two");
  });

  test("[REQ-098] a file that is not there makes the exit code 2, an in-place edit on a read-only file system says so", () => {
    const { run, sh, inject, physics } = lab();
    const missing = run("srv-a2", "sed p /tmp/none");
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain("/tmp/none");
    sh("printf 'a\\n' > /tmp/e; echo x > /tmp/ok");
    inject("fs_readonly", "srv-a2");
    physics.run(60);
    const ro = run("srv-a2", "sed -i s/a/b/ /etc/hosts");
    expect(ro.exitCode).toBe(4);
    expect(ro.stderr).toContain("Read-only file system");
    expect(run("srv-a2", "sed -i s/x/y/ /tmp/ok").exitCode).toBe(0);
    expect(sh("cat /tmp/ok")).toBe("y");
  });
});

describe("the shell's reading of a line [REQ-098]", () => {
  test('[REQ-098] in double quotes a backslash escapes only $ ` " and \\, and stays a backslash before anything else', () => {
    const { sh } = lab();
    expect(sh('echo "q\\"q"')).toBe('q"q');
    expect(sh('echo "a\\\\b"')).toBe("a\\b");
    expect(sh('echo "a\\zb"')).toBe("a\\zb");
    expect(sh("echo 'a\\zb'")).toBe("a\\zb");
  });

  test("[REQ-098] ~ alone is the home directory, ~ inside a word is not", () => {
    const { sh } = lab();
    expect(sh("echo ~")).toBe("/home/ops");
    expect(sh("echo ~ ~")).toBe("/home/ops /home/ops");
    expect(sh("echo a~b")).toBe("a~b");
  });

  test("[REQ-098] a redirect with no file after it is a syntax error, a variable is refused and counted outside", () => {
    const { run } = lab();
    const open = run("srv-a2", "echo hi >");
    expect(open.exitCode).not.toBe(0);
    expect(open.stderr).toContain("syntax error near unexpected token");
    expect(open.outside).toEqual([]);
    const variable = run("srv-a2", 'echo "$HOME"');
    expect(variable.exitCode).not.toBe(0);
    expect(variable.outside).toEqual(["셸 문법 $"]);
  });

  test("[REQ-098] a line changes the host when its command, or the command it runs through xargs, does", () => {
    expect(changesWorld("printf 'a' | xargs -n 1 rm /tmp/x")).toBe(true);
    expect(changesWorld("printf 'a' | xargs -I {} rm {}")).toBe(true);
    expect(changesWorld("printf 'a' | xargs rm")).toBe(true);
    expect(changesWorld("printf 'a' | xargs -n 1 cat")).toBe(false);
    expect(changesWorld("sudo -n systemctl restart sshd")).toBe(true);
    expect(changesWorld("sudo -n systemctl status sshd")).toBe(false);
    expect(changesWorld("nice -n 5 rm /tmp/x")).toBe(true);
    expect(changesWorld("echo hi >")).toBe(false);
    expect(changesWorld("echo hi > /dev/null")).toBe(false);
    expect(changesWorld("echo hi > /tmp/x")).toBe(true);
  });
});
